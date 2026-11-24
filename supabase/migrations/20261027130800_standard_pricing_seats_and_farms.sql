-- Standard price: R2,500 includes 25 employees, 15 contractor portal seats,
-- 15 client portal seats and 5 properties.
-- Extra: R99 / employee, R49 / contractor seat, R49 / client portal, R99 / property.
-- Each active farm is R1,000. The commercial price list is kaiflow_standard.
-- Trial status stays on the subscription; the amount shown is this price.

ALTER TABLE public.saas_plans
  ADD COLUMN IF NOT EXISTS included_client_portals integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS per_client_portal_price numeric(12, 2) NOT NULL DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS per_farm_price numeric(12, 2) NOT NULL DEFAULT 1000.00;

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS included_client_portals integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS additional_client_portal_price numeric(12, 2) NOT NULL DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS client_portal_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS farm_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_farm_price numeric(12, 2) NOT NULL DEFAULT 1000.00;

UPDATE public.saas_plans
SET
  name = 'KaiSync Workforce Business',
  description = 'R2,500/month includes 25 employees, 15 contractor portal seats, 15 client portal seats and 5 properties. Extra: R99/employee, R49/contractor seat, R49/client portal, R99/property. Each active farm is R1,000.',
  monthly_price = 2500.00,
  included_employees = 25,
  per_employee_price = 99.00,
  included_contractors = 15,
  per_contractor_price = 49.00,
  included_properties = 5,
  per_property_price = 99.00,
  included_client_portals = 15,
  per_client_portal_price = 49.00,
  per_farm_price = 1000.00,
  is_active = true
WHERE code = 'kaiflow_standard';

DROP FUNCTION IF EXISTS public.kaiflow_calculate_monthly_charge(
  integer, integer, integer, numeric, integer, numeric, integer, numeric, integer, numeric
) CASCADE;

CREATE OR REPLACE FUNCTION public.kaiflow_calculate_monthly_charge(
  p_employee_count integer,
  p_contractor_count integer,
  p_property_count integer,
  p_client_portal_count integer,
  p_farm_count integer,
  p_base_price numeric DEFAULT 2500,
  p_included_employees integer DEFAULT 25,
  p_per_employee numeric DEFAULT 99,
  p_included_contractors integer DEFAULT 15,
  p_per_contractor numeric DEFAULT 49,
  p_included_properties integer DEFAULT 5,
  p_per_property numeric DEFAULT 99,
  p_included_client_portals integer DEFAULT 15,
  p_per_client_portal numeric DEFAULT 49,
  p_per_farm numeric DEFAULT 1000
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_base_price, 2500)
    + (GREATEST(0, coalesce(p_employee_count, 0) - coalesce(p_included_employees, 25)) * coalesce(p_per_employee, 99))
    + (GREATEST(0, coalesce(p_contractor_count, 0) - coalesce(p_included_contractors, 15)) * coalesce(p_per_contractor, 49))
    + (GREATEST(0, coalesce(p_property_count, 0) - coalesce(p_included_properties, 5)) * coalesce(p_per_property, 99))
    + (GREATEST(0, coalesce(p_client_portal_count, 0) - coalesce(p_included_client_portals, 15)) * coalesce(p_per_client_portal, 49))
    + (GREATEST(0, coalesce(p_farm_count, 0)) * coalesce(p_per_farm, 1000));
$$;

