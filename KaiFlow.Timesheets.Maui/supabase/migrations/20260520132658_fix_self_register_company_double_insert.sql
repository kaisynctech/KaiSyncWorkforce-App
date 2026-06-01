
CREATE OR REPLACE FUNCTION public.self_register_company(
    p_company_name      text,
    p_owner_first_name  text DEFAULT '',
    p_owner_last_name   text DEFAULT '',
    p_role              text DEFAULT 'owner'
)
RETURNS TABLE(company_id uuid, company_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    -- Create the company; trg_auto_company_relationship will insert the owner row.
    LOOP
        v_code := lpad(nextval('public.company_code_seq')::text, 4, '0');
        BEGIN
            INSERT INTO public.companies (name, code, plan_code, trial_started_at, owner_user_id)
            VALUES (btrim(p_company_name), v_code, 'free_trial', now(), v_uid)
            RETURNING id INTO v_company_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            CONTINUE;
        END;
    END LOOP;

    -- If role is not owner, update the relationship the trigger created.
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
$$;
;
