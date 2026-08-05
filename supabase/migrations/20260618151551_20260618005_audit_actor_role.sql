
-- ================================================================
-- Migration: 20260618005_audit_actor_role
-- Adds actor_role column to audit_events (BR-3 compliance gap).
-- BR-3: "Every audit event must record the actor's UUID, their role
-- at the time of the action."
-- actor_role must be captured at write time because roles can change
-- after the fact — joining back to employees or company_relationships
-- at query time would reflect the current role, not the historical one.
-- ================================================================

-- Add column. Nullable to accommodate any existing rows safely;
-- write_audit_event always supplies a value going forward.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_role text;

-- Rebuild write_audit_event to capture get_my_role() at event time.
CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_company_id   uuid,
  p_action       text,
  p_target_type  text,
  p_target_id    text,
  p_before_state jsonb DEFAULT NULL,
  p_after_state  jsonb DEFAULT NULL,
  p_meta         jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor_employee_id uuid;
  v_actor_role        text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'write_audit_event: not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Capture role at the moment of the event (not at query time).
  v_actor_role := get_my_role(p_company_id);

  -- Resolve actor's employee record for display purposes (nullable).
  SELECT id INTO v_actor_employee_id
  FROM employees
  WHERE user_id    = auth.uid()
    AND company_id = p_company_id
    AND is_active  = true
  LIMIT 1;

  INSERT INTO public.audit_events (
    company_id, actor_user_id, actor_employee_id, actor_role,
    action, target_type, target_id,
    before_state, after_state, meta
  ) VALUES (
    p_company_id,
    auth.uid(),
    v_actor_employee_id,
    v_actor_role,
    p_action,
    p_target_type,
    p_target_id,
    public.mask_sensitive_fields(p_before_state),
    public.mask_sensitive_fields(p_after_state),
    coalesce(p_meta, '{}')
  );
END;
$$;

-- Preserve grant state: no PUBLIC, no anon
REVOKE ALL ON FUNCTION public.write_audit_event(uuid, text, text, text, jsonb, jsonb, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_event(uuid, text, text, text, jsonb, jsonb, jsonb)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.write_audit_event(uuid, text, text, text, jsonb, jsonb, jsonb)
  TO authenticated;
;
