
-- ============================================================
-- ARCH-003 Migration 2: Lockout RPCs
-- 2026-06-18
-- ============================================================

-- ── employee_sign_in_with_code: rebuild with lockout logic ───
CREATE OR REPLACE FUNCTION public.employee_sign_in_with_code(p_company_code text, p_employee_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v             record;
  v_comp_id     uuid;
  v_token       text;
  v_mbr         json;
  v_pin_set     boolean;
  v_needs_setup boolean;
  v_method      text;
  v_threshold   integer;
  v_new_count   integer;
BEGIN
  -- 1. Pre-lookup company (to get company_id for lockout tracking)
  SELECT c.id INTO v_comp_id
  FROM public.companies c
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
     OR (c.code ~ '^\d+$' AND p_company_code ~ '^\d+$'
         AND c.code::bigint = p_company_code::bigint)
  LIMIT 1;

  -- 2. If company found, get threshold and check lockout
  IF v_comp_id IS NOT NULL THEN
    SELECT COALESCE((cs.security_settings->>'lockout_threshold')::integer, 5)
    INTO v_threshold
    FROM public.company_settings cs
    WHERE cs.company_id = v_comp_id;
    v_threshold := COALESCE(v_threshold, 5);

    -- Check today's attempt record for this (company, employee_code) pair
    IF EXISTS (
      SELECT 1 FROM public.code_login_attempts
      WHERE company_id    = v_comp_id
        AND employee_code = trim(p_employee_code)
        AND attempt_date  = CURRENT_DATE
        AND locked_until  IS NOT NULL
        AND locked_until  > now()
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_LOCKED: Too many failed sign-in attempts. Please try again later.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_threshold := 5;
  END IF;

  -- 3. Attempt resolve (existing logic unchanged)
  SELECT * INTO v
  FROM public.employee_resolve_by_code(p_company_code, p_employee_code)
  LIMIT 1;

  IF NOT FOUND THEN
    -- 4. Resolve failed: increment attempt counter if company was identified
    IF v_comp_id IS NOT NULL THEN
      INSERT INTO public.code_login_attempts
        (company_id, employee_code, attempt_date, failed_attempts, last_attempt_at)
      VALUES
        (v_comp_id, trim(p_employee_code), CURRENT_DATE, 1, now())
      ON CONFLICT (company_id, employee_code, attempt_date) DO UPDATE
        SET failed_attempts = code_login_attempts.failed_attempts + 1,
            last_attempt_at = now();

      SELECT failed_attempts INTO v_new_count
      FROM public.code_login_attempts
      WHERE company_id    = v_comp_id
        AND employee_code = trim(p_employee_code)
        AND attempt_date  = CURRENT_DATE;

      IF v_new_count >= v_threshold THEN
        UPDATE public.code_login_attempts
        SET locked_until = now() + INTERVAL '15 minutes'
        WHERE company_id    = v_comp_id
          AND employee_code = trim(p_employee_code)
          AND attempt_date  = CURRENT_DATE;

        -- Audit the lockout
        BEGIN
          PERFORM public.write_audit_event(
            v_comp_id,
            'login_lockout',
            'code',
            trim(p_employee_code),
            NULL,
            jsonb_build_object('failed_attempts', v_new_count, 'locked_until', now() + INTERVAL '15 minutes')
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;

    RAISE EXCEPTION 'Invalid company code or login code';
  END IF;

  -- 5. Resolve succeeded: check unified account lock
  IF EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = v.employee_id AND is_account_locked = true
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED: Your account has been locked. Contact your HR administrator to unlock it.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. Existing status checks (preserved from original)
  IF v.registration_status = 'rejected' THEN
    RAISE EXCEPTION 'Registration was declined for this company';
  END IF;

  IF NOT v.is_active AND v.registration_status <> 'pending' THEN
    RAISE EXCEPTION 'Account is not active';
  END IF;

  -- 7. Reset today's attempt counter on successful sign-in
  IF v_comp_id IS NOT NULL THEN
    UPDATE public.code_login_attempts
    SET failed_attempts = 0,
        locked_until    = NULL
    WHERE company_id    = v_comp_id
      AND employee_code = trim(p_employee_code)
      AND attempt_date  = CURRENT_DATE;
  END IF;

  SELECT
    (e.pin_hash IS NOT NULL AND e.pin_reset_required = false),
    (e.pin_hash IS NULL OR e.pin_reset_required = true)
  INTO v_pin_set, v_needs_setup
  FROM public.employees e WHERE e.id = v.employee_id;

  v_method := CASE
    WHEN v.employee_code = trim(p_employee_code) THEN 'code'
    ELSE 'id_number'
  END;

  -- Only revoke non-PIN sessions (preserve active PIN sessions)
  UPDATE public.employee_code_sessions
  SET revoked_at = now()
  WHERE employee_id  = v.employee_id
    AND revoked_at   IS NULL
    AND login_method IN ('code', 'id_number');

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  INSERT INTO public.employee_code_sessions
    (employee_id, company_id, company_code, employee_login_code, session_token, login_method)
  VALUES
    (v.employee_id, v.company_id, v.company_code,
     trim(p_employee_code), v_token, v_method);

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

-- ── employee_sign_in_with_pin: add is_account_locked gate + HR-unlock model ─
CREATE OR REPLACE FUNCTION public.employee_sign_in_with_pin(p_company_code text, p_employee_id uuid, p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_comp      companies%ROWTYPE;
  v_emp       employees%ROWTYPE;
  v_token     text;
  v_threshold integer;
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

  -- ARCH-003: Unified lock gate — checked BEFORE per-method lockout
  IF v_emp.is_account_locked = true THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED: Your account has been locked. Contact your HR administrator to unlock it.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true THEN
    RAISE EXCEPTION 'PIN not set. Please sign in with your ID number to set up your PIN.'
      USING ERRCODE = '42501', DETAIL = 'pin_not_set';
  END IF;

  -- Legacy time-based lock check (kept for compatibility; is_account_locked is primary gate)
  IF v_emp.pin_locked_until IS NOT NULL AND v_emp.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked due to too many incorrect attempts. Please try again later.'
      USING ERRCODE = '42501', DETAIL = 'account_locked';
  END IF;

  -- Read threshold from company settings
  SELECT COALESCE((cs.security_settings->>'lockout_threshold')::integer, 5)
  INTO v_threshold
  FROM public.company_settings cs
  WHERE cs.company_id = v_comp.id;
  v_threshold := COALESCE(v_threshold, 5);

  IF extensions.crypt(p_pin, v_emp.pin_hash) = v_emp.pin_hash THEN
    -- Correct PIN: reset counters
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
       COALESCE(v_emp.employee_code, ''), v_token, 'pin');

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
    -- Wrong PIN: increment, apply threshold lock
    UPDATE public.employees
    SET pin_failed_attempts = COALESCE(pin_failed_attempts, 0) + 1,
        pin_locked_until    = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold
            THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END,
        is_account_locked   = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN true
          ELSE is_account_locked
        END,
        locked_at           = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN now()
          ELSE locked_at
        END,
        locked_reason       = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN 'pin_attempts'
          ELSE locked_reason
        END
    WHERE id = v_emp.id;

    RAISE EXCEPTION 'Incorrect PIN. Please try again.'
      USING ERRCODE = '42501', DETAIL = 'wrong_pin';
  END IF;
END;
$$;

-- ── employee_verify_pin: same lockout additions ──────────────
CREATE OR REPLACE FUNCTION public.employee_verify_pin(p_session_token text, p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sess  employee_code_sessions%ROWTYPE;
  v_emp   employees%ROWTYPE;
  v_comp  companies%ROWTYPE;
  v_token text;
  v_threshold integer;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'invalid_pin_format';
  END IF;

  SELECT * INTO v_sess
  FROM public.employee_code_sessions
  WHERE session_token = p_session_token
    AND revoked_at IS NULL
    AND expires_at  > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session expired. Please sign in again with your ID number.'
      USING ERRCODE = '42501', DETAIL = 'session_invalid';
  END IF;

  SELECT * INTO v_emp FROM public.employees WHERE id = v_sess.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials'
      USING ERRCODE = '42501', DETAIL = 'employee_not_found';
  END IF;

  SELECT * INTO v_comp FROM public.companies WHERE id = v_sess.company_id;

  -- ARCH-003: Unified lock gate
  IF v_emp.is_account_locked = true THEN
    RAISE EXCEPTION 'ACCOUNT_LOCKED: Your account has been locked. Contact your HR administrator to unlock it.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_emp.pin_hash IS NULL OR v_emp.pin_reset_required = true THEN
    RAISE EXCEPTION 'PIN not set. Please sign in with your ID number to set a new PIN.'
      USING ERRCODE = '42501', DETAIL = 'pin_not_set';
  END IF;

  IF v_emp.pin_locked_until IS NOT NULL AND v_emp.pin_locked_until > now() THEN
    RAISE EXCEPTION 'Account temporarily locked due to too many incorrect attempts. Please try again later.'
      USING ERRCODE = '42501', DETAIL = 'account_locked';
  END IF;

  -- Read threshold from company settings
  SELECT COALESCE((cs.security_settings->>'lockout_threshold')::integer, 5)
  INTO v_threshold
  FROM public.company_settings cs
  WHERE cs.company_id = v_sess.company_id;
  v_threshold := COALESCE(v_threshold, 5);

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
       COALESCE(v_emp.employee_code, ''), v_token, 'pin');

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
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold
            THEN now() + interval '15 minutes'
          ELSE pin_locked_until
        END,
        is_account_locked   = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN true
          ELSE is_account_locked
        END,
        locked_at           = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN now()
          ELSE locked_at
        END,
        locked_reason       = CASE
          WHEN COALESCE(pin_failed_attempts, 0) + 1 >= v_threshold THEN 'pin_attempts'
          ELSE locked_reason
        END
    WHERE id = v_emp.id;

    RAISE EXCEPTION 'Incorrect PIN. Please try again.'
      USING ERRCODE = '42501', DETAIL = 'wrong_pin';
  END IF;
END;
$$;

-- ── hr_unlock_employee ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_unlock_employee(p_company_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: only hr or owner may unlock employee accounts'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.employees
  SET is_account_locked     = false,
      locked_at             = NULL,
      locked_reason         = NULL,
      login_failed_attempts  = 0,
      pin_failed_attempts   = 0,
      pin_locked_until      = NULL
  WHERE id         = p_employee_id
    AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    PERFORM public.write_audit_event(
      p_company_id, 'employee_unlocked', 'employee', p_employee_id::text,
      NULL, jsonb_build_object('is_account_locked', false)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_unlock_employee(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_unlock_employee(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_unlock_employee(uuid, uuid) TO authenticated;

-- ── hr_get_locked_employees ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_locked_employees(p_company_id uuid)
RETURNS TABLE (
  employee_id   uuid,
  full_name     text,
  locked_at     timestamptz,
  locked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT e.id, e.full_name, e.locked_at, e.locked_reason
  FROM public.employees e
  WHERE e.company_id        = p_company_id
    AND e.is_account_locked = true
  ORDER BY e.locked_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_get_locked_employees(uuid) TO authenticated;
;
