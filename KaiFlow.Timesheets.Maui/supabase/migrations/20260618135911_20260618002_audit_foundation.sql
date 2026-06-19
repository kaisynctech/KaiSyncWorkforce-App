-- ARCH-002 Migration 1: Audit Foundation
-- Creates the immutable audit_events table and core audit write/read functions.

-- mask_sensitive_fields: redacts PII fields from jsonb state snapshots
CREATE OR REPLACE FUNCTION public.mask_sensitive_fields(p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE (
      SELECT jsonb_object_agg(
        key,
        CASE WHEN key IN (
          'bank_account', 'bank_name', 'bank_branch_code',
          'id_number', 'tax_number'
        )
          THEN to_jsonb('[REDACTED]'::text)
          ELSE value
        END
      )
      FROM jsonb_each(p_data)
    )
  END;
$$;

-- audit_events: immutable audit log table
CREATE TABLE IF NOT EXISTS public.audit_events (
  id                uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id        uuid        NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  actor_user_id     uuid        NOT NULL,
  actor_employee_id uuid        REFERENCES employees(id) ON DELETE SET NULL,
  action            text        NOT NULL,
  target_type       text        NOT NULL,
  target_id         text        NOT NULL,
  before_state      jsonb,
  after_state       jsonb,
  meta              jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  actor_role        text
);

CREATE INDEX IF NOT EXISTS idx_audit_events_company_time
  ON public.audit_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_target
  ON public.audit_events (company_id, target_type, target_id, created_at DESC);

-- Immutability: prevent UPDATE and DELETE on audit_events
CREATE OR REPLACE FUNCTION public.trg_fn_audit_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is immutable: UPDATE and DELETE are not permitted'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_no_update ON public.audit_events;
CREATE TRIGGER trg_audit_events_no_update
  BEFORE UPDATE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_events_immutable();

DROP TRIGGER IF EXISTS trg_audit_events_no_delete ON public.audit_events;
CREATE TRIGGER trg_audit_events_no_delete
  BEFORE DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_events_immutable();

-- Enable RLS on audit_events
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_select ON public.audit_events;
CREATE POLICY audit_events_select ON public.audit_events
  FOR SELECT
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) = ANY(ARRAY['owner','hr'])
  );

-- write_audit_event: internal function for writing audit records
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

  v_actor_role := get_my_role(p_company_id);

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

-- get_audit_events: paginated audit log reader (owner/hr only)
CREATE OR REPLACE FUNCTION public.get_audit_events(
  p_company_id uuid,
  p_limit      integer  DEFAULT 100,
  p_offset     integer  DEFAULT 0,
  p_action     text     DEFAULT NULL,
  p_from_ts    timestamptz DEFAULT NULL,
  p_to_ts      timestamptz DEFAULT NULL
)
RETURNS SETOF audit_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required to view audit log'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.audit_events
    WHERE company_id = p_company_id
      AND (p_action  IS NULL OR action     = p_action)
      AND (p_from_ts IS NULL OR created_at >= p_from_ts)
      AND (p_to_ts   IS NULL OR created_at <= p_to_ts)
    ORDER BY created_at DESC
    LIMIT  p_limit
    OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_event(uuid,text,text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_event(uuid,text,text,text,jsonb,jsonb,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.write_audit_event(uuid,text,text,text,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_event(uuid,text,text,text,jsonb,jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.get_audit_events(uuid,integer,integer,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_audit_events(uuid,integer,integer,text,timestamptz,timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_audit_events(uuid,integer,integer,text,timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_events(uuid,integer,integer,text,timestamptz,timestamptz) TO service_role;
