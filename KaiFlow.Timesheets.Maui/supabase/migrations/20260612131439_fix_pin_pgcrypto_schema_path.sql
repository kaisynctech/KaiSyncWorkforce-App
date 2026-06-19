-- ============================================================
-- Fix: pgcrypto schema path for PIN hashing functions
-- Migration: 20260612005
--
-- Root cause: Supabase installs pgcrypto in the 'extensions' schema.
-- employee_set_pin and employee_sign_in_with_pin both use
-- SET search_path = public which hides 'extensions', causing:
--   "function gen_salt(unknown, integer) does not exist"
--   "function crypt(text, text) does not exist"
--
-- Fix: qualify all pgcrypto calls with extensions. prefix.
-- ============================================================

SET search_path = public;

-- ── Fix employee_set_pin ──────────────────────────────────────────────────────
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
  -- extensions. prefix required because SET search_path = public hides extensions schema
  UPDATE public.employees
  SET pin_hash            = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
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

-- ── Fix employee_sign_in_with_pin ─────────────────────────────────────────────
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

  -- Resolve company
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
  WHERE e.company_id    = v_comp.id
    AND e.employee_code = trim(p_employee_code)
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
  -- extensions. prefix required because SET search_path = public hides extensions schema
  IF extensions.crypt(p_pin, v_emp.pin_hash) = v_emp.pin_hash THEN

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
