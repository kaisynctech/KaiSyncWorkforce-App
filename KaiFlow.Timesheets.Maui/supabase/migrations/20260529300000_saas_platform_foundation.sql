-- ═══════════════════════════════════════════════════════════════════════════════
-- KaiFlow SaaS Platform Foundation
-- Migration: 20260529300000_saas_platform_foundation.sql
--
-- ROLLBACK NOTES (manual — run in reverse order if reverting):
--   1. DROP POLICY / DROP TABLE for all saas_* and platform_* objects
--   2. DROP FUNCTION saas_*, platform_*, provision_company_subscription
--   3. DROP TRIGGER trg_provision_company_subscription ON companies
--   Existing companies.companies rows are unchanged; plan_code column retained.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. SaaS plans catalogue ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_plans (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    code            text NOT NULL UNIQUE,
    description     text,
    monthly_price   numeric(12,2) NOT NULL DEFAULT 0,
    included_employees integer NOT NULL DEFAULT 10,
    per_employee_price numeric(12,2) NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    features_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Company subscriptions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_company_subscriptions (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    plan_id                 uuid NOT NULL REFERENCES public.saas_plans(id),
    billing_status          text NOT NULL DEFAULT 'trial',
    employee_limit          integer NOT NULL DEFAULT 10,
    current_employee_count  integer NOT NULL DEFAULT 0,
    next_billing_date       date,
    renewal_date            date,
    trial_ends_at           timestamptz,
    subscription_status     text NOT NULL DEFAULT 'trialing',
    amount_due              numeric(12,2) NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_plan ON public.saas_company_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_saas_subscriptions_status ON public.saas_company_subscriptions(subscription_status);

-- ─── 3. Billing transactions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_billing_transactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    subscription_id     uuid REFERENCES public.saas_company_subscriptions(id) ON DELETE SET NULL,
    amount              numeric(12,2) NOT NULL,
    currency            text NOT NULL DEFAULT 'ZAR',
    billing_period_start date,
    billing_period_end   date,
    payment_status      text NOT NULL DEFAULT 'pending',
    payment_provider    text,
    provider_reference  text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saas_billing_company ON public.saas_billing_transactions(company_id, created_at DESC);

-- ─── 4. Feature flag catalogue ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_feature_flags (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code        text NOT NULL UNIQUE,
    display_name        text NOT NULL,
    description         text,
    module              text,
    is_enabled_by_default boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── 5. Per-company feature overrides ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_company_features (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    feature_code    text NOT NULL,
    is_enabled      boolean NOT NULL DEFAULT true,
    enabled_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    override_reason text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, feature_code)
);

CREATE INDEX IF NOT EXISTS idx_saas_company_features_company ON public.saas_company_features(company_id);

-- ─── 6. Usage metering snapshots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_usage_snapshots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    period_month    date NOT NULL,
    metrics_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, period_month)
);

-- ─── 7. Onboarding progress ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_onboarding_progress (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    step_key        text NOT NULL,
    is_completed    boolean NOT NULL DEFAULT false,
    completed_at    timestamptz,
    metadata_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, step_key)
);

-- ─── 8. Platform administrators (KaiFlow staff — NOT tenant HR) ──────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id    uuid NOT NULL UNIQUE,
    email           text,
    role            text NOT NULL DEFAULT 'admin',
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 9. Platform audit log ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_platform_audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id   uuid,
    actor_email     text,
    action          text NOT NULL,
    target_type     text,
    target_id       uuid,
    company_id      uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    detail_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.saas_platform_audit_log(created_at DESC);

-- ─── 10. Support notes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_support_notes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    author_user_id  uuid,
    author_email    text,
    note            text NOT NULL,
    severity        text NOT NULL DEFAULT 'info',
    is_resolved     boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 11. Release rollouts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_release_rollouts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_code    text NOT NULL,
    rollout_stage   text NOT NULL DEFAULT 'beta',
    target_plan_codes text[] DEFAULT '{}',
    target_company_ids uuid[] DEFAULT '{}',
    min_app_version text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 12. Company app version tracking ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_company_app_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    app_version     text NOT NULL,
    platform        text,
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, app_version, platform)
);

