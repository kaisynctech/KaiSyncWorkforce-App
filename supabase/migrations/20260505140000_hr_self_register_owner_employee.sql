-- Self-register: create company HR mapping + seed owner employee linked to auth user.
-- Optional: transfer HR company ownership to another HR account.

CREATE SEQUENCE IF NOT EXISTS public.company_code_seq;
DO $$
DECLARE
  v_start bigint;
BEGIN
  SELECT COALESCE(MAX(company_code::bigint), 0) + 1
  INTO v_start
  FROM public.companies
  WHERE company_code ~ '^[0-9]+$';

  IF v_start < 1 THEN
    v_start := 1;
  END IF;

  PERFORM setval('public.company_code_seq', v_start, FALSE);
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
ALTER TABLE public.hr_users DROP CONSTRAINT IF EXISTS hr_users_role_chk;
UPDATE public.hr_users
SET role = 'admin'
WHERE role IS NOT NULL
  AND role NOT IN (
    'owner',
    'admin',
    'manager',
    'payroll',
    'viewer',
    'hr_admin',
    'hr'
  );
ALTER TABLE public.hr_users ADD CONSTRAINT hr_users_role_chk CHECK (
  role IN ('owner', 'admin', 'manager', 'payroll', 'viewer', 'hr_admin', 'hr')
);
DROP FUNCTION IF EXISTS public.self_register_company(text);
CREATE OR REPLACE FUNCTION public.self_register_company(
  p_company_name text,
  p_owner_first_name text DEFAULT '',
  p_owner_last_name text DEFAULT ''
)
RETURNS TABLE (
  company_id bigint,
  company_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_code text;
  v_company_id bigint;
  v_email text;
  v_fn text;
  v_ln text;
  v_ecode text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to register a company.';
  END IF;

  IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'Company name is required.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hr_users h
    WHERE h.auth_user_id = v_uid
      AND h.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'This HR account is already mapped to a company.';
  END IF;

  SELECT au.email INTO v_email
  FROM auth.users au
  WHERE au.id = v_uid;

  v_fn := COALESCE(NULLIF(btrim(p_owner_first_name), ''), split_part(v_email, '@', 1));
  v_ln := COALESCE(NULLIF(btrim(p_owner_last_name), ''), '');

  LOOP
    v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
    BEGIN
      INSERT INTO public.companies (name, company_code, plan_code, trial_started_at)
      VALUES (btrim(p_company_name), v_code, 'free_trial', now())
      RETURNING id INTO v_company_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        CONTINUE;
    END;
  END LOOP;

  INSERT INTO public.hr_users (
    auth_user_id,
    company_id,
    role,
    is_active,
    display_name
  ) VALUES (
    v_uid,
    v_company_id,
    'owner',
    TRUE,
    NULLIF(btrim(v_fn || ' ' || v_ln), '')
  );

  v_ecode := v_code || '-OWNER';

  INSERT INTO public.employees (
    company_id,
    name,
    surname,
    employee_code,
    employment_date,
    employment_type,
    employment_type_label,
    position,
    monthly_salary,
    hourly_rate,
    weekly_rate,
    daily_rate,
    work_days_weekly,
    daily_hours,
    branch,
    access_level,
    worker_type,
    invite_status,
    profile_id,
    email
  ) VALUES (
    v_company_id,
    v_fn,
    v_ln,
    v_ecode,
    CURRENT_DATE,
    'part-time',
    'Part-time',
    'Company owner',
    0,
    0,
    0,
    0,
    5,
    8,
    '',
    'hr_admin',
    'employee',
    'accepted',
    v_uid,
    lower(trim(v_email))
  );

  RETURN QUERY
  SELECT v_company_id, v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.self_register_company(text, text, text)
  TO authenticated;
CREATE OR REPLACE FUNCTION public.transfer_hr_company_owner(
  p_company_id bigint,
  p_new_owner_auth_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid;
BEGIN
  v_me := auth.uid();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_new_owner_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'New owner required';
  END IF;

  IF p_new_owner_auth_user_id = v_me THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hr_users h
    WHERE h.company_id = p_company_id
      AND h.auth_user_id = v_me
      AND h.is_active = TRUE
      AND h.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only the company owner can transfer ownership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hr_users h
    WHERE h.company_id = p_company_id
      AND h.auth_user_id = p_new_owner_auth_user_id
      AND h.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'New owner must be an active HR user in this company';
  END IF;

  UPDATE public.hr_users
  SET role = CASE
      WHEN auth_user_id = v_me THEN 'admin'
      WHEN auth_user_id = p_new_owner_auth_user_id THEN 'owner'
      ELSE role
    END
  WHERE company_id = p_company_id
    AND auth_user_id IN (v_me, p_new_owner_auth_user_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_hr_company_owner(bigint, uuid)
  TO authenticated;
