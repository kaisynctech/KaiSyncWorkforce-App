-- An agreed price replaces the standard calculation for that company.
-- The platform home company stays at zero.

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS price_override numeric(12, 2),
  ADD COLUMN IF NOT EXISTS price_override_note text,
  ADD COLUMN IF NOT EXISTS standard_monthly_charge numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.company_subscriptions.price_override IS
  'When set, this is the monthly amount owed. Null means the standard price list.';

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
  v_standard numeric;
  v_override numeric;
  v_home boolean := false;
  v_lines jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id required';
  END IF;

  SELECT coalesce(c.is_platform_home, false) INTO v_home
  FROM public.companies c
  WHERE c.id = p_company_id;

  SELECT cs.price_override INTO v_override
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id;

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
  v_standard := public.kaiflow_calculate_monthly_charge(
    v_emp, v_ct, v_prop, v_clients, v_farms,
    v_base, v_inc_emp, v_per_emp, v_inc_ct, v_per_ct, v_inc_prop, v_per_prop,
    v_inc_portal, v_per_portal, v_per_farm
  );
  v_charge := v_standard;

  IF v_home THEN
    v_override := NULL;
    v_charge := 0;
    v_lines := jsonb_build_array(jsonb_build_object(
      'description', 'This company is KaiSync and is not billed.',
      'amount', 0
    ));
  ELSIF v_override IS NOT NULL THEN
    v_charge := v_override;
    v_lines := jsonb_build_array(jsonb_build_object(
      'description', 'Agreed monthly price',
      'amount', v_override
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
    monthly_charge, standard_monthly_charge, status, start_date, renewal_date, updated_at
  ) VALUES (
    p_company_id, v_saas.id, v_plan_name, v_base,
    v_inc_emp, v_per_emp, v_emp,
    v_inc_ct, v_per_ct, v_ct,
    v_inc_prop, v_per_prop, v_prop,
    v_inc_portal, v_per_portal, v_clients,
    v_farms, v_per_farm,
    v_charge, v_standard, coalesce(v_saas.subscription_status, 'active'),
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
    standard_monthly_charge = EXCLUDED.standard_monthly_charge,
    price_override = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override END,
    price_override_note = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override_note END,
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
    'standard_monthly_charge', v_standard,
    'price_override', v_override,
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

CREATE OR REPLACE FUNCTION public.platform_set_company_price(
  p_company_id uuid,
  p_amount numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_before numeric;
  v_note text;
  v_summary jsonb;
BEGIN
  IF NOT public.platform_is_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id AND is_platform_home) THEN
    RAISE EXCEPTION 'The platform home company is not billed';
  END IF;
  IF p_amount IS NOT NULL AND p_amount < 0 THEN
    RAISE EXCEPTION 'Price cannot be negative';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  SELECT cs.monthly_charge INTO v_before
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id;

  PERFORM public.kaiflow_sync_company_subscription(p_company_id);

  UPDATE public.company_subscriptions
  SET price_override = CASE WHEN p_amount IS NULL THEN NULL ELSE round(p_amount, 2) END,
      price_override_note = CASE WHEN p_amount IS NULL THEN NULL ELSE v_note END,
      updated_at = now()
  WHERE company_id = p_company_id;

  v_summary := public.kaiflow_sync_company_subscription(p_company_id);

  INSERT INTO public.saas_platform_audit_log (
    actor_user_id, action, target_type, target_id, company_id, detail_json
  )
  SELECT auth.uid(), 'price_override', 'company', p_company_id, p_company_id,
    jsonb_build_object(
      'previous_monthly_charge', v_before,
      'monthly_charge', cs.monthly_charge,
      'standard_monthly_charge', cs.standard_monthly_charge,
      'price_override', cs.price_override,
      'note', cs.price_override_note
    )
  FROM public.company_subscriptions cs
  WHERE cs.company_id = p_company_id;

  RETURN v_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_set_company_price(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_company_price(uuid, numeric, text) TO authenticated;

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
    'standard_monthly_charge', coalesce(cs.standard_monthly_charge, cs.monthly_charge, 0),
    'price_override', cs.price_override,
    'is_platform_home', coalesce(c.is_platform_home, false),
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

REVOKE ALL ON FUNCTION public.platform_search_companies(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_search_companies(text, integer, integer) TO authenticated;

DO $$
DECLARE
  v_row record;
  v_charge numeric;
  v_standard numeric;
  v_override numeric;
  v_homes integer;
  v_expected numeric;
BEGIN
  SELECT count(*) INTO v_homes FROM public.companies WHERE is_platform_home;
  IF v_homes IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected one platform home, found %', v_homes;
  END IF;

  UPDATE public.company_subscriptions cs
  SET price_override = 1500.00,
      price_override_note = 'Agreed price'
  FROM public.companies c
  WHERE cs.company_id = c.id
    AND c.code = '30'
    AND NOT c.is_platform_home;

  INSERT INTO public.saas_platform_audit_log (
    actor_user_id, action, target_type, target_id, company_id, detail_json
  )
  SELECT h.owner_user_id, 'price_override', 'company', c.id, c.id,
    jsonb_build_object('price_override', 1500, 'note', 'Agreed price')
  FROM public.companies c
  JOIN public.companies h ON h.is_platform_home
  WHERE c.code = '30'
    AND NOT c.is_platform_home
    AND h.owner_user_id IS NOT NULL;

  FOR v_row IN
    SELECT c.id,
           c.code,
           c.is_platform_home,
           b.employee_count,
           b.contractor_count,
           b.property_count,
           b.client_portal_count,
           b.farm_count
    FROM public.companies c
    CROSS JOIN LATERAL public.kaiflow_company_billing_counts(c.id) b
  LOOP
    PERFORM public.kaiflow_sync_company_subscription(v_row.id);
    SELECT cs.monthly_charge, cs.standard_monthly_charge, cs.price_override
      INTO v_charge, v_standard, v_override
    FROM public.company_subscriptions cs
    WHERE cs.company_id = v_row.id;

    v_expected := public.kaiflow_calculate_monthly_charge(
      v_row.employee_count,
      v_row.contractor_count,
      v_row.property_count,
      v_row.client_portal_count,
      v_row.farm_count
    );

    IF v_standard IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'standard price drifted for company %', v_row.code;
    END IF;

    IF v_row.is_platform_home THEN
      IF v_charge IS DISTINCT FROM 0 OR v_override IS NOT NULL THEN
        RAISE EXCEPTION 'platform home must not be billed';
      END IF;
    ELSIF v_row.code = '30' THEN
      IF v_override IS DISTINCT FROM 1500 OR v_charge IS DISTINCT FROM 1500 THEN
        RAISE EXCEPTION 'company 30 must be billed 1500, got %', v_charge;
      END IF;
    ELSIF v_override IS NULL THEN
      IF v_charge IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'company % charge no longer matches the standard price', v_row.code;
      END IF;
    ELSIF v_charge IS DISTINCT FROM v_override THEN
      RAISE EXCEPTION 'agreed price was not applied for company %', v_row.code;
    END IF;
  END LOOP;
END $$;