-- ─── 13. Device sessions (MFA-ready / revocation foundation) ─────────────────
CREATE TABLE IF NOT EXISTS public.saas_device_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id    uuid NOT NULL,
    company_id      uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    device_label    text,
    user_agent      text,
    ip_hint         text,
    is_revoked      boolean NOT NULL DEFAULT false,
    last_active_at  timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user ON public.saas_device_sessions(auth_user_id, is_revoked);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Plans
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.saas_plans (code, name, description, monthly_price, included_employees, per_employee_price, features_json)
VALUES
(
    'free_trial', 'Free Trial', '14-day trial with core workforce modules.', 0, 15, 0,
    '{"modules":{"employees":true,"attendance":true,"leave":true,"ticketing":true,"payroll":true,"reports":true,"messaging":true,"settings":true,"clients":false,"inventory":false,"contractors":false,"property_management":false,"scheduling":false,"incidents":true,"my_pa":false},"features":{"advanced_reporting":false,"finance_module":false,"finance_forecasting":false,"accounting_sync":false},"max_employees":15}'::jsonb
),
(
    'starter', 'Starter', 'Essential workforce management for small teams.', 499, 25, 15,
    '{"modules":{"employees":true,"attendance":true,"leave":true,"ticketing":true,"payroll":true,"reports":true,"messaging":true,"settings":true,"clients":true,"inventory":false,"contractors":false,"property_management":false,"scheduling":false,"incidents":true,"my_pa":false},"features":{"advanced_reporting":false,"finance_module":false,"finance_forecasting":false,"accounting_sync":false},"max_employees":25}'::jsonb
),
(
    'pro', 'Professional', 'Full operations suite with finance and contractors.', 1499, 100, 12,
    '{"modules":{"employees":true,"attendance":true,"leave":true,"ticketing":true,"payroll":true,"reports":true,"messaging":true,"settings":true,"clients":true,"inventory":true,"suppliers":true,"contractors":true,"property_management":false,"scheduling":true,"incidents":true,"my_pa":true,"asset_compliance":true},"features":{"advanced_reporting":true,"finance_module":true,"finance_forecasting":false,"accounting_sync":true},"max_employees":100}'::jsonb
),
(
    'enterprise', 'Enterprise', 'Unlimited scale with all modules and platform support.', 3999, 500, 8,
    '{"modules":{"employees":true,"attendance":true,"leave":true,"ticketing":true,"payroll":true,"reports":true,"messaging":true,"settings":true,"clients":true,"inventory":true,"suppliers":true,"contractors":true,"property_management":true,"scheduling":true,"incidents":true,"my_pa":true,"asset_compliance":true,"paperless":true},"features":{"advanced_reporting":true,"finance_module":true,"finance_forecasting":true,"accounting_sync":true,"platform_api":true},"max_employees":500}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Feature flags
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO public.saas_feature_flags (feature_code, display_name, description, module, is_enabled_by_default)
VALUES
    ('module.payroll', 'Payroll', 'Payroll and payments module', 'payroll', true),
    ('module.reports', 'Reports', 'Reporting and analytics', 'reports', true),
    ('module.property_management', 'Property Management', 'Sites, units, residents', 'property_management', false),
    ('module.finance', 'Finance Module', 'Invoices, VAT, cashflow', 'finance', false),
    ('feature.advanced_reporting', 'Advanced Reporting', 'Executive analytics and cross-module reports', 'reports', false),
    ('feature.finance_forecasting', 'Finance Forecasting', 'Predictive finance analytics', 'finance', false),
    ('feature.accounting_sync', 'Accounting Sync', 'Xero/Sage/QuickBooks integration', 'finance', false),
    ('feature.scheduling', 'Scheduling', 'Shift templates and scheduling', 'scheduling', false),
    ('feature.my_pa', 'My PA', 'Personal assistant module', 'my_pa', false)
ON CONFLICT (feature_code) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Auto-provision subscription on new company
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.provision_company_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_plan_id uuid;
    v_limit integer;
BEGIN
    SELECT id, included_employees INTO v_plan_id, v_limit
    FROM public.saas_plans
    WHERE code = coalesce(new.plan_code, 'free_trial')
    LIMIT 1;

    IF v_plan_id IS NULL THEN
        SELECT id, included_employees INTO v_plan_id, v_limit
        FROM public.saas_plans WHERE code = 'free_trial' LIMIT 1;
    END IF;

    INSERT INTO public.saas_company_subscriptions (
        company_id, plan_id, billing_status, employee_limit,
        trial_ends_at, subscription_status, next_billing_date
    ) VALUES (
        new.id, v_plan_id, 'trial', v_limit,
        coalesce(new.trial_started_at, now()) + interval '14 days',
        'trialing',
        (coalesce(new.trial_started_at, now()) + interval '14 days')::date
    )
    ON CONFLICT (company_id) DO NOTHING;

    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_provision_company_subscription ON public.companies;
CREATE TRIGGER trg_provision_company_subscription
    AFTER INSERT ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.provision_company_subscription();

-- Backfill subscriptions for existing companies
INSERT INTO public.saas_company_subscriptions (company_id, plan_id, billing_status, employee_limit, trial_ends_at, subscription_status, current_employee_count)
SELECT
    c.id,
    coalesce(p.id, (SELECT id FROM public.saas_plans WHERE code = 'free_trial' LIMIT 1)),
    CASE WHEN c.subscription_active THEN 'active' ELSE 'trial' END,
    coalesce(p.included_employees, 15),
    coalesce(c.trial_started_at, c.created_at) + interval '14 days',
    CASE
        WHEN c.subscription_active THEN 'active'
        WHEN coalesce(c.trial_started_at, c.created_at) + interval '14 days' > now() THEN 'trialing'
        ELSE 'past_due'
    END,
    (SELECT count(*)::integer FROM public.employees e WHERE e.company_id = c.id AND coalesce(e.is_active, true))
FROM public.companies c
LEFT JOIN public.saas_plans p ON p.code = coalesce(nullif(c.plan_code, ''), 'free_trial')
ON CONFLICT (company_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform admin check
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins
        WHERE auth_user_id = auth.uid() AND is_active = true
    );
$$;

GRANT EXECUTE ON FUNCTION public.platform_is_admin() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Feature entitlement check (server-side mirror of FeatureAccessService)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.saas_is_feature_enabled(p_company_id uuid, p_feature_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_override boolean;
    v_expires timestamptz;
    v_plan_features jsonb;
    v_sub_status text;
    v_enabled boolean;
BEGIN
    -- Company-specific override (beta unlock, admin grant)
    SELECT cf.is_enabled, cf.expires_at INTO v_override, v_expires
    FROM public.saas_company_features cf
    WHERE cf.company_id = p_company_id AND cf.feature_code = p_feature_code;

    IF FOUND THEN
        IF v_expires IS NOT NULL AND v_expires < now() THEN
            NULL; -- expired override, fall through to plan
        ELSE
            RETURN v_override;
        END IF;
    END IF;

    -- Subscription must be active or trialing
    SELECT s.subscription_status, p.features_json INTO v_sub_status, v_plan_features
    FROM public.saas_company_subscriptions s
    JOIN public.saas_plans p ON p.id = s.plan_id
    WHERE s.company_id = p_company_id;

    IF NOT FOUND THEN
        RETURN true; -- legacy company without subscription row: permissive default
    END IF;

    IF v_sub_status NOT IN ('active', 'trialing') THEN
        RETURN false;
    END IF;

    -- Check features map
    IF v_plan_features ? 'features' AND v_plan_features->'features' ? p_feature_code THEN
        RETURN coalesce((v_plan_features->'features'->>p_feature_code)::boolean, false);
    END IF;

    -- Module-prefixed features: module.{key}
    IF p_feature_code LIKE 'module.%' THEN
        DECLARE v_mod text := substring(p_feature_code from 8);
        BEGIN
            IF v_plan_features ? 'modules' AND v_plan_features->'modules' ? v_mod THEN
                RETURN coalesce((v_plan_features->'modules'->>v_mod)::boolean, false);
            END IF;
        END;
    END IF;

    -- Default from catalogue
    SELECT is_enabled_by_default INTO v_enabled
    FROM public.saas_feature_flags WHERE feature_code = p_feature_code;

    RETURN coalesce(v_enabled, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.saas_is_feature_enabled(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Get company subscription summary (tenant-readable)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.saas_get_company_subscription(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT (
        p_company_id = ANY(public.user_company_ids())
        OR public.platform_is_admin()
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT jsonb_build_object(
        'subscription_id', s.id,
        'company_id', s.company_id,
        'plan_code', p.code,
        'plan_name', p.name,
        'subscription_status', s.subscription_status,
        'billing_status', s.billing_status,
        'employee_limit', s.employee_limit,
        'current_employee_count', s.current_employee_count,
        'trial_ends_at', s.trial_ends_at,
        'next_billing_date', s.next_billing_date,
        'amount_due', s.amount_due,
        'features_json', p.features_json
    ) INTO v_result
    FROM public.saas_company_subscriptions s
    JOIN public.saas_plans p ON p.id = s.plan_id
    WHERE s.company_id = p_company_id;

    RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.saas_get_company_subscription(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform admin — list companies (cross-tenant)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_list_companies(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
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
        'plan_code', p.code,
        'subscription_status', s.subscription_status,
        'employee_count', s.current_employee_count,
        'employee_limit', s.employee_limit,
        'created_at', c.created_at,
        'subscription_active', c.subscription_active
    )
    FROM public.companies c
    LEFT JOIN public.saas_company_subscriptions s ON s.company_id = c.id
    LEFT JOIN public.saas_plans p ON p.id = s.plan_id
    ORDER BY c.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_list_companies(integer, integer) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform admin — set subscription status
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_set_subscription_status(
    p_company_id uuid,
    p_status text,
    p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    UPDATE public.saas_company_subscriptions
    SET subscription_status = p_status,
        billing_status = CASE WHEN p_status = 'active' THEN 'active' ELSE billing_status END,
        updated_at = now()
    WHERE company_id = p_company_id;

    UPDATE public.companies
    SET subscription_active = (p_status = 'active')
    WHERE id = p_company_id;

    INSERT INTO public.saas_platform_audit_log (actor_user_id, action, target_type, target_id, company_id, detail_json)
    VALUES (auth.uid(), 'subscription_status_changed', 'company', p_company_id, p_company_id,
            jsonb_build_object('status', p_status, 'note', p_note));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_set_subscription_status(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Platform admin — toggle company feature
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_set_company_feature(
    p_company_id uuid,
    p_feature_code text,
    p_enabled boolean,
    p_expires_at timestamptz DEFAULT NULL,
    p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    INSERT INTO public.saas_company_features (company_id, feature_code, is_enabled, expires_at, override_reason)
    VALUES (p_company_id, p_feature_code, p_enabled, p_expires_at, p_reason)
    ON CONFLICT (company_id, feature_code) DO UPDATE SET
        is_enabled = excluded.is_enabled,
        expires_at = excluded.expires_at,
        override_reason = excluded.override_reason,
        enabled_at = now();

    INSERT INTO public.saas_platform_audit_log (actor_user_id, action, target_type, target_id, company_id, detail_json)
    VALUES (auth.uid(), 'feature_override', 'feature', p_company_id, p_company_id,
            jsonb_build_object('feature_code', p_feature_code, 'enabled', p_enabled));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_set_company_feature(uuid, text, boolean, timestamptz, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RPC: Record usage snapshot (called by client or cron)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.saas_upsert_usage_snapshot(
    p_company_id uuid,
    p_period_month date,
    p_metrics jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
    IF NOT (
        p_company_id = ANY(public.user_company_ids())
        OR public.platform_is_admin()
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    INSERT INTO public.saas_usage_snapshots (company_id, period_month, metrics_json)
    VALUES (p_company_id, date_trunc('month', p_period_month)::date, p_metrics)
    ON CONFLICT (company_id, period_month) DO UPDATE SET
        metrics_json = saas_usage_snapshots.metrics_json || excluded.metrics_json,
        created_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.saas_upsert_usage_snapshot(uuid, date, jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.saas_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_billing_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_company_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_platform_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_support_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_release_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_company_app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_device_sessions ENABLE ROW LEVEL SECURITY;

-- Plans & feature catalogue: readable by all authenticated
CREATE POLICY p_saas_plans_select ON public.saas_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY p_saas_feature_flags_select ON public.saas_feature_flags FOR SELECT TO authenticated USING (true);

-- Subscriptions: tenant members read own; platform admin read all
CREATE POLICY p_saas_subscriptions_select ON public.saas_company_subscriptions
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());

-- Billing: tenant read own
CREATE POLICY p_saas_billing_select ON public.saas_billing_transactions
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());

-- Company features: tenant read own
CREATE POLICY p_saas_company_features_select ON public.saas_company_features
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());

-- Usage snapshots: tenant read own
CREATE POLICY p_saas_usage_select ON public.saas_usage_snapshots
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());

-- Onboarding: tenant read/write own
CREATE POLICY p_saas_onboarding_select ON public.saas_onboarding_progress
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()));

CREATE POLICY p_saas_onboarding_upsert ON public.saas_onboarding_progress
    FOR ALL TO authenticated
    USING (company_id = ANY(public.user_company_ids()))
    WITH CHECK (company_id = ANY(public.user_company_ids()));

-- Platform admins: self-read only
CREATE POLICY p_platform_admins_self ON public.platform_admins
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());

-- Audit log: platform admin only
CREATE POLICY p_platform_audit_select ON public.saas_platform_audit_log
    FOR SELECT TO authenticated
    USING (public.platform_is_admin());

-- Support notes: platform admin full; tenant owners read (via RPC preferred)
CREATE POLICY p_support_notes_platform ON public.saas_support_notes
    FOR SELECT TO authenticated
    USING (public.platform_is_admin());

-- Release rollouts: readable by all authenticated (client checks locally)
CREATE POLICY p_release_rollouts_select ON public.saas_release_rollouts
    FOR SELECT TO authenticated USING (true);

-- App versions: tenant upsert own
CREATE POLICY p_app_versions_select ON public.saas_company_app_versions
    FOR SELECT TO authenticated
    USING (company_id = ANY(public.user_company_ids()) OR public.platform_is_admin());

CREATE POLICY p_app_versions_upsert ON public.saas_company_app_versions
    FOR ALL TO authenticated
    USING (company_id = ANY(public.user_company_ids()))
    WITH CHECK (company_id = ANY(public.user_company_ids()));

-- Device sessions: own user
CREATE POLICY p_device_sessions_own ON public.saas_device_sessions
    FOR ALL TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- No direct INSERT/UPDATE on subscriptions from clients — use RPCs
-- (platform RPCs are SECURITY DEFINER)
