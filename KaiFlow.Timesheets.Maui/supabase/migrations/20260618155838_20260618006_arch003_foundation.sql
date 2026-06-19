-- ARCH-003 Migration 1: Foundation
-- Lockout infrastructure, portal code expiry tracking, anon revocations.

-- code_login_attempts: rate-limit login attempts per employee per day
CREATE TABLE IF NOT EXISTS public.code_login_attempts (
  company_id      uuid         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_code   text         NOT NULL,
  attempt_date    date         NOT NULL DEFAULT CURRENT_DATE,
  failed_attempts integer      NOT NULL DEFAULT 0,
  last_attempt_at timestamptz  NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  PRIMARY KEY (company_id, employee_code, attempt_date)
);

-- employees: lockout columns
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS login_failed_attempts integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_account_locked      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at              timestamptz,
  ADD COLUMN IF NOT EXISTS locked_reason          text,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts    integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until       timestamptz;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS chk_employees_locked_reason;
ALTER TABLE public.employees
  ADD CONSTRAINT chk_employees_locked_reason
    CHECK (locked_reason IN ('login_attempts', 'pin_attempts', 'hr_manual') OR locked_reason IS NULL);

CREATE INDEX IF NOT EXISTS idx_employees_account_locked
  ON public.employees (company_id)
  WHERE is_account_locked = true;

-- company_settings: security_settings column
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS security_settings jsonb NOT NULL
  DEFAULT '{"lockout_threshold": 5, "portal_code_expiry_days": 365}'::jsonb;

-- contractors: portal code expiry tracking
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS contractor_code_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contractor_code_rotated_at  timestamptz;

-- clients: portal code expiry tracking
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_code_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS client_code_rotated_at  timestamptz;

-- Backfill portal code expiry for existing records
UPDATE public.contractors
  SET contractor_code_expires_at = now() + INTERVAL '1 year'
  WHERE contractor_code_expires_at IS NULL;

UPDATE public.clients
  SET client_code_expires_at = now() + INTERVAL '1 year'
  WHERE client_code_expires_at IS NULL;

-- employee_code_sessions: device_info, revoked_by columns
ALTER TABLE public.employee_code_sessions
  ADD COLUMN IF NOT EXISTS device_info   jsonb,
  ADD COLUMN IF NOT EXISTS revoked_by    uuid;

-- Enable RLS on employee_code_sessions
ALTER TABLE public.employee_code_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_employee_code_sessions_company_active
  ON public.employee_code_sessions (company_id, employee_id, created_at DESC)
  WHERE revoked_at IS NULL AND expires_at > now();

-- Revoke anon from ARCH-002 RPCs
REVOKE ALL ON FUNCTION public.get_audit_events(uuid,integer,integer,text,timestamptz,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.write_audit_event(uuid,text,text,text,jsonb,jsonb,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.mask_sensitive_fields(jsonb) FROM PUBLIC;