REVOKE ALL ON FUNCTION public.kaiflow_calculate_monthly_charge(
  integer, integer, integer, integer, integer, numeric, integer, numeric, integer, numeric, integer, numeric, integer, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kaiflow_calculate_monthly_charge(
  integer, integer, integer, integer, integer, numeric, integer, numeric, integer, numeric, integer, numeric, integer, numeric, numeric
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.kaiflow_company_billing_counts(uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.kaiflow_company_billing_counts(p_company_id uuid)
RETURNS TABLE (
  employee_count integer,
  contractor_count integer,
  property_count integer,
  client_portal_count integer,
  farm_count integer
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
    ),
    (
      SELECT count(*)::integer
      FROM public.contractors c
      WHERE c.company_id = p_company_id
        AND coalesce(c.is_active, true)
        AND coalesce(c.portal_enabled, false)
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    (
      SELECT count(*)::integer
      FROM public.sites s
      WHERE s.company_id = p_company_id
        AND coalesce(s.is_active, true)
    ),
    (
      SELECT count(*)::integer
      FROM public.clients cl
      WHERE cl.company_id = p_company_id
        AND coalesce(cl.portal_enabled, false)
    ),
    (
      SELECT count(*)::integer
      FROM public.farms f
      WHERE f.company_id = p_company_id
        AND coalesce(f.is_active, true)
    );
$$;

REVOKE ALL ON FUNCTION public.kaiflow_company_billing_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kaiflow_company_billing_counts(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.kaiflow_sync_company_subscription(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_emp integer;
  v_ct integer;
  v_prop integer;
  v_clients integer;
  v_farms integer;
  v_saas public.saas_company_subscriptions%ROWTYPE;
  v_plan public.saas_plans%ROWTYPE;
  v_base numeric := 2500;
  v_inc_emp integer := 25;
  v_per_emp numeric := 99;
  v_inc_ct integer := 15;
  v_per_ct numeric := 49;
  v_inc_prop integer := 5;
  v_per_prop numeric := 99;
  v_inc_portal integer := 15;
  v_per_portal numeric := 49;
  v_per_farm numeric := 1000;
  v_plan_name text := 'KaiSync Workforce Business';
  v_status text := 'active';
  v_renewal date;
  v_emp_over integer;
  v_ct_over integer;
  v_prop_over integer;
  v_portal_over integer;
  v_charge numeric;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required';
  END IF;

  SELECT c.employee_count, c.contractor_count, c.property_count, c.client_portal_count, c.farm_count
    INTO v_emp, v_ct, v_prop, v_clients, v_farms
  FROM public.kaiflow_company_billing_counts(p_company_id) c;

  SELECT s.* INTO v_saas
  FROM public.saas_company_subscriptions s
  WHERE s.company_id = p_company_id;

  IF FOUND THEN
    v_status := coalesce(v_saas.subscription_status, v_saas.billing_status, 'active');
    v_renewal := v_saas.renewal_date;
  END IF;

  SELECT * INTO v_plan FROM public.saas_plans WHERE code = 'kaiflow_standard' AND is_active = true;
  IF FOUND THEN
    v_base := coalesce(v_plan.monthly_price, v_base);
    v_inc_emp := coalesce(v_plan.included_employees, v_inc_emp);
    v_per_emp := coalesce(v_plan.per_employee_price, v_per_emp);
    v_inc_ct := coalesce(v_plan.included_contractors, v_inc_ct);
    v_per_ct := coalesce(v_plan.per_contractor_price, v_per_ct);
    v_inc_prop := coalesce(v_plan.included_properties, v_inc_prop);
    v_per_prop := coalesce(v_plan.per_property_price, v_per_prop);
    v_inc_portal := coalesce(v_plan.included_client_portals, v_inc_portal);
    v_per_portal := coalesce(v_plan.per_client_portal_price, v_per_portal);
    v_per_farm := coalesce(v_plan.per_farm_price, v_per_farm);
    v_plan_name := coalesce(v_plan.name, v_plan_name);
  END IF;

  v_emp_over := GREATEST(0, v_emp - v_inc_emp);
  v_ct_over := GREATEST(0, v_ct - v_inc_ct);
  v_prop_over := GREATEST(0, v_prop - v_inc_prop);
  v_portal_over := GREATEST(0, v_clients - v_inc_portal);
  v_charge := public.kaiflow_calculate_monthly_charge(
    v_emp, v_ct, v_prop, v_clients, v_farms,
    v_base, v_inc_emp, v_per_emp, v_inc_ct, v_per_ct, v_inc_prop, v_per_prop,
    v_inc_portal, v_per_portal, v_per_farm
  );

  INSERT INTO public.company_subscriptions (
    company_id, saas_subscription_id, plan_name, base_price,
    included_employees, additional_employee_price, employee_count,
    included_contractors, additional_contractor_price, contractor_count,
    included_properties, additional_property_price, property_count,
    included_client_portals, additional_client_portal_price, client_portal_count,
    farm_count, per_farm_price,
    monthly_charge, status, start_date, renewal_date, updated_at
  ) VALUES (
    p_company_id, v_saas.id, v_plan_name, v_base,
    v_inc_emp, v_per_emp, v_emp,
    v_inc_ct, v_per_ct, v_ct,
    v_inc_prop, v_per_prop, v_prop,
    v_inc_portal, v_per_portal, v_clients,
    v_farms, v_per_farm,
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
    included_client_portals = EXCLUDED.included_client_portals,
    additional_client_portal_price = EXCLUDED.additional_client_portal_price,
    client_portal_count = EXCLUDED.client_portal_count,
    farm_count = EXCLUDED.farm_count,
    per_farm_price = EXCLUDED.per_farm_price,
    monthly_charge = EXCLUDED.monthly_charge,
    status = EXCLUDED.status,
    renewal_date = EXCLUDED.renewal_date,
    updated_at = now();

  IF v_saas.id IS NOT NULL THEN
    UPDATE public.saas_company_subscriptions
    SET current_employee_count = v_emp,
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
      'count', v_emp, 'included', v_inc_emp, 'overage', v_emp_over,
      'unit_price', v_per_emp, 'overage_charge', v_emp_over * v_per_emp
    ),
    'contractors', jsonb_build_object(
      'count', v_ct, 'included', v_inc_ct, 'overage', v_ct_over,
      'unit_price', v_per_ct, 'overage_charge', v_ct_over * v_per_ct,
      'meter', 'portal_enabled_active'
    ),
    'client_portals', jsonb_build_object(
      'count', v_clients, 'included', v_inc_portal, 'overage', v_portal_over,
      'unit_price', v_per_portal, 'overage_charge', v_portal_over * v_per_portal,
      'meter', 'portal_enabled'
    ),
    'properties', jsonb_build_object(
      'count', v_prop, 'included', v_inc_prop, 'overage', v_prop_over,
      'unit_price', v_per_prop, 'overage_charge', v_prop_over * v_per_prop,
      'meter', 'active_sites'
    ),
    'farms', jsonb_build_object(
      'count', v_farms, 'included', 0, 'overage', v_farms,
      'unit_price', v_per_farm, 'overage_charge', v_farms * v_per_farm,
      'meter', 'active_farms'
    ),
    'lines', (
      SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb)
      FROM (
        SELECT 1 AS ord, jsonb_build_object(
          'description', format(
            'Base plan (includes %s employees, %s contractor portal seats, %s client portal seats, %s properties)',
            v_inc_emp, v_inc_ct, v_inc_portal, v_inc_prop
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
          'description', format('Additional contractor portal seats (%s × R%s)', v_ct_over, to_char(v_per_ct, 'FM999999990')),
          'amount', v_ct_over * v_per_ct
        ) WHERE v_ct_over > 0
        UNION ALL
        SELECT 4, jsonb_build_object(
          'description', format('Additional client portal seats (%s × R%s)', v_portal_over, to_char(v_per_portal, 'FM999999990')),
          'amount', v_portal_over * v_per_portal
        ) WHERE v_portal_over > 0
        UNION ALL
        SELECT 5, jsonb_build_object(
          'description', format('Additional properties (%s × R%s)', v_prop_over, to_char(v_per_prop, 'FM999999990')),
          'amount', v_prop_over * v_per_prop
        ) WHERE v_prop_over > 0
        UNION ALL
        SELECT 6, jsonb_build_object(
          'description', format('Farms (%s × R%s)', v_farms, to_char(v_per_farm, 'FM999999990')),
          'amount', v_farms * v_per_farm
        ) WHERE v_farms > 0
      ) lines
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kaiflow_sync_company_subscription(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.company_get_billing_summary(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
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

  RETURN public.kaiflow_sync_company_subscription(p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.company_get_billing_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_get_billing_summary(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_refresh_company_subscription(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NOT public.platform_is_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  RETURN public.kaiflow_sync_company_subscription(p_company_id);
END;
$$;

REVOKE ALL ON FUNCTION public.platform_refresh_company_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_refresh_company_subscription(uuid) TO authenticated;

DO $$
DECLARE
  v_inside numeric;
  v_over numeric;
  v_company uuid;
BEGIN
  v_inside := public.kaiflow_calculate_monthly_charge(25, 15, 5, 15, 0);
  v_over := public.kaiflow_calculate_monthly_charge(26, 16, 6, 16, 2);
  IF v_inside IS DISTINCT FROM 2500 THEN
    RAISE EXCEPTION 'Included seats must cost 2500, got %', v_inside;
  END IF;
  IF v_over IS DISTINCT FROM 4796 THEN
    RAISE EXCEPTION 'Overage example must cost 4796, got %', v_over;
  END IF;

  FOR v_company IN SELECT id FROM public.companies LOOP
    PERFORM public.kaiflow_sync_company_subscription(v_company);
  END LOOP;
END $$;
