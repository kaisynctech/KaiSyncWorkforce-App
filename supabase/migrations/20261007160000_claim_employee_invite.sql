-- Link an authenticated invitee (magic link / OTP) to their pre-created
-- employees row. Clients cannot UPDATE employees.user_id directly.

CREATE OR REPLACE FUNCTION public.claim_employee_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_meta_id text;
  v_emp public.employees%ROWTYPE;
  v_role text;
  v_found boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(trim(u.email))
  INTO v_email
  FROM auth.users u
  WHERE u.id = v_uid;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated user has no email';
  END IF;

  v_meta_id := nullif(
    trim(coalesce(
      (auth.jwt() -> 'user_metadata' ->> 'invited_employee_id'),
      ''
    )),
    ''
  );

  IF v_meta_id IS NOT NULL AND v_meta_id ~* '^[0-9a-f-]{36}$' THEN
    SELECT * INTO v_emp
    FROM public.employees e
    WHERE e.id = v_meta_id::uuid
      AND e.is_active = true
      AND lower(trim(coalesce(e.email, ''))) = v_email
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    SELECT * INTO v_emp
    FROM public.employees e
    WHERE e.is_active = true
      AND lower(trim(coalesce(e.email, ''))) = v_email
      AND e.user_id IS NULL
    ORDER BY e.created_at ASC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    SELECT * INTO v_emp
    FROM public.employees e
    WHERE e.is_active = true
      AND e.user_id = v_uid
      AND lower(trim(coalesce(e.email, ''))) = v_email
    ORDER BY e.created_at ASC
    LIMIT 1;
    v_found := FOUND;
  END IF;

  IF NOT v_found THEN
    RAISE EXCEPTION 'No employee invite found for this email. Ask HR to send an invite.';
  END IF;

  IF v_emp.user_id IS NOT NULL AND v_emp.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'This employee is already linked to another login account.';
  END IF;

  UPDATE public.employees
  SET user_id = v_uid
  WHERE id = v_emp.id
    AND (user_id IS NULL OR user_id = v_uid);

  v_role := CASE lower(coalesce(v_emp.access_level, 'employee'))
    WHEN 'owner' THEN 'owner'
    WHEN 'hr' THEN 'hr'
    WHEN 'hr_admin' THEN 'hr'
    WHEN 'admin' THEN 'hr'
    WHEN 'manager' THEN 'manager'
    ELSE 'employee'
  END;

  INSERT INTO public.company_relationships (user_id, company_id, role, is_active)
  VALUES (v_uid, v_emp.company_id, v_role, true)
  ON CONFLICT (user_id, company_id)
  DO UPDATE SET is_active = true, role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'employee_id', v_emp.id,
    'company_id', v_emp.company_id,
    'access_level', v_emp.access_level,
    'login_password_ready', coalesce(v_emp.login_password_ready, false),
    'email', v_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_employee_invite() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_employee_invite() TO authenticated;

COMMENT ON FUNCTION public.claim_employee_invite() IS
  'After magic-link invite, bind auth.uid() to the matching employees row and sync company_relationships.';
