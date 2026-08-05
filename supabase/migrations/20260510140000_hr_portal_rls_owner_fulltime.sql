-- HR portal (authenticated JWT + anon key) must SELECT employees/companies/hr_users for the
-- signed-in user's company. The peer-only policy (profile_id = auth.uid()) is insufficient when
-- profile_id is null/out-of-sync — yields empty employee lists and settings failures.
--
-- Also tag bootstrap owner rows as full-time (access_level stays hr_admin; worker_type stays
-- 'employee' per employees_worker_type_chk — payroll taxonomy; HR authority is hr_users.role).

DROP POLICY IF EXISTS p_employees_hr_select_company ON public.employees;
CREATE POLICY p_employees_hr_select_company ON public.employees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hr_users h
      WHERE h.auth_user_id = auth.uid()
        AND COALESCE(h.is_active, false) = true
        AND h.company_id = employees.company_id
    )
  );
DROP POLICY IF EXISTS p_companies_hr_select ON public.companies;
CREATE POLICY p_companies_hr_select ON public.companies
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hr_users h
      WHERE h.auth_user_id = auth.uid()
        AND COALESCE(h.is_active, false) = true
        AND h.company_id = companies.id
    )
  );
DROP POLICY IF EXISTS p_hr_users_hr_select_company ON public.hr_users;
CREATE POLICY p_hr_users_hr_select_company ON public.hr_users
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hr_users me
      WHERE me.auth_user_id = auth.uid()
        AND COALESCE(me.is_active, false) = true
        AND me.company_id = hr_users.company_id
    )
  );
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_branches'
  ) THEN
    EXECUTE $pol$
      DROP POLICY IF EXISTS p_company_branches_hr_select ON public.company_branches;
      CREATE POLICY p_company_branches_hr_select ON public.company_branches
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.hr_users h
            WHERE h.auth_user_id = auth.uid()
              AND COALESCE(h.is_active, false) = true
              AND h.company_id = company_branches.company_id
          )
        );
    $pol$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_employee_types'
  ) THEN
    EXECUTE $pol$
      DROP POLICY IF EXISTS p_company_employee_types_hr_select ON public.company_employee_types;
      CREATE POLICY p_company_employee_types_hr_select ON public.company_employee_types
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.hr_users h
            WHERE h.auth_user_id = auth.uid()
              AND COALESCE(h.is_active, false) = true
              AND h.company_id = company_employee_types.company_id
          )
        );
    $pol$;
  END IF;
END $$;
-- Backfill owner-linked bootstrap employee rows to full-time.
UPDATE public.employees e
SET employment_type = 'full-time',
    employment_type_label = 'Full-time'
WHERE e.position = 'Company owner'
  AND e.access_level = 'hr_admin'
  AND EXISTS (
    SELECT 1 FROM public.hr_users h
    WHERE h.company_id = e.company_id
      AND h.auth_user_id IS NOT DISTINCT FROM e.profile_id
      AND h.role = 'owner'
  );
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

  v_ecode := 'KW' || lpad(v_company_id::text, 10, '0');

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
    'full-time',
    'Full-time',
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
