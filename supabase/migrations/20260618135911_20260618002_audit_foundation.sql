-- ═══════════════════════════════════════════════════════════════════════════════
-- ARCH-002 Migration 1 — Audit Foundation
-- Fixes SF-1 (employee_salary_history unprotected).
-- Creates audit_events (immutable, 2-layer).
-- Creates mask_sensitive_fields, write_audit_event, get_audit_events.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── SF-1 Fix: Company-scoped RLS on employee_salary_history ──────────────────

ALTER TABLE public.employee_salary_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "salary_history_select"
  ON public.employee_salary_history
  FOR SELECT
  USING (company_id = ANY(public.user_company_ids())
    AND public.get_my_role(company_id) IN ('owner', 'hr'));

CREATE POLICY "salary_history_insert"
  ON public.employee_salary_history
  FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids())
    AND public.get_my_role(company_id) IN ('owner', 'hr'));

-- No UPDATE or DELETE policies on salary_history — history is append-only.

-- ── audit_events table ────────────────────────────────────────────────────────

CREATE TABLE public.audit_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_user_id     uuid        NOT NULL,
  actor_employee_id uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  action            text        NOT NULL,
  target_type       text        NOT NULL,
  target_id         text        NOT NULL,
  before_state      jsonb,
  after_state       jsonb,
  meta              jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Index for the primary query pattern: audit trail for a company ordered by time.
CREATE INDEX idx_audit_events_company_created
  ON public.audit_events (company_id, created_at DESC);

CREATE INDEX idx_audit_events_action
  ON public.audit_events (company_id, action);

-- ── audit_events RLS — read-only for owner/hr; writes only via write_audit_event (SECURITY DEFINER) ──

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Only owner/hr can read the audit trail for their company.
CREATE POLICY "audit_events_select"
  ON public.audit_events
  FOR SELECT
  USING (company_id = ANY(public.user_company_ids())
    AND public.get_my_role(company_id) IN ('owner', 'hr'));

-- No INSERT/UPDATE/DELETE policies from PostgREST.
-- Inserts flow exclusively through write_audit_event() SECURITY DEFINER.
-- Updates and deletes are blocked at both RLS and trigger layers.

-- ── Immutability trigger — second layer of protection ────────────────────────

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

CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_audit_events_immutable();

-- ── mask_sensitive_fields — IMMUTABLE, replaces sensitive values with [REDACTED] ──

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

-- ── write_audit_event — SECURITY DEFINER helper called by all audit hooks ─────

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_company_id   uuid,
  p_action       text,
  p_target_type  text,
  p_target_id    text,
  p_before_state jsonb    DEFAULT NULL,
  p_after_state  jsonb    DEFAULT NULL,
  p_meta         jsonb    DEFAULT '{}'
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_actor_employee_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'write_audit_event: not authenticated' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve actor's employee record for this company (may be null, e.g. trigger context).
  SELECT id INTO v_actor_employee_id
  FROM employees
  WHERE user_id   = auth.uid()
    AND company_id = p_company_id
    AND is_active  = true
  LIMIT 1;

  INSERT INTO public.audit_events (
    company_id, actor_user_id, actor_employee_id,
    action, target_type, target_id,
    before_state, after_state, meta
  ) VALUES (
    p_company_id,
    auth.uid(),
    v_actor_employee_id,
    p_action,
    p_target_type,
    p_target_id,
    public.mask_sensitive_fields(p_before_state),
    public.mask_sensitive_fields(p_after_state),
    coalesce(p_meta, '{}')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_audit_event TO authenticated;

-- ── get_audit_events — paginated audit trail RPC for owner/hr ─────────────────

CREATE OR REPLACE FUNCTION public.get_audit_events(
  p_company_id uuid,
  p_limit      int         DEFAULT 100,
  p_offset     int         DEFAULT 0,
  p_action     text        DEFAULT NULL,
  p_from_ts    timestamptz DEFAULT NULL,
  p_to_ts      timestamptz DEFAULT NULL
)
  RETURNS SETOF public.audit_events
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
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

REVOKE ALL ON FUNCTION public.get_audit_events FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_events TO authenticated;;
