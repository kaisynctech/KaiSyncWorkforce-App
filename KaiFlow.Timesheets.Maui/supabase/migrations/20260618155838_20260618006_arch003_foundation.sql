
-- ============================================================
-- ARCH-003 Migration 1: CF Resolution + Security Foundation
-- 2026-06-18
-- ============================================================

-- ── CF-A: Revoke anon from 6 ARCH-002 RPCs ─────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_audit_events','decide_leave_request','update_employee_banking',
        'set_employee_active','delete_employee','reject_payment_run'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END;
$$;

-- ── CF-B: Drop legacy hr_delete_employee_safe ───────────────
-- App routing confirmed through delete_employee RPC (HrEmployeesViewModel.DeleteAsync).
DROP FUNCTION IF EXISTS public.hr_delete_employee_safe(uuid, uuid);

-- ── CF-C: Revoke PUBLIC + anon from mask_sensitive_fields ───
REVOKE ALL ON FUNCTION public.mask_sensitive_fields(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mask_sensitive_fields(jsonb) FROM anon;
-- Authenticated and service_role retain access (already granted).

-- ── company_settings: add security_settings ─────────────────
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS security_settings jsonb NOT NULL
    DEFAULT '{"lockout_threshold": 5, "portal_code_expiry_days": 365}'::jsonb;

-- ── Rebuild upsert_company_settings: include security_settings + validation ──
CREATE OR REPLACE FUNCTION public.upsert_company_settings(p_company_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row       public.company_settings%ROWTYPE;
  v_before    jsonb;
  v_sec       jsonb;
  v_threshold integer;
BEGIN
  IF NOT (public.is_company_owner(p_company_id) OR public.platform_is_admin()) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT to_jsonb(cs) INTO v_before
  FROM company_settings cs
  WHERE cs.company_id = p_company_id;

  -- SR-8: Validate lockout_threshold if security_settings provided
  IF p_payload ? 'security_settings' THEN
    v_sec := p_payload->'security_settings';
    IF v_sec IS NOT NULL AND v_sec != 'null'::jsonb AND v_sec ? 'lockout_threshold' THEN
      v_threshold := (v_sec->>'lockout_threshold')::integer;
      IF v_threshold < 3 OR v_threshold > 10 THEN
        RAISE EXCEPTION 'lockout_threshold must be between 3 and 10 inclusive'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.company_settings (
    company_id, timezone, currency, vat_rate, branding, logo_url,
    primary_color, secondary_color, payroll_preferences, leave_settings,
    security_settings, updated_at
  ) VALUES (
    p_company_id,
    coalesce(p_payload->>'timezone', 'Africa/Johannesburg'),
    coalesce(p_payload->>'currency', 'ZAR'),
    coalesce((p_payload->>'vat_rate')::numeric, 15.00),
    coalesce(p_payload->'branding', '{}'::jsonb),
    p_payload->>'logo_url',
    p_payload->>'primary_color',
    p_payload->>'secondary_color',
    coalesce(p_payload->'payroll_preferences', '{}'::jsonb),
    coalesce(p_payload->'leave_settings', '{}'::jsonb),
    coalesce(
      CASE WHEN p_payload ? 'security_settings' AND p_payload->'security_settings' != 'null'::jsonb
           THEN p_payload->'security_settings' END,
      '{"lockout_threshold": 5, "portal_code_expiry_days": 365}'::jsonb
    ),
    now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    timezone            = coalesce(EXCLUDED.timezone,            company_settings.timezone),
    currency            = coalesce(EXCLUDED.currency,            company_settings.currency),
    vat_rate            = coalesce(EXCLUDED.vat_rate,            company_settings.vat_rate),
    branding            = coalesce(EXCLUDED.branding,            company_settings.branding),
    logo_url            = coalesce(EXCLUDED.logo_url,            company_settings.logo_url),
    primary_color       = coalesce(EXCLUDED.primary_color,       company_settings.primary_color),
    secondary_color     = coalesce(EXCLUDED.secondary_color,     company_settings.secondary_color),
    payroll_preferences = coalesce(EXCLUDED.payroll_preferences, company_settings.payroll_preferences),
    leave_settings      = coalesce(EXCLUDED.leave_settings,      company_settings.leave_settings),
    security_settings   = CASE
                            WHEN p_payload ? 'security_settings'
                             AND p_payload->'security_settings' != 'null'::jsonb
                              THEN p_payload->'security_settings'
                            ELSE company_settings.security_settings
                          END,
    updated_at          = now()
  RETURNING * INTO v_row;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'company.settings_updated',
      'company_settings',
      p_company_id::text,
      v_before,
      to_jsonb(v_row)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;

  RETURN to_jsonb(v_row);
END;
$$;

-- ── code_login_attempts table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.code_login_attempts (
  company_id      uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_code   text         NOT NULL,
  attempt_date    date         NOT NULL DEFAULT CURRENT_DATE,
  failed_attempts integer      NOT NULL DEFAULT 0,
  last_attempt_at timestamptz  NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  PRIMARY KEY (company_id, employee_code, attempt_date)
);
-- No direct PostgREST access; all access via SECURITY DEFINER RPCs.
ALTER TABLE public.code_login_attempts ENABLE ROW LEVEL SECURITY;

-- ── employees: account lockout columns ──────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS login_failed_attempts integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_account_locked      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at              timestamptz,
  ADD COLUMN IF NOT EXISTS locked_reason          text;

-- SR-6: locked_reason constraint
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS chk_employees_locked_reason;
ALTER TABLE public.employees
  ADD CONSTRAINT chk_employees_locked_reason
    CHECK (locked_reason IN ('login_attempts', 'pin_attempts', 'hr_manual') OR locked_reason IS NULL);

-- Index: powers hr_get_locked_employees
CREATE INDEX IF NOT EXISTS idx_employees_account_locked
  ON public.employees (company_id)
  WHERE is_account_locked = true;

-- ── employee_code_sessions: new columns ─────────────────────
ALTER TABLE public.employee_code_sessions
  ADD COLUMN IF NOT EXISTS device_info   jsonb,
  ADD COLUMN IF NOT EXISTS revoked_by    uuid;

-- RLS: already enabled (idempotent), no policies = no direct PostgREST access.
-- All session access MUST flow through SECURITY DEFINER RPCs.
ALTER TABLE public.employee_code_sessions ENABLE ROW LEVEL SECURITY;

-- Index: powers hr_list_active_sessions
CREATE INDEX IF NOT EXISTS idx_employee_code_sessions_company_active
  ON public.employee_code_sessions (company_id, employee_id, created_at DESC)
  WHERE revoked_at IS NULL;

-- ── contractors: portal code expiry columns ──────────────────
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS contractor_code_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contractor_code_rotated_at  timestamptz;

-- Backfill: give existing codes a 1-year window from today
UPDATE public.contractors
SET contractor_code_expires_at = now() + INTERVAL '1 year'
WHERE contractor_code IS NOT NULL
  AND contractor_code_expires_at IS NULL;

-- ── clients: portal code expiry columns ─────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_code_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS client_code_rotated_at  timestamptz;

-- Backfill: give existing codes a 1-year window from today
UPDATE public.clients
SET client_code_expires_at = now() + INTERVAL '1 year'
WHERE client_code IS NOT NULL
  AND client_code_expires_at IS NULL;
;
