-- Settings → Billing lists every monthly price, including parts a company is not using.

CREATE OR REPLACE FUNCTION public.company_get_billing_summary(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_base numeric;
  v_agreed boolean;
  v_billable boolean;
  v_extra numeric;
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

  v := public.kaiflow_sync_company_subscription(p_company_id);
  v_billable := coalesce((v->>'billable')::boolean, true);
  v_agreed := v->>'price_override' IS NOT NULL;

  v_base := nullif((v->>'base_price')::numeric, 0);
  IF v_base IS NULL THEN
    SELECT p.monthly_price INTO v_base
    FROM public.saas_plans p
    WHERE p.code = 'kaiflow_standard' AND p.is_active
    LIMIT 1;
  END IF;
  v_base := coalesce(v_base, 2500);

  IF NOT v_billable THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'charge',
      'description', 'This company is KaiSync and is not billed.',
      'amount', 0
    ));
  ELSIF v_agreed THEN
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'charge',
      'description', 'Agreed monthly price. This is the amount due.',
      'amount', (v->>'monthly_charge')::numeric
    ));
  ELSE
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'kind', 'charge',
      'description', format(
        'Base plan (includes %s employees, %s contractor portal seats, %s client portal seats, %s properties)',
        v->'employees'->>'included',
        v->'contractors'->>'included',
        v->'client_portals'->>'included',
        v->'properties'->>'included'
      ),
      'amount', v_base
    ));

    v_extra := coalesce((v->'employees'->>'overage_charge')::numeric, 0);
    IF v_extra > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'charge',
        'description', format(
          'Additional employees (%s × R%s)',
          v->'employees'->>'overage',
          to_char((v->'employees'->>'unit_price')::numeric, 'FM999999990')
        ),
        'amount', v_extra
      ));
    END IF;

    v_extra := coalesce((v->'contractors'->>'overage_charge')::numeric, 0);
    IF v_extra > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'charge',
        'description', format(
          'Additional contractor portal seats (%s × R%s)',
          v->'contractors'->>'overage',
          to_char((v->'contractors'->>'unit_price')::numeric, 'FM999999990')
        ),
        'amount', v_extra
      ));
    END IF;

    v_extra := coalesce((v->'client_portals'->>'overage_charge')::numeric, 0);
    IF v_extra > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'charge',
        'description', format(
          'Additional client portal seats (%s × R%s)',
          v->'client_portals'->>'overage',
          to_char((v->'client_portals'->>'unit_price')::numeric, 'FM999999990')
        ),
        'amount', v_extra
      ));
    END IF;

    v_extra := coalesce((v->'properties'->>'overage_charge')::numeric, 0);
    IF v_extra > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'charge',
        'description', format(
          'Additional properties (%s × R%s)',
          v->'properties'->>'overage',
          to_char((v->'properties'->>'unit_price')::numeric, 'FM999999990')
        ),
        'amount', v_extra
      ));
    END IF;

    v_extra := coalesce((v->'farms'->>'overage_charge')::numeric, 0);
    IF v_extra > 0 THEN
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'kind', 'charge',
        'description', format(
          'Farms (%s × R%s)',
          v->'farms'->>'count',
          to_char((v->'farms'->>'unit_price')::numeric, 'FM999999990')
        ),
        'amount', v_extra
      ));
    END IF;
  END IF;

  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — base plan per month%s. Includes %s employees, %s contractor portal seats, %s client portal seats and %s properties.',
        CASE WHEN v_agreed OR NOT v_billable THEN ' (not added on top of the amount due)' ELSE '' END,
        v->'employees'->>'included',
        v->'contractors'->>'included',
        v->'client_portals'->>'included',
        v->'properties'->>'included'
      ),
      'amount', v_base
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — each extra employee per month after %s. You have %s.',
        v->'employees'->>'included',
        v->'employees'->>'count'
      ),
      'amount', (v->'employees'->>'unit_price')::numeric
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — each extra contractor portal seat per month after %s. You have %s.',
        v->'contractors'->>'included',
        v->'contractors'->>'count'
      ),
      'amount', (v->'contractors'->>'unit_price')::numeric
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — each extra client portal seat per month after %s. You have %s.',
        v->'client_portals'->>'included',
        v->'client_portals'->>'count'
      ),
      'amount', (v->'client_portals'->>'unit_price')::numeric
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — each extra property per month after %s. You have %s.',
        v->'properties'->>'included',
        v->'properties'->>'count'
      ),
      'amount', (v->'properties'->>'unit_price')::numeric
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', format(
        'Price list — each active farm per month. None are included. You have %s.',
        v->'farms'->>'count'
      ),
      'amount', (v->'farms'->>'unit_price')::numeric
    ),
    jsonb_build_object(
      'kind', 'price_list',
      'description', 'Included in the base price, including modules that are switched off: workforce, jobs and projects, clients, contractors, supply and assets, incidents, reports, and My PA.',
      'amount', 0
    )
  );

  RETURN jsonb_set(v, '{lines}', v_lines);
END;
$$;

REVOKE ALL ON FUNCTION public.company_get_billing_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_get_billing_summary(uuid) TO authenticated;
