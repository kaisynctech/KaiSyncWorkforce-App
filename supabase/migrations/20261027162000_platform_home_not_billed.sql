-- The platform home company is KaiSync. It is never a customer of itself.

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
  v_home boolean := false;
  v_lines jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required';
  END IF;

  SELECT coalesce(c.is_platform_home, false) INTO v_home
  FROM public.companies c
  WHERE c.id = p_company_id;

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

  IF v_home THEN
    v_charge := 0;
    v_lines := jsonb_build_array(jsonb_build_object(
      'description', 'This company is KaiSync and is not billed.',
      'amount', 0
    ));
  ELSE
    SELECT coalesce(jsonb_agg(line ORDER BY ord), '[]'::jsonb) INTO v_lines
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
    ) lines;
  END IF;

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
    'base_price', CASE WHEN v_home THEN 0 ELSE v_base END,
    'monthly_charge', v_charge,
    'billable', NOT v_home,
    'employees', jsonb_build_object(
      'count', v_emp, 'included', v_inc_emp, 'overage', CASE WHEN v_home THEN 0 ELSE v_emp_over END,
      'unit_price', v_per_emp, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_emp_over * v_per_emp END
    ),
    'contractors', jsonb_build_object(
      'count', v_ct, 'included', v_inc_ct, 'overage', CASE WHEN v_home THEN 0 ELSE v_ct_over END,
      'unit_price', v_per_ct, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_ct_over * v_per_ct END,
      'meter', 'portal_enabled_active'
    ),
    'client_portals', jsonb_build_object(
      'count', v_clients, 'included', v_inc_portal, 'overage', CASE WHEN v_home THEN 0 ELSE v_portal_over END,
      'unit_price', v_per_portal, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_portal_over * v_per_portal END,
      'meter', 'portal_enabled'
    ),
    'properties', jsonb_build_object(
      'count', v_prop, 'included', v_inc_prop, 'overage', CASE WHEN v_home THEN 0 ELSE v_prop_over END,
      'unit_price', v_per_prop, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_prop_over * v_per_prop END,
      'meter', 'active_sites'
    ),
    'farms', jsonb_build_object(
      'count', v_farms, 'included', 0, 'overage', CASE WHEN v_home THEN 0 ELSE v_farms END,
      'unit_price', v_per_farm, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_farms * v_per_farm END,
      'meter', 'active_farms'
    ),
    'lines', v_lines
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kaiflow_sync_company_subscription(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_home uuid;
  v_charge numeric;
  v_other record;
  v_homes integer;
BEGIN
  SELECT count(*) INTO v_homes FROM public.companies WHERE is_platform_home;
  IF v_homes IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected one platform home, found %', v_homes;
  END IF;

  SELECT id INTO v_home FROM public.companies WHERE is_platform_home;
  PERFORM public.kaiflow_sync_company_subscription(v_home);
  SELECT monthly_charge INTO v_charge
  FROM public.company_subscriptions
  WHERE company_id = v_home;
  IF v_charge IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'platform home must not be billed, got %', v_charge;
  END IF;

  FOR v_other IN
    SELECT c.id,
           b.employee_count,
           b.contractor_count,
           b.property_count,
           b.client_portal_count,
           b.farm_count
    FROM public.companies c
    CROSS JOIN LATERAL public.kaiflow_company_billing_counts(c.id) b
    WHERE NOT c.is_platform_home
  LOOP
    PERFORM public.kaiflow_sync_company_subscription(v_other.id);
    SELECT monthly_charge INTO v_charge
    FROM public.company_subscriptions
    WHERE company_id = v_other.id;
    IF v_charge IS DISTINCT FROM public.kaiflow_calculate_monthly_charge(
      v_other.employee_count,
      v_other.contractor_count,
      v_other.property_count,
      v_other.client_portal_count,
      v_other.farm_count
    ) THEN
      RAISE EXCEPTION 'customer company charge no longer matches the standard price';
    END IF;
  END LOOP;
END $$;
