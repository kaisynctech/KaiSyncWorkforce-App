-- KaiSync Business pricing v2:
-- R2,500 base includes 25 active employees + 50 portal contractors + 20 active properties.
-- Overage: R99 / employee, R49 / portal contractor, R49 / property.
-- Adds contractors.portal_enabled and sites.is_active as explicit billable toggles.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Schema: billable flags
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contractors.portal_enabled IS
  'When true (and is_active), contractor may use the portal and counts as a billable portal seat.';

-- Existing portal users (have a code) stay enabled so we do not lock them out.
UPDATE public.contractors
SET portal_enabled = true
WHERE portal_enabled = false
  AND contractor_code IS NOT NULL
  AND trim(contractor_code) <> '';

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sites.is_active IS
  'Active properties count toward property seats in monthly billing.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Plan + subscription snapshot columns
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.saas_plans
  ADD COLUMN IF NOT EXISTS included_contractors integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS per_contractor_price numeric(12, 2) NOT NULL DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS included_properties integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS per_property_price numeric(12, 2) NOT NULL DEFAULT 49.00;

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS included_contractors integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS additional_contractor_price numeric(12, 2) NOT NULL DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS contractor_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_properties integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS additional_property_price numeric(12, 2) NOT NULL DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS property_count integer NOT NULL DEFAULT 0;

UPDATE public.saas_plans
SET
  name = 'KaiSync Workforce Business',
  description = 'R2,500/month includes 25 employees, 50 portal contractors, and 20 properties. Extra: R99/employee, R49/portal contractor, R49/property.',
  monthly_price = 2500.00,
  included_employees = 25,
  per_employee_price = 99.00,
  included_contractors = 50,
  per_contractor_price = 49.00,
  included_properties = 20,
  per_property_price = 49.00,
  is_active = true
WHERE code = 'kaiflow_standard';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Charge formula (replace old 4-arg signature)
-- ═══════════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.kaiflow_calculate_monthly_charge(integer, numeric, integer, numeric);
DROP FUNCTION IF EXISTS public.kaiflow_calculate_monthly_charge(integer);

