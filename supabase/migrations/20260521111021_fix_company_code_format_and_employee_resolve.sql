
-- 1. Update existing company code "0028" → "28", owner code "0028-OWNER" → "28-OWNER"
UPDATE public.companies SET code = '28' WHERE code = '0028';
UPDATE public.employees SET employee_code = '28-OWNER' WHERE employee_code = '0028-OWNER';

-- 2. Update self_register_company to use 2-digit codes
CREATE OR REPLACE FUNCTION public.self_register_company(
    p_company_name text,
    p_owner_first_name text DEFAULT ''::text,
    p_owner_last_name text DEFAULT ''::text,
    p_role text DEFAULT 'owner'::text
)
RETURNS TABLE(company_id uuid, company_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_uid        uuid;
    v_code       text;
    v_company_id uuid;
    v_email      text;
    v_fn         text;
    v_ln         text;
    v_ecode      text;
    v_safe_role  text;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to register a company.';
    END IF;

    IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
        RAISE EXCEPTION 'Company name is required.';
    END IF;

    v_safe_role := CASE WHEN p_role IN ('owner','hr_admin','hr') THEN p_role ELSE 'hr_admin' END;

    IF v_safe_role = 'owner' AND EXISTS (
        SELECT 1 FROM public.company_relationships
        WHERE user_id = v_uid AND role = 'owner' AND is_active = true
    ) THEN
        RAISE EXCEPTION 'This account has already registered a company as owner.';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    v_fn := COALESCE(NULLIF(btrim(p_owner_first_name), ''), split_part(v_email, '@', 1));
    v_ln := COALESCE(NULLIF(btrim(p_owner_last_name), ''), '');

    LOOP
        v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
        BEGIN
            INSERT INTO public.companies (name, code, plan_code, trial_started_at, owner_user_id)
            VALUES (btrim(p_company_name), v_code, 'free_trial', now(), v_uid)
            RETURNING id INTO v_company_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            CONTINUE;
        END;
    END LOOP;

    IF v_safe_role <> 'owner' THEN
        UPDATE public.company_relationships
        SET role = v_safe_role
        WHERE user_id = v_uid AND company_id = v_company_id;
    END IF;

    v_ecode := v_code || '-' || upper(v_safe_role);
    INSERT INTO public.employees (
        company_id, name, surname, employee_code,
        employment_type, position,
        monthly_salary, hourly_rate, weekly_rate, daily_rate,
        work_days_weekly, daily_hours, branch,
        access_level, worker_type, user_id, email
    ) VALUES (
        v_company_id, v_fn, v_ln, v_ecode,
        'part-time', CASE WHEN v_safe_role = 'owner' THEN 'Company Owner' ELSE 'HR Administrator' END,
        0, 0, 0, 0,
        5, 8, '',
        v_safe_role, 'employee', v_uid, lower(trim(v_email))
    );

    RETURN QUERY SELECT v_company_id, v_code;
END;
$function$;

-- 3. Update employee_resolve_by_code to normalise company codes numerically
--    so "28", "028", "0028" all match each other
CREATE OR REPLACE FUNCTION public.employee_resolve_by_code(p_company_code text, p_employee_code text)
RETURNS TABLE(
    company_id             uuid,
    employee_id            uuid,
    emp_user_id            uuid,
    employee_code          text,
    emp_name               text,
    emp_surname            text,
    employment_date        text,
    employment_type        text,
    emp_position           text,
    monthly_salary         numeric,
    hourly_rate            numeric,
    work_days_weekly       integer,
    daily_hours            numeric,
    emp_branch             text,
    access_level           text,
    login_password_ready   boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    c.id                                            AS company_id,
    e.id                                            AS employee_id,
    e.user_id                                       AS emp_user_id,
    COALESCE(e.employee_code, '')                   AS employee_code,
    COALESCE(e.name, '')                            AS emp_name,
    COALESCE(e.surname, '')                         AS emp_surname,
    COALESCE(e.employment_date::text, '')           AS employment_date,
    COALESCE(e.employment_type, '')                 AS employment_type,
    COALESCE(e.position, '')                        AS emp_position,
    COALESCE(e.monthly_salary, 0)::numeric          AS monthly_salary,
    COALESCE(e.hourly_rate, 0)::numeric             AS hourly_rate,
    COALESCE(e.work_days_weekly, 5)::integer        AS work_days_weekly,
    COALESCE(e.daily_hours, 8)::numeric             AS daily_hours,
    COALESCE(e.branch, '')                          AS emp_branch,
    COALESCE(e.access_level, 'employee')            AS access_level,
    COALESCE(e.login_password_ready, false)         AS login_password_ready
  FROM public.companies c
  JOIN public.employees e ON e.company_id = c.id
  WHERE (
    c.code = p_company_code
    OR (c.code ~ '^\d+$' AND p_company_code ~ '^\d+$'
        AND c.code::bigint = p_company_code::bigint)
  )
  AND (
    e.employee_code = p_employee_code
    OR (
      e.temp_login_code = p_employee_code
      AND e.temp_login_code_expires_at IS NOT NULL
      AND e.temp_login_code_expires_at > now()
    )
  )
  ORDER BY
    CASE WHEN e.temp_login_code = p_employee_code THEN 0 ELSE 1 END,
    e.created_at
  LIMIT 1;
$function$;
;
