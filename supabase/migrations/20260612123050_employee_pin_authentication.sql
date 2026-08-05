-- ============================================================
-- Employee 4-digit PIN authentication
-- Migration: 20260612004
--
-- Adds server-side PIN login for field workers.
--
-- Login flows:
--   First login : company code + ID number → identity verified
--                 → app prompts PIN setup → employee_set_pin()
--                 → session token issued
--   Returning   : company code + employee code + PIN
--                 → employee_sign_in_with_pin()
--                 → session token issued
--   Auto-restore: token only → employee_refresh_code_session()
--                 (token-only, no credential re-check)
--   HR reset    : hr_reset_employee_pin(employee_id)
--                 → clears PIN, revokes all sessions
--                 → employee must re-authenticate with ID number
--
-- Security:
--   • PINs are bcrypt-hashed (pgcrypto, cost 10) — never stored plain
--   • Brute-force lockout: 5 wrong attempts → 15-min lockout
--   • Session refresh is token-only — raw credentials are never re-checked
--   • employee_sign_in_with_code now returns needs_pin_setup flag
--
-- Rollback:
--   ALTER TABLE employees DROP COLUMN pin_hash, pin_set_at,
--     pin_reset_required, pin_failed_attempts, pin_locked_until;
--   ALTER TABLE employee_code_sessions DROP COLUMN login_method;
--   DROP FUNCTION employee_set_pin, employee_sign_in_with_pin,
--     hr_reset_employee_pin;
--   Restore previous employee_refresh_code_session and
--     employee_sign_in_with_code bodies from archive.
-- ============================================================

SET search_path = public;

-- ── 0. pgcrypto for bcrypt ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. PIN columns on employees ───────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pin_hash            text,
  ADD COLUMN IF NOT EXISTS pin_set_at          timestamptz,
  ADD COLUMN IF NOT EXISTS pin_reset_required  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_failed_attempts integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until    timestamptz;

-- ── 2. login_method on employee_code_sessions ────────────────────────────
--   'code'      – legacy employee_code login (pre-PIN)
--   'id_number' – first-login identity verification
--   'pin'       – PIN-authenticated session
ALTER TABLE public.employee_code_sessions
  ADD COLUMN IF NOT EXISTS login_method text NOT NULL DEFAULT 'code';

CREATE INDEX IF NOT EXISTS idx_employee_code_sessions_login_method
  ON public.employee_code_sessions(employee_id, login_method)
  WHERE revoked_at IS NULL;

