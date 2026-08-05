-- Harden platform_refresh_company_subscription: require platform_is_admin()
-- (was missing admin gate — any authenticated caller could invoke).

CREATE OR REPLACE FUNCTION public.platform_refresh_company_subscription(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_emp_count integer;
    v_saas public.saas_company_subscriptions%ROWTYPE;
    v_plan public.saas_plans%ROWTYPE;
    v_charge numeric;
    v_row public.company_subscriptions%ROWTYPE;
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    SELECT count(*)::integer INTO v_emp_count
    FROM public.employees e
    WHERE e.company_id = p_company_id AND coalesce(e.is_active, true);

    SELECT s.* INTO v_saas
    FROM public.saas_company_subscriptions s
    WHERE s.company_id = p_company_id;

    IF FOUND THEN
        SELECT * INTO v_plan FROM public.saas_plans WHERE id = v_saas.plan_id;
        v_charge := public.kaiflow_calculate_monthly_charge(
            v_emp_count,
            coalesce(v_plan.monthly_price, 2500),
            coalesce(v_plan.included_employees, 25),
            coalesce(v_plan.per_employee_price, 99)
        );
        UPDATE public.saas_company_subscriptions
        SET current_employee_count = v_emp_count,
            amount_due = v_charge,
            updated_at = now()
        WHERE company_id = p_company_id;
    ELSE
        v_charge := public.kaiflow_calculate_monthly_charge(v_emp_count);
    END IF;

    INSERT INTO public.company_subscriptions (
        company_id, saas_subscription_id, plan_name, base_price, included_employees,
        additional_employee_price, employee_count, monthly_charge, status,
        start_date, renewal_date, updated_at
    ) VALUES (
        p_company_id,
        v_saas.id,
        coalesce(v_plan.name, 'KaiFlow Standard'),
        coalesce(v_plan.monthly_price, 2500),
        coalesce(v_plan.included_employees, 25),
        coalesce(v_plan.per_employee_price, 99),
        v_emp_count,
        v_charge,
        coalesce(v_saas.subscription_status, 'active'),
        coalesce(v_saas.created_at::date, CURRENT_DATE),
        v_saas.renewal_date,
        now()
    )
    ON CONFLICT (company_id) DO UPDATE SET
        saas_subscription_id = EXCLUDED.saas_subscription_id,
        plan_name = EXCLUDED.plan_name,
        base_price = EXCLUDED.base_price,
        included_employees = EXCLUDED.included_employees,
        additional_employee_price = EXCLUDED.additional_employee_price,
        employee_count = EXCLUDED.employee_count,
        monthly_charge = EXCLUDED.monthly_charge,
        status = EXCLUDED.status,
        renewal_date = EXCLUDED.renewal_date,
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_refresh_company_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_refresh_company_subscription(uuid) TO authenticated;