CREATE OR REPLACE FUNCTION public.kaiflow_calculate_monthly_charge(
    p_employee_count integer,
    p_contractor_count integer DEFAULT 0,
    p_property_count integer DEFAULT 0,
    p_base_price numeric DEFAULT 2500,
    p_included_employees integer DEFAULT 25,
    p_per_employee numeric DEFAULT 99,
    p_included_contractors integer DEFAULT 50,
    p_per_contractor numeric DEFAULT 49,
    p_included_properties integer DEFAULT 20,
    p_per_property numeric DEFAULT 49
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_base_price
         + (GREATEST(0, coalesce(p_employee_count, 0) - coalesce(p_included_employees, 25)) * coalesce(p_per_employee, 99))
         + (GREATEST(0, coalesce(p_contractor_count, 0) - coalesce(p_included_contractors, 50)) * coalesce(p_per_contractor, 49))
         + (GREATEST(0, coalesce(p_property_count, 0) - coalesce(p_included_properties, 20)) * coalesce(p_per_property, 49));
$$;

GRANT EXECUTE ON FUNCTION public.kaiflow_calculate_monthly_charge(
    integer, integer, integer, numeric, integer, numeric, integer, numeric, integer, numeric
) TO authenticated, anon, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Shared live counters helper
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.kaiflow_company_billing_counts(p_company_id uuid)
RETURNS TABLE (
    employee_count integer,
    contractor_count integer,
    property_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
    SELECT
        (
            SELECT count(*)::integer
            FROM public.employees e
            WHERE e.company_id = p_company_id
              AND coalesce(e.is_active, true)
        ) AS employee_count,
        (
            SELECT count(*)::integer
            FROM public.contractors c
            WHERE c.company_id = p_company_id
              AND coalesce(c.is_active, true)
              AND coalesce(c.portal_enabled, false)
              AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
        ) AS contractor_count,
        (
            SELECT count(*)::integer
            FROM public.sites s
            WHERE s.company_id = p_company_id
              AND coalesce(s.is_active, true)
        ) AS property_count;
$$;

REVOKE ALL ON FUNCTION public.kaiflow_company_billing_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kaiflow_company_billing_counts(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Platform refresh (admin) — full meters
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.platform_refresh_company_subscription(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_emp_count integer;
    v_contractor_count integer;
    v_property_count integer;
    v_saas public.saas_company_subscriptions%ROWTYPE;
    v_plan public.saas_plans%ROWTYPE;
    v_charge numeric;
    v_row public.company_subscriptions%ROWTYPE;
    v_base numeric := 2500;
    v_inc_emp integer := 25;
    v_per_emp numeric := 99;
    v_inc_ct integer := 50;
    v_per_ct numeric := 49;
    v_inc_prop integer := 20;
    v_per_prop numeric := 49;
    v_plan_name text := 'KaiSync Workforce Business';
BEGIN
    IF NOT public.platform_is_admin() THEN
        RAISE EXCEPTION 'Platform admin access required';
    END IF;

    SELECT c.employee_count, c.contractor_count, c.property_count
    INTO v_emp_count, v_contractor_count, v_property_count
    FROM public.kaiflow_company_billing_counts(p_company_id) c;

    SELECT s.* INTO v_saas
    FROM public.saas_company_subscriptions s
    WHERE s.company_id = p_company_id;

    IF FOUND THEN
        SELECT * INTO v_plan FROM public.saas_plans WHERE id = v_saas.plan_id;
        IF FOUND THEN
            v_base := coalesce(v_plan.monthly_price, 2500);
            v_inc_emp := coalesce(v_plan.included_employees, 25);
            v_per_emp := coalesce(v_plan.per_employee_price, 99);
            v_inc_ct := coalesce(v_plan.included_contractors, 50);
            v_per_ct := coalesce(v_plan.per_contractor_price, 49);
            v_inc_prop := coalesce(v_plan.included_properties, 20);
            v_per_prop := coalesce(v_plan.per_property_price, 49);
            v_plan_name := coalesce(v_plan.name, v_plan_name);
        END IF;
    END IF;

    v_charge := public.kaiflow_calculate_monthly_charge(
        v_emp_count, v_contractor_count, v_property_count,
        v_base, v_inc_emp, v_per_emp, v_inc_ct, v_per_ct, v_inc_prop, v_per_prop
    );

    IF v_saas.id IS NOT NULL THEN
        UPDATE public.saas_company_subscriptions
        SET current_employee_count = v_emp_count,
            amount_due = v_charge,
            updated_at = now()
        WHERE company_id = p_company_id;
    END IF;

    INSERT INTO public.company_subscriptions (
        company_id, saas_subscription_id, plan_name, base_price,
        included_employees, additional_employee_price, employee_count,
        included_contractors, additional_contractor_price, contractor_count,
        included_properties, additional_property_price, property_count,
        monthly_charge, status, start_date, renewal_date, updated_at
    ) VALUES (
        p_company_id,
        v_saas.id,
        v_plan_name,
        v_base,
        v_inc_emp, v_per_emp, v_emp_count,
        v_inc_ct, v_per_ct, v_contractor_count,
        v_inc_prop, v_per_prop, v_property_count,
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
        included_contractors = EXCLUDED.included_contractors,
        additional_contractor_price = EXCLUDED.additional_contractor_price,
        contractor_count = EXCLUDED.contractor_count,
        included_properties = EXCLUDED.included_properties,
        additional_property_price = EXCLUDED.additional_property_price,
        property_count = EXCLUDED.property_count,
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- Tenant billing summary (HR/owner) — live owed amount + breakdown
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.company_get_billing_summary(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_emp_count integer;
    v_contractor_count integer;
    v_property_count integer;
    v_saas public.saas_company_subscriptions%ROWTYPE;
    v_plan public.saas_plans%ROWTYPE;
    v_base numeric := 2500;
    v_inc_emp integer := 25;
    v_per_emp numeric := 99;
    v_inc_ct integer := 50;
    v_per_ct numeric := 49;
    v_inc_prop integer := 20;
    v_per_prop numeric := 49;
    v_plan_name text := 'KaiSync Workforce Business';
    v_status text := 'active';
    v_renewal date;
    v_emp_over integer;
    v_ct_over integer;
    v_prop_over integer;
    v_charge numeric;
BEGIN
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'company_id required';
    END IF;

    IF NOT public.platform_is_admin() THEN
        IF NOT EXISTS (
            SELECT 1
            FROM public.employees e
            WHERE e.company_id = p_company_id
              AND e.user_id = auth.uid()
              AND coalesce(e.is_active, true)
              AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin')
        ) THEN
            RAISE EXCEPTION 'Access denied';
        END IF;
    END IF;

    SELECT c.employee_count, c.contractor_count, c.property_count
    INTO v_emp_count, v_contractor_count, v_property_count
    FROM public.kaiflow_company_billing_counts(p_company_id) c;

    SELECT s.* INTO v_saas
    FROM public.saas_company_subscriptions s
    WHERE s.company_id = p_company_id;

    IF FOUND THEN
        v_status := coalesce(v_saas.subscription_status, v_saas.billing_status, 'active');
        v_renewal := v_saas.renewal_date;
        SELECT * INTO v_plan FROM public.saas_plans WHERE id = v_saas.plan_id;
        IF FOUND THEN
            v_base := coalesce(v_plan.monthly_price, 2500);
            v_inc_emp := coalesce(v_plan.included_employees, 25);
            v_per_emp := coalesce(v_plan.per_employee_price, 99);
            v_inc_ct := coalesce(v_plan.included_contractors, 50);
            v_per_ct := coalesce(v_plan.per_contractor_price, 49);
            v_inc_prop := coalesce(v_plan.included_properties, 20);
            v_per_prop := coalesce(v_plan.per_property_price, 49);
            v_plan_name := coalesce(v_plan.name, v_plan_name);
        END IF;
    END IF;

    v_emp_over := GREATEST(0, v_emp_count - v_inc_emp);
    v_ct_over := GREATEST(0, v_contractor_count - v_inc_ct);
    v_prop_over := GREATEST(0, v_property_count - v_inc_prop);
    v_charge := public.kaiflow_calculate_monthly_charge(
        v_emp_count, v_contractor_count, v_property_count,
        v_base, v_inc_emp, v_per_emp, v_inc_ct, v_per_ct, v_inc_prop, v_per_prop
    );

    -- Keep snapshot current for platform views (tenant-readable path).
    INSERT INTO public.company_subscriptions (
        company_id, saas_subscription_id, plan_name, base_price,
        included_employees, additional_employee_price, employee_count,
        included_contractors, additional_contractor_price, contractor_count,
        included_properties, additional_property_price, property_count,
        monthly_charge, status, start_date, renewal_date, updated_at
    ) VALUES (
        p_company_id, v_saas.id, v_plan_name, v_base,
        v_inc_emp, v_per_emp, v_emp_count,
        v_inc_ct, v_per_ct, v_contractor_count,
        v_inc_prop, v_per_prop, v_property_count,
        v_charge, coalesce(v_saas.subscription_status, 'active'),
        coalesce(v_saas.created_at::date, CURRENT_DATE), v_renewal, now()
    )
    ON CONFLICT (company_id) DO UPDATE SET
        saas_subscription_id = EXCLUDED.saas_subscription_id,
        plan_name = EXCLUDED.plan_name,
        base_price = EXCLUDED.base_price,
        included_employees = EXCLUDED.included_employees,
        additional_employee_price = EXCLUDED.additional_employee_price,
        employee_count = EXCLUDED.employee_count,
        included_contractors = EXCLUDED.included_contractors,
        additional_contractor_price = EXCLUDED.additional_contractor_price,
        contractor_count = EXCLUDED.contractor_count,
        included_properties = EXCLUDED.included_properties,
        additional_property_price = EXCLUDED.additional_property_price,
        property_count = EXCLUDED.property_count,
        monthly_charge = EXCLUDED.monthly_charge,
        status = EXCLUDED.status,
        renewal_date = EXCLUDED.renewal_date,
        updated_at = now();

    IF v_saas.id IS NOT NULL THEN
        UPDATE public.saas_company_subscriptions
        SET current_employee_count = v_emp_count,
            amount_due = v_charge,
            updated_at = now()
        WHERE company_id = p_company_id;
    END IF;

    RETURN jsonb_build_object(
        'company_id', p_company_id,
        'plan_name', v_plan_name,
        'status', v_status,
        'renewal_date', v_renewal,
        'currency', 'ZAR',
        'base_price', v_base,
        'monthly_charge', v_charge,
        'employees', jsonb_build_object(
            'count', v_emp_count,
            'included', v_inc_emp,
            'overage', v_emp_over,
            'unit_price', v_per_emp,
            'overage_charge', v_emp_over * v_per_emp
        ),
        'contractors', jsonb_build_object(
            'count', v_contractor_count,
            'included', v_inc_ct,
            'overage', v_ct_over,
            'unit_price', v_per_ct,
            'overage_charge', v_ct_over * v_per_ct,
            'meter', 'portal_enabled_active'
        ),
        'properties', jsonb_build_object(
            'count', v_property_count,
            'included', v_inc_prop,
            'overage', v_prop_over,
            'unit_price', v_per_prop,
            'overage_charge', v_prop_over * v_per_prop,
            'meter', 'active_sites'
        ),
        'lines', (
            SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb)
            FROM (
                SELECT 1 AS ord, jsonb_build_object(
                    'description', format(
                        'Base plan (includes %s employees, %s portal contractors, %s properties)',
                        v_inc_emp, v_inc_ct, v_inc_prop
                    ),
                    'amount', v_base
                ) AS line
                UNION ALL
                SELECT 2, jsonb_build_object(
                    'description', format('Additional employees (%s × R%s)', v_emp_over, to_char(v_per_emp, 'FM999999990')),
                    'amount', v_emp_over * v_per_emp
                ) WHERE v_emp_over > 0
                UNION ALL
                SELECT 3, jsonb_build_object(
                    'description', format('Additional portal contractors (%s × R%s)', v_ct_over, to_char(v_per_ct, 'FM999999990')),
                    'amount', v_ct_over * v_per_ct
                ) WHERE v_ct_over > 0
                UNION ALL
                SELECT 4, jsonb_build_object(
                    'description', format('Additional properties (%s × R%s)', v_prop_over, to_char(v_per_prop, 'FM999999990')),
                    'amount', v_prop_over * v_per_prop
                ) WHERE v_prop_over > 0
            ) lines
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.company_get_billing_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_get_billing_summary(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Portal login requires portal_enabled
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.contractor_resolve_by_code(
  p_company_code   text,
  p_contractor_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT
      ct.id AS contractor_id,
      ct.company_id,
      ct.name AS contractor_name,
      ct.contractor_code,
      c.code AS company_code
    FROM public.contractors ct
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.is_active = true
      AND coalesce(ct.portal_enabled, false) = true
      AND ct.contractor_code IS NOT NULL
    LIMIT 1
  ) t;
$$;

-- Backfill billing snapshots for all companies
UPDATE public.company_subscriptions cs
SET
    employee_count = c.employee_count,
    contractor_count = c.contractor_count,
    property_count = c.property_count,
    included_employees = 25,
    additional_employee_price = 99,
    included_contractors = 50,
    additional_contractor_price = 49,
    included_properties = 20,
    additional_property_price = 49,
    base_price = 2500,
    plan_name = 'KaiSync Workforce Business',
    monthly_charge = public.kaiflow_calculate_monthly_charge(
        c.employee_count, c.contractor_count, c.property_count
    ),
    updated_at = now()
FROM public.companies co
CROSS JOIN LATERAL public.kaiflow_company_billing_counts(co.id) c
WHERE cs.company_id = co.id;

INSERT INTO public.company_subscriptions (
    company_id, plan_name, base_price,
    included_employees, additional_employee_price, employee_count,
    included_contractors, additional_contractor_price, contractor_count,
    included_properties, additional_property_price, property_count,
    monthly_charge, status
)
SELECT
    co.id,
    'KaiSync Workforce Business',
    2500,
    25, 99, c.employee_count,
    50, 49, c.contractor_count,
    20, 49, c.property_count,
    public.kaiflow_calculate_monthly_charge(c.employee_count, c.contractor_count, c.property_count),
    'active'
FROM public.companies co
CROSS JOIN LATERAL public.kaiflow_company_billing_counts(co.id) c
WHERE NOT EXISTS (
    SELECT 1 FROM public.company_subscriptions s WHERE s.company_id = co.id
);
