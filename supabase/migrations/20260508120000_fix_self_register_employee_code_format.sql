-- Bootstrap HR owner row used employee_code = company_code || '-OWNER' (e.g. "01-OWNER").
-- deployments often have employees_employee_code_format_chk matching national-ID style patterns,
-- which rejects hyphens or mixed layouts. Replace with a practical rule and a clearer synthetic code.

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_code_format_chk;

ALTER TABLE public.employees ADD CONSTRAINT employees_employee_code_format_chk CHECK (
  employee_code IS NULL OR (
    char_length(trim(employee_code)) BETWEEN 2 AND 48
    AND trim(employee_code) !~ '[^A-Za-z0-9\-]'
  )
);

COMMENT ON CONSTRAINT employees_employee_code_format_chk ON public.employees IS
  'Allows letters, digits, hyphen (national IDs / internal bootstrap codes like KW…).';

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

  -- Synthetic bootstrap ID (KW = KaiSync Workforce internal owner placeholder).
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
