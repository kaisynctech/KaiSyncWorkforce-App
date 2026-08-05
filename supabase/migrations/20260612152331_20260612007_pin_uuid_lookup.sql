SET search_path = public;

DROP FUNCTION IF EXISTS public.employee_sign_in_with_pin(text, text, text);

CREATE OR REPLACE FUNCTION public.employee_sign_in_with_pin(
  p_company_code  text,
  p_employee_id   uuid,
  p_pin           text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp  companies%ROWTYPE;
  v_emp   employees%ROWTYPE;
  v_token text;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'invalid_pin_format';
  END IF;

  SELECT * INTO v_comp
  FROM public.companies c
  WHERE trim(c.code) = trim(upper(p_company_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'company_not_found';
  END IF;

  SELECT * INTO v_emp
  FROM public.employees e
  WHERE e.id         = p_employee_id
    AND e.company_id = v_comp.id
    AND COALESCE(e.is_active, true) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'employee_not_found';
  END IF;

  IF v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true THEN
    RAISE EXCEPTION 'PIN not set. Please sign in with your ID number to set up your PIN.'
      USING ERRCODE = '42501', DETAIL = 'pin_not_set';
  END IF;

  IF v_emp.pin_locked_until IS NOT NULL AND v_emp.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked due to too many incorrect attempts. Please try again in 15 minutes.'
      USING ERRCODE = '42501', DETAIL = 'account_locked';
  END IF;

  IF extensions.crypt(p_pin, v_emp.pin_hash) = v_emp.pin_hash THEN

    UPDATE public.employees
    SET pin_failed_attempts = 0,
        pin_locked_until    = NULL
    WHERE id = v_emp.id;

    UPDATE public.employee_code_sessions
    SET revoked_at = now()
    WHERE employee_id = v_emp.id
      AND revoked_at IS NULL;

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

REVOKE ALL ON FUNCTION public.employee_sign_in_with_pin(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_sign_in_with_pin(text, uuid, text) TO anon, authenticated;;