-- ── 3. employee_set_pin ───────────────────────────────────────────────────
-- Called by the app immediately after first-login identity verification.
-- Receives the plain 4-digit PIN, hashes it with bcrypt, stores the hash,
-- revokes all prior sessions, and issues a fresh PIN-authenticated session.
-- The caller must hold a valid (non-expired, non-revoked) session token
-- that was issued by employee_sign_in_with_code (id_number path).
CREATE OR REPLACE FUNCTION public.employee_set_pin(
  p_session_token text,
  p_pin           text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess  employee_code_sessions%ROWTYPE;
  v_emp   employees%ROWTYPE;
  v_comp  companies%ROWTYPE;
  v_token text;
BEGIN
  -- Validate PIN format: exactly 4 digits
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits'
      USING ERRCODE = '22023', DETAIL = 'invalid_pin_format';
  END IF;

  -- Validate the identity session
  SELECT * INTO v_sess
  FROM public.employee_code_sessions
  WHERE session_token = p_session_token
    AND revoked_at IS NULL
    AND expires_at  > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session invalid or expired. Sign in again with your ID number.'
      USING ERRCODE = '42501', DETAIL = 'session_invalid';
  END IF;

  -- Load employee
  SELECT * INTO v_emp FROM public.employees WHERE id = v_sess.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found'
      USING ERRCODE = '42501', DETAIL = 'employee_not_found';
  END IF;

  -- Load company
  SELECT * INTO v_comp FROM public.companies WHERE id = v_sess.company_id;

  -- Hash the PIN with bcrypt (cost 10) and store it
  UPDATE public.employees
  SET pin_hash            = crypt(p_pin, gen_salt('bf', 10)),
      pin_set_at          = now(),
      pin_reset_required  = false,
      pin_failed_attempts = 0,
      pin_locked_until    = NULL
  WHERE id = v_emp.id;

  -- Revoke all existing sessions for this employee (clean slate)
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = v_emp.id
    AND revoked_at IS NULL;

  -- Issue a new PIN-authenticated session (90-day expiry)
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  INSERT INTO public.employee_code_sessions
    (employee_id, company_id, company_code, employee_login_code, session_token, login_method)
  VALUES
    (v_emp.id, v_comp.id, v_comp.code,
     COALESCE(v_emp.employee_code, ''),
     v_token, 'pin');

  RETURN json_build_object(
    'session_token',   v_token,
    'needs_pin_setup', false,
    'employee', json_build_object(
      'id',                  v_emp.id,
      'company_id',          v_emp.company_id,
      'user_id',             v_emp.user_id,
      'name',                COALESCE(v_emp.name, ''),
      'surname',             COALESCE(v_emp.surname, ''),
      'position',            COALESCE(v_emp.position, ''),
      'branch',              COALESCE(v_emp.branch, ''),
      'access_level',        COALESCE(v_emp.access_level, 'employee'),
      'employee_code',       COALESCE(v_emp.employee_code, ''),
      'registration_status', COALESCE(v_emp.registration_status, 'active'),
      'is_active',           COALESCE(v_emp.is_active, true),
      'login_password_ready', COALESCE(v_emp.login_password_ready, false),
      'pin_set',             true
    ),
    'company', json_build_object(
      'id',   v_comp.id,
      'code', COALESCE(v_comp.code, ''),
      'name', COALESCE(v_comp.name, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_set_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_set_pin(text, text) TO anon, authenticated;

-- ── 4. employee_sign_in_with_pin ──────────────────────────────────────────
-- Subsequent logins: company code + employee code + plain 4-digit PIN.
-- Resolves by employee_code ONLY (not id_number — that is first-login only).
-- Increments failure counter; locks for 15 min after 5 wrong attempts.
CREATE OR REPLACE FUNCTION public.employee_sign_in_with_pin(
  p_company_code  text,
  p_employee_code text,
  p_pin           text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   employees%ROWTYPE;
  v_comp  companies%ROWTYPE;
  v_token text;
BEGIN
  -- Validate PIN format (fail fast, don't burn an attempt)
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'invalid_pin_format';
  END IF;

  -- Resolve company (match same pattern as employee_resolve_by_code)
  SELECT * INTO v_comp
  FROM public.companies c
  WHERE c.code = trim(p_company_code)
     OR (c.code ~ '^\d+$' AND p_company_code ~ '^\d+$'
         AND c.code::bigint = p_company_code::bigint)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'company_not_found';
  END IF;

  -- Resolve employee by employee_code only
  SELECT * INTO v_emp
  FROM public.employees e
  WHERE e.company_id     = v_comp.id
    AND e.employee_code  = trim(p_employee_code)
    AND COALESCE(e.is_active, true) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'employee_not_found';
  END IF;

  -- PIN must be set and not pending reset
  IF v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true THEN
    RAISE EXCEPTION 'PIN not set. Please sign in with your ID number to set up your PIN.'
      USING ERRCODE = '42501', DETAIL = 'pin_not_set';
  END IF;

  -- Check lockout
  IF v_emp.pin_locked_until IS NOT NULL AND v_emp.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked due to too many incorrect attempts. Please try again in 15 minutes.'
      USING ERRCODE = '42501', DETAIL = 'account_locked';
  END IF;

  -- Verify PIN with bcrypt
  IF crypt(p_pin, v_emp.pin_hash) = v_emp.pin_hash THEN

    -- Correct PIN: reset failure counter and issue session
    UPDATE public.employees
    SET pin_failed_attempts = 0,
        pin_locked_until    = NULL
    WHERE id = v_emp.id;

    -- Revoke all prior sessions
    UPDATE public.employee_code_sessions
    SET revoked_at = now()
    WHERE employee_id = v_emp.id
      AND revoked_at IS NULL;

    -- New session token (90-day expiry via table default)
    v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

    INSERT INTO public.employee_code_sessions
      (employee_id, company_id, company_code, employee_login_code, session_token, login_method)
    VALUES
      (v_emp.id, v_comp.id, v_comp.code,
       COALESCE(v_emp.employee_code, ''),
       v_token, 'pin');

    RETURN json_build_object(
      'session_token',   v_token,
      'needs_pin_setup', false,
      'employee', json_build_object(
        'id',                  v_emp.id,
        'company_id',          v_emp.company_id,
        'user_id',             v_emp.user_id,
        'name',                COALESCE(v_emp.name, ''),
        'surname',             COALESCE(v_emp.surname, ''),
        'position',            COALESCE(v_emp.position, ''),
        'branch',              COALESCE(v_emp.branch, ''),
        'access_level',        COALESCE(v_emp.access_level, 'employee'),
        'employee_code',       COALESCE(v_emp.employee_code, ''),
        'registration_status', COALESCE(v_emp.registration_status, 'active'),
        'is_active',           COALESCE(v_emp.is_active, true),
        'login_password_ready', COALESCE(v_emp.login_password_ready, false),
        'pin_set',             true
      ),
      'company', json_build_object(
        'id',   v_comp.id,
        'code', COALESCE(v_comp.code, ''),
        'name', COALESCE(v_comp.name, '')
      )
    );

  ELSE

    -- Wrong PIN: increment counter, lock after 5 failures
    UPDATE public.employees
    SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
        pin_locked_until    = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= 5
            THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END
    WHERE id = v_emp.id;

    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'wrong_pin';

  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_sign_in_with_pin(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_sign_in_with_pin(text, text, text) TO anon, authenticated;

-- ── 5. hr_reset_employee_pin ──────────────────────────────────────────────
-- HR clears an employee's PIN and revokes all active sessions.
-- The employee must re-authenticate with their ID number on next open,
-- then create a new PIN.
-- Caller must be authenticated and belong to the same company with
-- an elevated role (owner, hr_admin, admin, manager) or be an hr_users record.
CREATE OR REPLACE FUNCTION public.hr_reset_employee_pin(
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp employees%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = '42501';
  END IF;

  -- Caller must be in the same company with elevated access
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.user_id    = auth.uid()
        AND e.company_id = v_emp.company_id
        AND e.access_level IN ('owner', 'hr_admin', 'admin', 'manager')
    )
    OR
    EXISTS (
      SELECT 1 FROM public.hr_users h
      WHERE h.user_id    = auth.uid()
        AND h.company_id = v_emp.company_id
        AND COALESCE(h.is_active, true) = true
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to reset employee PINs'
      USING ERRCODE = '42501';
  END IF;

  -- Clear PIN state
  UPDATE public.employees
  SET pin_hash            = NULL,
      pin_set_at          = NULL,
      pin_reset_required  = true,
      pin_failed_attempts = 0,
      pin_locked_until    = NULL
  WHERE id = p_employee_id;

  -- Revoke all active sessions so the employee must re-authenticate
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = p_employee_id
    AND revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_reset_employee_pin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_reset_employee_pin(uuid) TO authenticated;

-- ── 6. employee_refresh_code_session (token-only) ─────────────────────────
-- Replaces the previous version that re-validated employee_login_code
-- (which could be a raw ID number).
-- A valid, non-expired, non-revoked token is now sufficient proof of identity.
-- Also enforces HR PIN-reset: if pin_reset_required=true and the session
-- was a PIN session, revoke it and instruct the client to re-authenticate.
CREATE OR REPLACE FUNCTION public.employee_refresh_code_session(p_session_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sess employee_code_sessions%ROWTYPE;
  v_emp  employees%ROWTYPE;
  v_comp companies%ROWTYPE;
BEGIN
  -- Validate token
  SELECT * INTO v_sess
  FROM public.employee_code_sessions
  WHERE session_token = p_session_token
    AND revoked_at IS NULL
    AND expires_at  > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code session expired or invalid'
      USING DETAIL = 'session_invalid';
  END IF;

  -- Load employee
  SELECT * INTO v_emp FROM public.employees WHERE id = v_sess.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee no longer exists'
      USING DETAIL = 'employee_not_found';
  END IF;

  -- Enforce HR PIN reset: revoke PIN sessions and instruct re-auth
  IF v_emp.pin_reset_required = true AND v_sess.login_method = 'pin' THEN
    UPDATE public.employee_code_sessions
    SET revoked_at = now()
    WHERE id = v_sess.id;
    RAISE EXCEPTION 'Your PIN has been reset by HR. Please sign in with your ID number to set a new PIN.'
      USING DETAIL = 'pin_reset_required';
  END IF;

  -- Check account is active
  IF NOT COALESCE(v_emp.is_active, true)
     AND COALESCE(v_emp.registration_status, 'active') <> 'pending' THEN
    RAISE EXCEPTION 'Account is not active'
      USING DETAIL = 'account_inactive';
  END IF;

  -- Load company
  SELECT * INTO v_comp FROM public.companies WHERE id = v_sess.company_id;

  -- Touch last_seen_at
  UPDATE public.employee_code_sessions
  SET last_seen_at = now()
  WHERE id = v_sess.id;

  RETURN json_build_object(
    'session_token',   v_sess.session_token,
    'needs_pin_setup', (v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true),
    'employee', json_build_object(
      'id',                  v_emp.id,
      'company_id',          v_emp.company_id,
      'user_id',             v_emp.user_id,
      'name',                COALESCE(v_emp.name, ''),
      'surname',             COALESCE(v_emp.surname, ''),
      'position',            COALESCE(v_emp.position, ''),
      'branch',              COALESCE(v_emp.branch, ''),
      'access_level',        COALESCE(v_emp.access_level, 'employee'),
      'employee_code',       COALESCE(v_emp.employee_code, ''),
      'registration_status', COALESCE(v_emp.registration_status, 'active'),
      'is_active',           COALESCE(v_emp.is_active, true),
      'login_password_ready', COALESCE(v_emp.login_password_ready, false),
      'pin_set',             (v_emp.pin_hash IS NOT NULL AND v_emp.pin_reset_required = false)
    ),
    'company', json_build_object(
      'id',   v_comp.id,
      'code', COALESCE(v_comp.code, ''),
      'name', COALESCE(v_comp.name, '')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_refresh_code_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_refresh_code_session(text) TO anon, authenticated;

-- ── 7. employee_sign_in_with_code — add needs_pin_setup flag ─────────────
-- Preserves existing identity-verification behaviour (employee_code, id_number,
-- temp_login_code all still work). Adds needs_pin_setup and pin_set to the
-- response so the client can route to PIN setup immediately after ID-number auth.
-- Also stamps login_method on the new session row.
CREATE OR REPLACE FUNCTION public.employee_sign_in_with_code(
  p_company_code  text,
  p_employee_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v          record;
  v_token    text;
  v_mbr      json;
  v_pin_set  boolean;
  v_needs_setup boolean;
  v_method   text;
BEGIN
  SELECT * INTO v
  FROM public.employee_resolve_by_code(p_company_code, p_employee_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid company code or login code';
  END IF;

  IF v.registration_status = 'rejected' THEN
    RAISE EXCEPTION 'Registration was declined for this company';
  END IF;

  IF NOT v.is_active AND v.registration_status <> 'pending' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  -- Determine PIN state
  SELECT
    (e.pin_hash IS NOT NULL AND e.pin_reset_required = false),
    (e.pin_hash IS NULL OR e.pin_reset_required = true)
  INTO v_pin_set, v_needs_setup
  FROM public.employees e WHERE e.id = v.employee_id;

  -- Determine login_method from what was supplied
  v_method := CASE
    WHEN v.employee_code = trim(p_employee_code) THEN 'code'
    ELSE 'id_number'
  END;

  -- Revoke all prior sessions
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = v.employee_id
    AND revoked_at IS NULL;

  -- Issue new session
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  INSERT INTO public.employee_code_sessions
    (employee_id, company_id, company_code, employee_login_code, session_token, login_method)
  VALUES
    (v.employee_id, v.company_id, v.company_code,
     trim(p_employee_code),
     v_token, v_method);

  v_mbr := public.employee_get_my_memberships_by_code(p_company_code, p_employee_code);

  RETURN json_build_object(
    'session_token',   v_token,
    'needs_pin_setup', COALESCE(v_needs_setup, true),
    'employee', json_build_object(
      'id',                  v.employee_id,
      'company_id',          v.company_id,
      'user_id',             v.emp_user_id,
      'name',                v.emp_name,
      'surname',             v.emp_surname,
      'position',            v.emp_position,
      'branch',              v.emp_branch,
      'access_level',        v.access_level,
      'employee_code',       v.employee_code,
      'registration_status', v.registration_status,
      'is_active',           v.is_active,
      'login_password_ready', v.login_password_ready,
      'pin_set',             COALESCE(v_pin_set, false)
    ),
    'company', json_build_object(
      'id',   v.company_id,
      'code', v.company_code,
      'name', v.company_name
    ),
    'memberships', v_mbr
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_sign_in_with_code(text, text) TO anon, authenticated;

-- ── 8. Index on pin_locked_until for lockout checks ─────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_pin_locked
  ON public.employees(id)
  WHERE pin_locked_until IS NOT NULL;
;
