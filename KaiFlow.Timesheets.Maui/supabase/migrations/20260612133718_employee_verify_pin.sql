-- ============================================================
-- PIN flow redesign: session-token-based PIN verification
-- Migration: 20260612006
--
-- Root causes fixed:
--
-- 1. employee_sign_in_with_code revoked ALL sessions on login,
--    including active PIN sessions. This nuked the employee's
--    valid PIN session every time they re-entered their ID.
--    Fix: only revoke non-PIN sessions (code, id_number).
--
-- 2. employee_sign_in_with_pin looked up the employee by
--    employee_code, which is empty ("") for many employees.
--    This is fragile and caused "Incorrect PIN" / "not found"
--    errors even when the PIN was correct.
--    Fix: new employee_verify_pin(session_token, pin) that
--    identifies the employee via the session (not employee_code).
--
-- New flow for returning employees (pin_set = true):
--   employee_sign_in_with_code → id_number session (NOT stored)
--   → app routes to PIN entry with sessionToken param
--   → employee_verify_pin(session_token, pin)
--   → verifies bcrypt, issues pin session → stored in client
-- ============================================================

SET search_path = public;

-- ── 1. Fix employee_sign_in_with_code ────────────────────────────────────────
-- Only revoke non-PIN sessions so an active PIN session is preserved.
-- Previously: UPDATE ... WHERE revoked_at IS NULL  (killed everything)
-- Now:        UPDATE ... WHERE revoked_at IS NULL AND login_method IN ('code','id_number')
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

  -- Only revoke non-PIN sessions — preserve active PIN sessions.
  -- Previously this revoked ALL sessions which destroyed a valid
  -- PIN session every time the user re-entered their ID number.
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id = v.employee_id
    AND revoked_at IS NULL
    AND login_method IN ('code', 'id_number');

  -- Issue new identity-verification session
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

-- ── 2. employee_verify_pin ────────────────────────────────────────────────────
-- Second factor for returning employees after employee_sign_in_with_code.
-- The caller holds a valid id_number (or code) session token.
-- This function:
--   • Resolves the employee from the session (no employee_code lookup)
--   • Verifies the 4-digit PIN with bcrypt
--   • Enforces 5-attempt lockout (15-minute window)
--   • On success: revokes the old session, issues a new pin session
--   • On failure: increments failed attempts, locks if threshold reached
CREATE OR REPLACE FUNCTION public.employee_verify_pin(
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
  -- Validate PIN format (fail fast before any DB work)
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'invalid_pin_format';
  END IF;

  -- Validate the identity session
  SELECT * INTO v_sess
  FROM public.employee_code_sessions
  WHERE session_token = p_session_token
    AND revoked_at IS NULL
    AND expires_at  > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session expired. Please sign in again with your ID number.'
      USING ERRCODE = '42501', DETAIL = 'session_invalid';
  END IF;

  -- Load employee via session (no employee_code lookup)
  SELECT * INTO v_emp FROM public.employees WHERE id = v_sess.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'employee_not_found';
  END IF;

  -- Load company
  SELECT * INTO v_comp FROM public.companies WHERE id = v_sess.company_id;

  -- PIN must be set and not pending HR reset
  IF v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true THEN
    RAISE EXCEPTION 'PIN not set. Please sign in with your ID number to set a new PIN.'
      USING ERRCODE = '42501', DETAIL = 'pin_not_set';
  END IF;

  -- Check lockout
  IF v_emp.pin_locked_until IS NOT NULL AND v_emp.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked due to too many incorrect attempts. Please try again in 15 minutes.'
      USING ERRCODE = '42501', DETAIL = 'account_locked';
  END IF;

  -- Verify PIN with bcrypt
  -- extensions. prefix required: SET search_path = public hides extensions schema
  IF extensions.crypt(p_pin, v_emp.pin_hash) = v_emp.pin_hash THEN

    -- ✅ Correct PIN: reset failure counters
    UPDATE public.employees
    SET pin_failed_attempts = 0,
        pin_locked_until    = NULL
    WHERE id = v_emp.id;

    -- Revoke all existing sessions for this employee
    UPDATE public.employee_code_sessions
    SET revoked_at = now()
    WHERE employee_id = v_emp.id
      AND revoked_at IS NULL;

    -- Issue new PIN-authenticated session (90-day expiry via table default)
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

    -- ❌ Wrong PIN: increment counter, lock after 5 failures
    UPDATE public.employees
    SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
        pin_locked_until    = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= 5
            THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END
    WHERE id = v_emp.id;

    RAISE EXCEPTION 'Incorrect PIN. Please try again.'
      USING ERRCODE = '42501', DETAIL = 'wrong_pin';

  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_verify_pin(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_verify_pin(text, text) TO anon, authenticated;
