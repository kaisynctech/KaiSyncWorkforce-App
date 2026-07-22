-- Platform SaaS administration: billing snapshots, feedback, admin dashboard RPCs.
-- KaiFlow Standard pricing: R2500/mo includes 25 employees, R99/additional employee.

-- ═══════════════════════════════════════════════════════════════════════════════
-- KaiFlow Standard plan (update catalogue)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.saas_plans (code, name, description, monthly_price, included_employees, per_employee_price, is_active, features_json)
VALUES (
    'kaiflow_standard',
    'KaiFlow Standard',
    'Production plan — R2500/month includes 25 employees, R99 per additional employee.',
    2500.00, 25, 99.00, true,
    '{"modules":{"employees":true,"attendance":true,"leave":true,"ticketing":true,"payroll":true,"reports":true,"messaging":true,"settings":true,"clients":true,"inventory":true,"suppliers":true,"contractors":true,"property_management":true,"scheduling":true,"incidents":true,"my_pa":true,"asset_compliance":true,"paperless":true},"features":{"advanced_reporting":true,"finance_module":true,"finance_forecasting":true,"accounting_sync":true,"platform_api":true},"max_employees":500}'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    monthly_price = EXCLUDED.monthly_price,
    included_employees = EXCLUDED.included_employees,
    per_employee_price = EXCLUDED.per_employee_price,
    is_active = EXCLUDED.is_active;
-- ═══════════════════════════════════════════════════════════════════════════════
-- company_subscriptions — billing snapshot (platform admin + invoicing)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.company_subscriptions (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                  uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
    saas_subscription_id        uuid REFERENCES public.saas_company_subscriptions(id) ON DELETE SET NULL,
    plan_name                   text NOT NULL DEFAULT 'KaiFlow Standard',
    base_price                  numeric(12, 2) NOT NULL DEFAULT 2500.00,
    included_employees          integer NOT NULL DEFAULT 25,
    additional_employee_price   numeric(12, 2) NOT NULL DEFAULT 99.00,
    employee_count              integer NOT NULL DEFAULT 0,
    monthly_charge              numeric(12, 2) NOT NULL DEFAULT 2500.00,
    status                      text NOT NULL DEFAULT 'active',
    start_date                  date NOT NULL DEFAULT CURRENT_DATE,
    renewal_date                date,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT company_subscriptions_status_check CHECK (
        status IN ('active', 'trialing', 'past_due', 'suspended', 'cancelled')
    )
);
CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status ON public.company_subscriptions (status);
-- ═══════════════════════════════════════════════════════════════════════════════
-- platform_feedback — customer feedback & feature requests
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.platform_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    employee_id     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
    category        text NOT NULL DEFAULT 'Suggestion',
    priority        text NOT NULL DEFAULT 'normal',
    status          text NOT NULL DEFAULT 'New',
    message         text NOT NULL,
    release_version text,
    admin_notes     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT platform_feedback_category_check CHECK (
        category IN ('Bug', 'Suggestion', 'Feature Request', 'Support')
    ),
    CONSTRAINT platform_feedback_status_check CHECK (
        status IN ('New', 'In Review', 'Planned', 'Completed', 'Closed')
    )
);
CREATE INDEX IF NOT EXISTS idx_platform_feedback_company ON public.platform_feedback (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_feedback_status ON public.platform_feedback (status, category);
-- ═══════════════════════════════════════════════════════════════════════════════
-- Billing calculation (SQL mirror of BillingCalculationService)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.kaiflow_calculate_monthly_charge(
    p_employee_count integer,
    p_base_price numeric DEFAULT 2500,
    p_included integer DEFAULT 25,
    p_per_additional numeric DEFAULT 99
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_base_price + (GREATEST(0, p_employee_count - p_included) * p_per_additional);
$$;
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
GRANT EXECUTE ON FUNCTION public.platform_refresh_company_subscription(uuid) TO authenticated;
-- Backfill billing snapshots
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.companies LOOP
        PERFORM public.platform_refresh_company_subscription(r.id);
    END LOOP;
END $$;
-- ═══════════════════════════════════════════════════════════════════════════════
-- Platform owner seed (kaisynctech@gmail.com)
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.platform_admins (auth_user_id, email, role, is_active)
SELECT u.id, u.email, 'owner', true
FROM auth.users u
WHERE lower(u.email) = lower('kaisynctech@gmail.com')
ON CONFLICT (auth_user_id) DO UPDATE SET
    email = EXCLUDED.email,
    role = 'owner',
    is_active = true;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform admin dashboard (KPIs + trends)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_admin_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_month_start date := date_trunc('month', CURRENT_DATE)::date;
    v_today date := CURRENT_DATE;
    v_kpis jsonb;
    v_trends jsonb;
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    SELECT jsonb_build_object(
        'total_companies', (SELECT count(*) FROM public.companies),
        'total_employees', (SELECT count(*) FROM public.employees WHERE coalesce(is_active, true)),
        'active_users_today', (
            SELECT count(DISTINCT auth_user_id)
            FROM public.app_events
            WHERE created_at >= v_today AND auth_user_id IS NOT NULL
        ),
        'monthly_active_users', (
            SELECT count(DISTINCT auth_user_id)
            FROM public.app_events
            WHERE created_at >= v_month_start AND auth_user_id IS NOT NULL
        ),
        'monthly_revenue', coalesce((
            SELECT sum(monthly_charge) FROM public.company_subscriptions
            WHERE status IN ('active', 'trialing')
        ), 0),
        'new_companies_this_month', (
            SELECT count(*) FROM public.companies WHERE created_at >= v_month_start
        ),
        'total_payroll_processed', (
            SELECT count(*) FROM public.payment_approvals WHERE status = 'paid'
        ),
        'total_invoices_generated', (
            SELECT count(*) FROM public.finance_invoices
        ),
        'error_count', (
            SELECT count(*) FROM public.application_errors
            WHERE created_at >= v_month_start
        ),
        'pending_feedback', (
            SELECT count(*) FROM public.platform_feedback
            WHERE status IN ('New', 'In Review')
        )
    ) INTO v_kpis;

    SELECT jsonb_build_object(
        'company_growth', coalesce((
            SELECT jsonb_agg(jsonb_build_object('label', to_char(m, 'Mon YY'), 'value', cnt) ORDER BY m)
            FROM (
                SELECT date_trunc('month', created_at)::date AS m, count(*)::numeric AS cnt
                FROM public.companies
                WHERE created_at >= (CURRENT_DATE - interval '6 months')
                GROUP BY 1
            ) sub
        ), '[]'::jsonb),
        'revenue_growth', coalesce((
            SELECT jsonb_agg(jsonb_build_object('label', to_char(m, 'Mon YY'), 'value', rev) ORDER BY m)
            FROM (
                SELECT date_trunc('month', created_at)::date AS m, sum(amount)::numeric AS rev
                FROM public.saas_billing_transactions
                WHERE payment_status = 'paid'
                  AND created_at >= (CURRENT_DATE - interval '6 months')
                GROUP BY 1
            ) sub
        ), '[]'::jsonb),
        'active_users_trend', coalesce((
            SELECT jsonb_agg(jsonb_build_object('label', to_char(d, 'DD Mon'), 'value', cnt) ORDER BY d)
            FROM (
                SELECT date_trunc('day', created_at)::date AS d,
                       count(DISTINCT auth_user_id)::numeric AS cnt
                FROM public.app_events
                WHERE created_at >= (CURRENT_DATE - interval '14 days')
                  AND auth_user_id IS NOT NULL
                GROUP BY 1
            ) sub
        ), '[]'::jsonb),
        'error_trend', coalesce((
            SELECT jsonb_agg(jsonb_build_object('label', to_char(d, 'DD Mon'), 'value', cnt) ORDER BY d)
            FROM (
                SELECT date_trunc('day', created_at)::date AS d, count(*)::numeric AS cnt
                FROM public.application_errors
                WHERE created_at >= (CURRENT_DATE - interval '14 days')
                GROUP BY 1
            ) sub
        ), '[]'::jsonb)
    ) INTO v_trends;

    RETURN jsonb_build_object('kpis', v_kpis, 'trends', v_trends);
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_admin_dashboard() TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Search companies (platform admin)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_search_companies(
    p_query text DEFAULT '',
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'code', c.code,
        'plan_code', coalesce(p.code, cs.plan_name),
        'subscription_status', coalesce(cs.status, s.subscription_status, 'unknown'),
        'employee_count', coalesce(cs.employee_count, s.current_employee_count, 0),
        'employee_limit', coalesce(cs.included_employees, s.employee_limit, 25),
        'monthly_charge', coalesce(cs.monthly_charge, 0),
        'created_at', c.created_at,
        'subscription_active', c.subscription_active
    )
    FROM public.companies c
    LEFT JOIN public.saas_company_subscriptions s ON s.company_id = c.id
    LEFT JOIN public.saas_plans p ON p.id = s.plan_id
    LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
    WHERE p_query IS NULL OR p_query = ''
       OR c.name ILIKE '%' || p_query || '%'
       OR c.code ILIKE '%' || p_query || '%'
    ORDER BY c.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_search_companies(text, integer, integer) TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Customer health score (extended)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_customer_health(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_score integer := 100;
    v_issues jsonb := '[]'::jsonb;
    v_last_login timestamptz;
    v_active_users integer;
    v_errors integer;
    v_feedback integer;
    v_status text;
BEGIN
    IF NOT (public.platform_is_admin() OR p_company_id = ANY(public.user_company_ids())) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT max(created_at) INTO v_last_login
    FROM public.app_events WHERE company_id = p_company_id;

    SELECT count(DISTINCT auth_user_id) INTO v_active_users
    FROM public.app_events
    WHERE company_id = p_company_id AND created_at >= (CURRENT_DATE - interval '30 days')
      AND auth_user_id IS NOT NULL;

    SELECT count(*) INTO v_errors
    FROM public.application_errors
    WHERE company_id = p_company_id AND created_at >= (CURRENT_DATE - interval '30 days');

    SELECT count(*) INTO v_feedback
    FROM public.platform_feedback
    WHERE company_id = p_company_id AND status IN ('New', 'In Review');

    IF v_last_login IS NULL OR v_last_login < (now() - interval '14 days') THEN
        v_score := v_score - 25;
        v_issues := v_issues || jsonb_build_array('No login in 14+ days');
    END IF;

    IF v_active_users = 0 THEN
        v_score := v_score - 20;
        v_issues := v_issues || jsonb_build_array('No active users (30d)');
    END IF;

    IF v_errors > 10 THEN
        v_score := v_score - 15;
        v_issues := v_issues || jsonb_build_array('Elevated error count');
    END IF;

    IF v_feedback > 3 THEN
        v_score := v_score - 10;
        v_issues := v_issues || jsonb_build_array('Open feedback items');
    END IF;

    v_score := GREATEST(0, LEAST(100, v_score));
    v_status := CASE
        WHEN v_score >= 70 THEN 'Healthy'
        WHEN v_score >= 40 THEN 'At Risk'
        ELSE 'Inactive'
    END;

    RETURN jsonb_build_object(
        'company_id', p_company_id,
        'score', v_score,
        'status', v_status,
        'grade', CASE WHEN v_score >= 90 THEN 'A' WHEN v_score >= 75 THEN 'B' WHEN v_score >= 60 THEN 'C' ELSE 'D' END,
        'last_login', v_last_login,
        'active_users_30d', v_active_users,
        'error_count_30d', v_errors,
        'open_feedback', v_feedback,
        'issues', v_issues
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_customer_health(uuid) TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform feedback stats
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_feedback_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    RETURN jsonb_build_object(
        'total', (SELECT count(*) FROM public.platform_feedback),
        'by_status', coalesce((
            SELECT jsonb_object_agg(status, cnt)
            FROM (SELECT status, count(*) AS cnt FROM public.platform_feedback GROUP BY status) s
        ), '{}'::jsonb),
        'top_feature_requests', coalesce((
            SELECT jsonb_agg(jsonb_build_object('message', left(message, 80), 'count', cnt) ORDER BY cnt DESC)
            FROM (
                SELECT message, count(*) AS cnt
                FROM public.platform_feedback
                WHERE category = 'Feature Request' AND status NOT IN ('Completed', 'Closed')
                GROUP BY message
                ORDER BY cnt DESC
                LIMIT 10
            ) t
        ), '[]'::jsonb)
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_feedback_stats() TO authenticated;
-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS: company_subscriptions
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_company_subscriptions_select ON public.company_subscriptions
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_company_subscriptions_admin ON public.company_subscriptions
    FOR ALL TO authenticated
    USING (public.platform_is_admin())
    WITH CHECK (public.platform_is_admin());
-- RLS: platform_feedback
ALTER TABLE public.platform_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_platform_feedback_select ON public.platform_feedback
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());
CREATE POLICY p_platform_feedback_insert ON public.platform_feedback
    FOR INSERT TO authenticated
    WITH CHECK (company_id = ANY(public.user_company_ids()));
CREATE POLICY p_platform_feedback_admin ON public.platform_feedback
    FOR UPDATE TO authenticated
    USING (public.platform_is_admin())
    WITH CHECK (public.platform_is_admin());
