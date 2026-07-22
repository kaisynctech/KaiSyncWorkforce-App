-- ════════════════════════════════════════════════════════════════════════════
-- FIX C3 — WORKER SESSION VALIDATION (token binding)
--
-- Problem: code-login worker RPCs trust client-supplied (company_id, employee_id)
-- validated only by existence/assignment helpers. The session_token is used only
-- for refresh/revoke, never as a per-call binding. With the publishable anon key,
-- knowledge of valid UUIDs is enough to call worker RPCs.
--
-- This migration adds, WITHOUT converting workers to JWT and WITHOUT breaking the
-- anon RPC / company-code UX or the portals:
--   • _employee_session_is_valid(company, employee, token) — reusable, cheap SQL
--     primitive that future worker RPCs can call to enforce token binding.
--   • employee_validate_session(...) — a public gate that returns boolean and records
--     invalid attempts in a RATE-LIMIT-FRIENDLY aggregated audit (one row per
--     company/employee/day, not per attempt).
--   • worker_session_audit — durable, aggregated invalid-attempt counters.
--
-- Existing worker RPCs are unchanged (backward compatible). The client binds the
-- token on session restore; per-RPC adoption can follow incrementally using the
-- _employee_session_is_valid primitive.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;
-- ─── Aggregated invalid-attempt audit (flood-resistant) ─────────────────────
CREATE TABLE IF NOT EXISTS public.worker_session_audit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid,
  employee_id      uuid,
  attempt_date     date NOT NULL DEFAULT current_date,
  invalid_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_reason      text,
  CONSTRAINT uq_worker_session_audit UNIQUE (company_id, employee_id, attempt_date)
);
ALTER TABLE public.worker_session_audit ENABLE ROW LEVEL SECURITY;
-- HR (authenticated) may read their own company's audit; only definer functions write.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'p_worker_session_audit_hr_read') THEN
    CREATE POLICY p_worker_session_audit_hr_read ON public.worker_session_audit
      FOR SELECT USING (company_id = ANY(public.user_company_ids()));
  END IF;
END $$;
-- ─── Reusable token-binding primitive (for incremental per-RPC adoption) ────
CREATE OR REPLACE FUNCTION public._employee_session_is_valid(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_code_sessions s
    WHERE s.session_token = p_session_token
      AND s.company_id   = p_company_id
      AND s.employee_id  = p_employee_id
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
  );
$$;
-- ─── Public validation gate (records invalid attempts, bumps last_seen) ─────
CREATE OR REPLACE FUNCTION public.employee_validate_session(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_session_token IS NOT NULL AND length(trim(p_session_token)) > 0 THEN
    v_ok := public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token);
  END IF;

  IF v_ok THEN
    UPDATE public.employee_code_sessions
    SET last_seen_at = now()
    WHERE session_token = p_session_token;
    RETURN true;
  END IF;

  -- Aggregate invalid attempts per (company, employee, day): cheap + flood-resistant,
  -- and a foundation for future rate-limit/lockout policy.
  INSERT INTO public.worker_session_audit (
    company_id, employee_id, attempt_date, invalid_attempts, last_attempt_at, last_reason
  ) VALUES (
    p_company_id, p_employee_id, current_date, 1, now(), 'invalid_or_expired'
  )
  ON CONFLICT (company_id, employee_id, attempt_date)
  DO UPDATE SET invalid_attempts = public.worker_session_audit.invalid_attempts + 1,
                last_attempt_at  = now(),
                last_reason      = 'invalid_or_expired';

  RETURN false;
END;
$$;
GRANT EXECUTE ON FUNCTION public._employee_session_is_valid(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_validate_session(uuid, uuid, text) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
--   drop function if exists public.employee_validate_session(uuid,uuid,text);
--   drop function if exists public._employee_session_is_valid(uuid,uuid,text);
--   drop table if exists public.worker_session_audit;
--   (Revert the C# ValidateCodeSessionAsync call in RefreshCodeSessionAsync.)
-- ════════════════════════════════════════════════════════════════════════════;
