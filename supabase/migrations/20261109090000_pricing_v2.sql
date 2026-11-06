-- Pricing v2 (approved by Nyarie, 6 Nov 2026):
--   Starter  R1,500/month: up to 15 employees (hard limit: the 16th is blocked until they move to Business),
--            5 contractor + 5 client portal seats, R49 per extra seat.
--   Business R2,500/month: 25 employees, 15 + 15 seats; R49 per extra employee or seat.
--   Both: 5 properties included then R99 each; R1,000 per active farm; every module.
--   Annual: the monthly bill × 12, less 10%. Extras added during the year are billed monthly, less 10%.
--   VAT: off for now; a setting adds it on top later.
-- Additive only: new columns/table/functions; plan rows are backed up first. Rollback: see the end.

-- ── 0. Backup of the plan rows ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saas_plans_backup_20261106 AS SELECT * FROM public.saas_plans;
ALTER TABLE public.saas_plans_backup_20261106 ENABLE ROW LEVEL SECURITY;

-- ── 1. Columns and settings ────────────────────────────────────────────────
ALTER TABLE public.saas_plans ADD COLUMN IF NOT EXISTS max_employees integer
  CHECK (max_employees IS NULL OR max_employees > 0);           -- hard limit; NULL = no limit
ALTER TABLE public.saas_plans ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false; -- customers can choose it
ALTER TABLE public.saas_plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly'
  CHECK (billing_cycle IN ('monthly', 'annual'));
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS chosen_plan_id uuid REFERENCES public.saas_plans(id); -- picked during the trial
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS pending_plan_id uuid REFERENCES public.saas_plans(id); -- smaller plan from the next renewal
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS pending_cycle text CHECK (pending_cycle IN ('monthly', 'annual'));
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS annual_period_start date;
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS annual_period_end date;     -- paid up to
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS annual_paid_amount numeric(12,2); -- the annual bill, before VAT
ALTER TABLE public.saas_company_subscriptions ADD COLUMN IF NOT EXISTS annual_base_monthly numeric(12,2); -- monthly bill included in it (extras above it are billed monthly)

ALTER TABLE public.billing_bills ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'monthly'
  CHECK (kind IN ('monthly', 'annual', 'extras', 'upgrade'));
ALTER TABLE public.billing_bills ADD COLUMN IF NOT EXISTS snapshot jsonb;
ALTER TABLE public.billing_bills DROP CONSTRAINT IF EXISTS billing_bills_company_id_period_start_key;
CREATE UNIQUE INDEX IF NOT EXISTS billing_bills_company_period_kind_key ON public.billing_bills (company_id, period_start, kind)
  WHERE kind <> 'upgrade';

-- Platform-wide billing settings (one row). VAT stays off until KAI SYNC GROUP registers.
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  vat_enabled boolean NOT NULL DEFAULT false,
  vat_rate numeric(5,4) NOT NULL DEFAULT 0.15 CHECK (vat_rate >= 0 AND vat_rate < 1),
  annual_discount numeric(5,4) NOT NULL DEFAULT 0.10 CHECK (annual_discount >= 0 AND annual_discount < 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.billing_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_settings_platform ON public.billing_settings;
CREATE POLICY billing_settings_platform ON public.billing_settings FOR ALL TO authenticated
  USING (public.platform_is_admin()) WITH CHECK (public.platform_is_admin());

-- ── 2. The plans ───────────────────────────────────────────────────────────
-- Every module on both plans (copied from Business).
UPDATE public.saas_plans SET
  name = 'KaiSync Workforce Starter',
  description = 'R1,500/month for up to 15 employees, 5 contractor portal seats, 5 client portal seats and 5 properties. Extra: R49/portal seat, R99/property. Each active farm is R1,000. Over 15 employees: move to Business.',
  monthly_price = 1500, included_employees = 15, max_employees = 15, per_employee_price = 0,
  included_contractors = 5, per_contractor_price = 49, included_client_portals = 5, per_client_portal_price = 49,
  included_properties = 5, per_property_price = 99, per_farm_price = 1000,
  features_json = jsonb_set((SELECT features_json FROM public.saas_plans WHERE code = 'kaiflow_standard'), '{max_employees}', '15'),
  is_active = true, is_public = true, sort_order = 1
WHERE code = 'starter';

UPDATE public.saas_plans SET
  description = 'R2,500/month includes 25 employees, 15 contractor portal seats, 15 client portal seats and 5 properties. Extra: R49/employee, R49/contractor seat, R49/client portal, R99/property. Each active farm is R1,000.',
  per_employee_price = 49, max_employees = NULL, is_active = true, is_public = true, sort_order = 2
WHERE code = 'kaiflow_standard';

UPDATE public.saas_plans SET is_active = false, is_public = false WHERE code IN ('pro', 'enterprise');
UPDATE public.saas_plans SET is_public = false, sort_order = 0 WHERE code = 'free_trial';

-- ── 3. Price calculation (one place) ───────────────────────────────────────
-- The plan a company is billed on: its paid plan; during the trial the plan it chose; with no choice (or an
-- old plan), Starter when it fits in 15 employees, otherwise Business. A Starter choice with more than 15
-- active employees becomes Business.
CREATE OR REPLACE FUNCTION public.billing_effective_plan(p_company_id uuid)
RETURNS public.saas_plans LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.saas_company_subscriptions%ROWTYPE; p public.saas_plans%ROWTYPE; v_code text; v_emp int;
BEGIN
  SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = p_company_id;
  SELECT code INTO v_code FROM public.saas_plans WHERE id = s.plan_id;
  SELECT * INTO p FROM public.saas_plans
   WHERE id = CASE WHEN v_code = 'free_trial' OR v_code IS NULL THEN s.chosen_plan_id ELSE s.plan_id END
     AND is_public;
  SELECT employee_count INTO v_emp FROM public.kaiflow_company_billing_counts(p_company_id);
  IF p.id IS NULL OR (p.max_employees IS NOT NULL AND coalesce(v_emp, 0) > p.max_employees
                      AND coalesce(v_code, 'free_trial') = 'free_trial') THEN
    SELECT * INTO p FROM public.saas_plans
     WHERE is_public AND (max_employees IS NULL OR max_employees >= coalesce(v_emp, 0))
     ORDER BY monthly_price LIMIT 1;
  END IF;
  RETURN p;
END $$;

-- The bill for one plan, cycle and set of counts. Monthly lines as before; on annual: × 12, then the
-- discount as its own line; VAT on top when switched on. Amounts in rand, rounded to cents.
CREATE OR REPLACE FUNCTION public.billing_price(
  p_plan public.saas_plans, p_cycle text,
  p_emp int, p_ct int, p_clients int, p_prop int, p_farms int, p_override numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st public.billing_settings%ROWTYPE;
  v_emp_over int := GREATEST(0, coalesce(p_emp, 0) - coalesce(p_plan.included_employees, 0));
  v_ct_over int := GREATEST(0, coalesce(p_ct, 0) - coalesce(p_plan.included_contractors, 0));
  v_cl_over int := GREATEST(0, coalesce(p_clients, 0) - coalesce(p_plan.included_client_portals, 0));
  v_pr_over int := GREATEST(0, coalesce(p_prop, 0) - coalesce(p_plan.included_properties, 0));
  v_farms int := GREATEST(0, coalesce(p_farms, 0));
  v_lines jsonb; v_monthly numeric; v_sub numeric; v_disc numeric := 0; v_vat numeric := 0; v_months int;
BEGIN
  SELECT * INTO st FROM public.billing_settings WHERE id;
  IF p_plan.max_employees IS NOT NULL THEN v_emp_over := 0; END IF; -- Starter has no paid extra employees
  IF p_override IS NOT NULL THEN
    v_lines := jsonb_build_array(jsonb_build_object('description', 'Agreed monthly price', 'amount', p_override));
  ELSE
    SELECT coalesce(jsonb_agg(l ORDER BY o), '[]'::jsonb) INTO v_lines FROM (
      SELECT 1 o, jsonb_build_object('description', format('%s (includes %s employees, %s contractor portal seats, %s client portal seats, %s properties)',
        p_plan.name, p_plan.included_employees, p_plan.included_contractors, p_plan.included_client_portals, p_plan.included_properties),
        'amount', p_plan.monthly_price) l
      UNION ALL SELECT 2, jsonb_build_object('description', format('Additional employees (%s × R%s)', v_emp_over, to_char(p_plan.per_employee_price, 'FM999990')), 'amount', v_emp_over * p_plan.per_employee_price) WHERE v_emp_over > 0
      UNION ALL SELECT 3, jsonb_build_object('description', format('Additional contractor portal seats (%s × R%s)', v_ct_over, to_char(p_plan.per_contractor_price, 'FM999990')), 'amount', v_ct_over * p_plan.per_contractor_price) WHERE v_ct_over > 0
      UNION ALL SELECT 4, jsonb_build_object('description', format('Additional client portal seats (%s × R%s)', v_cl_over, to_char(p_plan.per_client_portal_price, 'FM999990')), 'amount', v_cl_over * p_plan.per_client_portal_price) WHERE v_cl_over > 0
      UNION ALL SELECT 5, jsonb_build_object('description', format('Additional properties (%s × R%s)', v_pr_over, to_char(p_plan.per_property_price, 'FM999990')), 'amount', v_pr_over * p_plan.per_property_price) WHERE v_pr_over > 0
      UNION ALL SELECT 6, jsonb_build_object('description', format('Farms (%s × R%s)', v_farms, to_char(p_plan.per_farm_price, 'FM999990')), 'amount', v_farms * p_plan.per_farm_price) WHERE v_farms > 0
    ) x;
  END IF;
  SELECT coalesce(sum((l ->> 'amount')::numeric), 0) INTO v_monthly FROM jsonb_array_elements(v_lines) l;
  v_months := CASE WHEN p_cycle = 'annual' THEN 12 ELSE 1 END;
  v_sub := v_monthly * v_months;
  IF p_cycle = 'annual' THEN v_disc := round(v_sub * st.annual_discount, 2); END IF;
  IF st.vat_enabled THEN v_vat := round((v_sub - v_disc) * st.vat_rate, 2); END IF;
  RETURN jsonb_build_object(
    'plan_code', p_plan.code, 'plan_name', p_plan.name, 'cycle', coalesce(p_cycle, 'monthly'), 'months', v_months,
    'lines', v_lines, 'monthly_subtotal', round(v_monthly, 2), 'subtotal', round(v_sub, 2),
    'discount', v_disc, 'discount_label', CASE WHEN v_disc > 0 THEN format('Annual discount (%s%%)', round(st.annual_discount * 100)) END,
    'vat', v_vat, 'vat_rate', CASE WHEN st.vat_enabled THEN st.vat_rate END,
    'total', round(v_sub - v_disc + v_vat, 2),
    'counts', jsonb_build_object('employees', p_emp, 'contractors', p_ct, 'client_portals', p_clients, 'properties', p_prop, 'farms', p_farms),
    'over', jsonb_build_object('employees', v_emp_over, 'contractors', v_ct_over, 'client_portals', v_cl_over, 'properties', v_pr_over));
END $$;

-- What a plan would cost: Settings → Billing previews, the platform admin, and the acceptance tests.
CREATE OR REPLACE FUNCTION public.billing_quote(
  p_plan_code text, p_cycle text, p_employees int, p_contractors int DEFAULT 0, p_client_portals int DEFAULT 0,
  p_properties int DEFAULT 0, p_farms int DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.saas_plans%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.saas_plans WHERE code = p_plan_code AND is_public;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;
  IF p_cycle NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'BAD_CYCLE'; END IF;
  RETURN public.billing_price(p, p_cycle, p_employees, p_contractors, p_client_portals, p_properties, p_farms)
    || jsonb_build_object('over_limit', p.max_employees IS NOT NULL AND p_employees > p.max_employees);
END $$;

-- ── 4. The company's billing summary (same shape as before, plus plan, cycle and totals) ──
CREATE OR REPLACE FUNCTION public.kaiflow_sync_company_subscription(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp int; v_ct int; v_prop int; v_clients int; v_farms int;
  v_saas public.saas_company_subscriptions%ROWTYPE;
  v_plan public.saas_plans%ROWTYPE;
  v_override numeric; v_home boolean := false; v_status text := 'active';
  q jsonb; qm jsonb; v_monthly numeric; v_standard numeric; v_lines jsonb; v_cycle text;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'company_id required'; END IF;
  SELECT coalesce(c.is_platform_home, false) INTO v_home FROM public.companies c WHERE c.id = p_company_id;
  SELECT cs.price_override INTO v_override FROM public.company_subscriptions cs WHERE cs.company_id = p_company_id;
  SELECT c.employee_count, c.contractor_count, c.property_count, c.client_portal_count, c.farm_count
    INTO v_emp, v_ct, v_prop, v_clients, v_farms FROM public.kaiflow_company_billing_counts(p_company_id) c;
  SELECT s.* INTO v_saas FROM public.saas_company_subscriptions s WHERE s.company_id = p_company_id;
  IF FOUND THEN v_status := coalesce(v_saas.subscription_status, v_saas.billing_status, 'active'); END IF;
  v_plan := public.billing_effective_plan(p_company_id);
  v_cycle := coalesce(v_saas.billing_cycle, 'monthly');
  IF v_home THEN v_override := NULL; END IF;

  -- Standard (no override) monthly amount, and the bill as charged.
  qm := public.billing_price(v_plan, 'monthly', v_emp, v_ct, v_clients, v_prop, v_farms, NULL);
  v_standard := (qm ->> 'monthly_subtotal')::numeric;
  q := public.billing_price(v_plan, v_cycle, v_emp, v_ct, v_clients, v_prop, v_farms, v_override);
  v_monthly := (q ->> 'monthly_subtotal')::numeric;
  v_lines := q -> 'lines';
  IF v_home THEN
    v_monthly := 0;
    v_lines := jsonb_build_array(jsonb_build_object('description', 'This company is KaiSync and is not billed.', 'amount', 0));
    q := q || jsonb_build_object('subtotal', 0, 'discount', 0, 'vat', 0, 'total', 0);
  END IF;

  INSERT INTO public.company_subscriptions (
    company_id, saas_subscription_id, plan_name, base_price,
    included_employees, additional_employee_price, employee_count,
    included_contractors, additional_contractor_price, contractor_count,
    included_properties, additional_property_price, property_count,
    included_client_portals, additional_client_portal_price, client_portal_count,
    farm_count, per_farm_price, monthly_charge, standard_monthly_charge, status, start_date, renewal_date, updated_at
  ) VALUES (
    p_company_id, v_saas.id, v_plan.name, v_plan.monthly_price,
    v_plan.included_employees, v_plan.per_employee_price, v_emp,
    v_plan.included_contractors, v_plan.per_contractor_price, v_ct,
    v_plan.included_properties, v_plan.per_property_price, v_prop,
    v_plan.included_client_portals, v_plan.per_client_portal_price, v_clients,
    v_farms, v_plan.per_farm_price, v_monthly, v_standard, coalesce(v_saas.subscription_status, 'active'),
    coalesce(v_saas.created_at::date, CURRENT_DATE), v_saas.renewal_date, now()
  )
  ON CONFLICT (company_id) DO UPDATE SET
    saas_subscription_id = EXCLUDED.saas_subscription_id, plan_name = EXCLUDED.plan_name, base_price = EXCLUDED.base_price,
    included_employees = EXCLUDED.included_employees, additional_employee_price = EXCLUDED.additional_employee_price,
    employee_count = EXCLUDED.employee_count, included_contractors = EXCLUDED.included_contractors,
    additional_contractor_price = EXCLUDED.additional_contractor_price, contractor_count = EXCLUDED.contractor_count,
    included_properties = EXCLUDED.included_properties, additional_property_price = EXCLUDED.additional_property_price,
    property_count = EXCLUDED.property_count, included_client_portals = EXCLUDED.included_client_portals,
    additional_client_portal_price = EXCLUDED.additional_client_portal_price, client_portal_count = EXCLUDED.client_portal_count,
    farm_count = EXCLUDED.farm_count, per_farm_price = EXCLUDED.per_farm_price,
    monthly_charge = EXCLUDED.monthly_charge, standard_monthly_charge = EXCLUDED.standard_monthly_charge,
    price_override = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override END,
    price_override_note = CASE WHEN v_home THEN NULL ELSE company_subscriptions.price_override_note END,
    status = EXCLUDED.status, renewal_date = EXCLUDED.renewal_date, updated_at = now();

  IF v_saas.id IS NOT NULL THEN
    UPDATE public.saas_company_subscriptions SET current_employee_count = v_emp, employee_limit = coalesce(v_plan.max_employees, employee_limit),
      amount_due = (q ->> 'total')::numeric, updated_at = now()
     WHERE company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'company_id', p_company_id, 'plan_name', v_plan.name, 'plan_code', v_plan.code, 'plan_chosen', v_saas.chosen_plan_id IS NOT NULL OR v_saas.subscription_status <> 'trialing',
    'max_employees', v_plan.max_employees, 'billing_cycle', v_cycle,
    'pending_plan_code', (SELECT code FROM public.saas_plans WHERE id = v_saas.pending_plan_id), 'pending_cycle', v_saas.pending_cycle,
    'annual_period_start', v_saas.annual_period_start, 'annual_period_end', v_saas.annual_period_end,
    'next_billing_date', v_saas.next_billing_date, 'trial_ends_at', v_saas.trial_ends_at,
    'status', v_status, 'renewal_date', v_saas.renewal_date, 'currency', 'ZAR',
    'base_price', CASE WHEN v_home THEN 0 ELSE v_plan.monthly_price END,
    'monthly_charge', v_monthly, 'standard_monthly_charge', v_standard, 'price_override', v_override, 'billable', NOT v_home,
    'cycle_subtotal', (q ->> 'subtotal')::numeric, 'discount', (q ->> 'discount')::numeric, 'discount_label', q ->> 'discount_label',
    'vat', (q ->> 'vat')::numeric, 'cycle_total', (q ->> 'total')::numeric,
    'employees', jsonb_build_object('count', v_emp, 'included', v_plan.included_employees, 'limit', v_plan.max_employees,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'employees')::int END, 'unit_price', v_plan.per_employee_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'employees')::int * v_plan.per_employee_price END),
    'contractors', jsonb_build_object('count', v_ct, 'included', v_plan.included_contractors,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'contractors')::int END, 'unit_price', v_plan.per_contractor_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'contractors')::int * v_plan.per_contractor_price END, 'meter', 'portal_enabled_active'),
    'client_portals', jsonb_build_object('count', v_clients, 'included', v_plan.included_client_portals,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'client_portals')::int END, 'unit_price', v_plan.per_client_portal_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'client_portals')::int * v_plan.per_client_portal_price END, 'meter', 'portal_enabled'),
    'properties', jsonb_build_object('count', v_prop, 'included', v_plan.included_properties,
      'overage', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'properties')::int END, 'unit_price', v_plan.per_property_price,
      'overage_charge', CASE WHEN v_home THEN 0 ELSE (q -> 'over' ->> 'properties')::int * v_plan.per_property_price END, 'meter', 'active_sites'),
    'farms', jsonb_build_object('count', v_farms, 'included', 0, 'overage', CASE WHEN v_home THEN 0 ELSE v_farms END,
      'unit_price', v_plan.per_farm_price, 'overage_charge', CASE WHEN v_home THEN 0 ELSE v_farms * v_plan.per_farm_price END, 'meter', 'active_farms'),
    'lines', v_lines);
END $$;

-- ── 5. Starter limit: the 16th active employee is refused until the company moves to Business ──
-- In the database so it covers every way in: the Employees page, import, self-registration, approving
-- pending staff and invites. Only on a paid Starter plan (not during the trial, not for KaiSync itself).
CREATE OR REPLACE FUNCTION public.enforce_plan_employee_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max int; v_status text; v_n int;
BEGIN
  IF NOT coalesce(NEW.is_active, true) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.is_active, true) AND OLD.company_id = NEW.company_id THEN RETURN NEW; END IF;
  SELECT p.max_employees, s.subscription_status INTO v_max, v_status
    FROM public.saas_company_subscriptions s JOIN public.saas_plans p ON p.id = s.plan_id
   WHERE s.company_id = NEW.company_id;
  IF v_max IS NULL OR v_status = 'trialing' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id = NEW.company_id AND coalesce(c.is_platform_home, false)) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('employee_limit:' || NEW.company_id::text));
  SELECT count(*) INTO v_n FROM public.employees e
   WHERE e.company_id = NEW.company_id AND coalesce(e.is_active, true) AND e.id IS DISTINCT FROM NEW.id;
  IF v_n >= v_max THEN
    RAISE EXCEPTION 'PLAN_EMPLOYEE_LIMIT:%', v_max
      USING HINT = format('You''ve reached %s employees, the Starter limit. Move to Business for R2,500/month, including 25 employees and 15 + 15 portal seats.', v_max);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_enforce_plan_employee_limit ON public.employees;
CREATE TRIGGER trg_enforce_plan_employee_limit BEFORE INSERT OR UPDATE OF is_active, company_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_employee_limit();

-- ── 6. Choosing or changing the plan (owner, HR, admins; platform admins) ─────
-- During the trial: just records the choice. After it:
--   bigger plan → now; the difference for the rest of the period is billed at once (an "upgrade" bill).
--     Monthly: (new − old monthly) × days left / days in the month.
--     Annual: unused old-plan months are credited against the remaining new-plan months, both at the
--     annual rate (paid R16,200 for Starter, move in month 7: credit R8,100, Business R13,500, pay R5,400).
--   smaller plan or cycle change → from the next renewal (no refunds mid-year).
CREATE OR REPLACE FUNCTION public.billing_change_plan(p_company_id uuid, p_plan_code text, p_cycle text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.saas_company_subscriptions%ROWTYPE; cur public.saas_plans%ROWTYPE; nw public.saas_plans%ROWTYPE;
  k record; per record; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_anchor date; v_days int; v_left int; v_months_left int; v_old numeric; v_new numeric; v_amount numeric; v_credit numeric;
  st public.billing_settings%ROWTYPE; v_bill uuid; v_mode text;
BEGIN
  IF NOT public.billing_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_cycle NOT IN ('monthly', 'annual') THEN RAISE EXCEPTION 'BAD_CYCLE'; END IF;
  SELECT * INTO nw FROM public.saas_plans WHERE code = p_plan_code AND is_public AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_NOT_AVAILABLE'; END IF;
  SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_SUBSCRIPTION'; END IF;
  SELECT * INTO k FROM public.kaiflow_company_billing_counts(p_company_id);
  IF nw.max_employees IS NOT NULL AND k.employee_count > nw.max_employees THEN
    RAISE EXCEPTION 'PLAN_EMPLOYEE_LIMIT:%', nw.max_employees
      USING HINT = format('You have %s active employees; %s allows up to %s.', k.employee_count, nw.name, nw.max_employees);
  END IF;

  IF s.subscription_status = 'trialing' THEN
    UPDATE public.saas_company_subscriptions SET chosen_plan_id = nw.id, billing_cycle = p_cycle, updated_at = now() WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'when', 'trial_end', 'plan_code', nw.code, 'cycle', p_cycle);
  END IF;

  SELECT * INTO cur FROM public.saas_plans WHERE id = s.plan_id;
  -- Same plan: only the cycle changes, from the next renewal.
  IF cur.id = nw.id OR nw.monthly_price <= cur.monthly_price THEN
    UPDATE public.saas_company_subscriptions
       SET pending_plan_id = CASE WHEN cur.id = nw.id THEN NULL ELSE nw.id END,
           pending_cycle = CASE WHEN p_cycle = s.billing_cycle THEN NULL ELSE p_cycle END, updated_at = now()
     WHERE id = s.id;
    RETURN jsonb_build_object('ok', true, 'when', 'renewal', 'plan_code', nw.code, 'cycle', p_cycle,
      'from', CASE WHEN s.billing_cycle = 'annual' THEN s.annual_period_end + 1 ELSE s.next_billing_date END);
  END IF;

  -- Bigger plan: now, with the difference billed.
  SELECT * INTO st FROM public.billing_settings WHERE id;
  v_anchor := (s.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date;
  SELECT * INTO per FROM public.billing_period_for(v_anchor, v_today);
  IF s.billing_cycle = 'annual' AND s.annual_period_end IS NOT NULL THEN
    v_months_left := GREATEST(1, (extract(year FROM age(s.annual_period_end + 1, per.period_start)) * 12
                                 + extract(month FROM age(s.annual_period_end + 1, per.period_start)))::int);
    v_credit := round(coalesce(s.annual_paid_amount, 0) * v_months_left / 12.0, 2);
    v_new := (public.billing_price(nw, 'annual', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'subtotal')::numeric
           - (public.billing_price(nw, 'annual', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'discount')::numeric;
    v_amount := GREATEST(0, round(v_new * v_months_left / 12.0 - v_credit, 2));
    UPDATE public.saas_company_subscriptions SET plan_id = nw.id, pending_plan_id = NULL,
      annual_paid_amount = round(v_new, 2),
      annual_base_monthly = (public.billing_price(nw, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric,
      updated_at = now() WHERE id = s.id;
  ELSE
    v_days := (per.period_end - per.period_start) + 1;
    v_left := (per.period_end - v_today) + 1;
    v_old := (public.billing_price(cur, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric;
    v_new := (public.billing_price(nw, 'monthly', k.employee_count, k.contractor_count, k.client_portal_count, k.property_count, k.farm_count) ->> 'monthly_subtotal')::numeric;
    v_amount := GREATEST(0, round((v_new - v_old) * v_left / v_days, 2));
    UPDATE public.saas_company_subscriptions SET plan_id = nw.id, pending_plan_id = NULL,
      pending_cycle = CASE WHEN p_cycle = s.billing_cycle THEN NULL ELSE p_cycle END, updated_at = now() WHERE id = s.id;
  END IF;
  IF st.vat_enabled THEN v_amount := v_amount + round(v_amount * st.vat_rate, 2); END IF;

  IF v_amount > 0 THEN
    SELECT mode INTO v_mode FROM public.billing_bills WHERE company_id = p_company_id ORDER BY created_at DESC LIMIT 1;
    INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
    VALUES (p_company_id, v_today, coalesce(CASE WHEN s.billing_cycle = 'annual' THEN s.annual_period_end END, per.period_end), v_amount,
      jsonb_build_array(jsonb_build_object('description', format('Move from %s to %s for the rest of the %s', cur.name, nw.name,
        CASE WHEN s.billing_cycle = 'annual' THEN format('year (%s months)', v_months_left) ELSE format('month (%s of %s days)', v_left, v_days) END), 'amount', v_amount)),
      nw.name, v_today, coalesce(v_mode, 'sandbox'), 'upgrade',
      jsonb_build_object('from', cur.code, 'to', nw.code, 'credit', v_credit, 'months_left', v_months_left, 'days_left', v_left))
    RETURNING id INTO v_bill;
  END IF;
  PERFORM public.kaiflow_sync_company_subscription(p_company_id);
  RETURN jsonb_build_object('ok', true, 'when', 'now', 'plan_code', nw.code, 'cycle', p_cycle, 'amount', v_amount, 'bill_id', v_bill);
END $$;

-- ── 7. Making the bills: monthly, annual (with monthly extras), renewals ─────
CREATE OR REPLACE FUNCTION public.billing_create_due_bills(p_mode text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; s public.saas_company_subscriptions%ROWTYPE; p record; v_plan public.saas_plans%ROWTYPE; k record;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; v_n int := 0; v_sum jsonb; q jsonb;
  st public.billing_settings%ROWTYPE; v_extra numeric; v_amount numeric; v_override numeric; v_start date;
BEGIN
  SELECT * INTO st FROM public.billing_settings WHERE id;
  FOR r IN
    SELECT c.id, (sc.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date anchor
      FROM public.companies c JOIN public.saas_company_subscriptions sc ON sc.company_id = c.id
     WHERE c.billing_enabled AND NOT coalesce(c.is_platform_home, false) AND sc.trial_ends_at IS NOT NULL
       AND (sc.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date <= v_today
  LOOP
    SELECT * INTO p FROM public.billing_period_for(r.anchor, v_today);
    SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = r.id FOR UPDATE;

    -- Trial over: lock in the plan (chosen, or the one that fits).
    IF s.subscription_status = 'trialing' THEN
      v_plan := public.billing_effective_plan(r.id);
      UPDATE public.saas_company_subscriptions SET plan_id = v_plan.id, chosen_plan_id = NULL WHERE id = s.id;
    END IF;
    -- Changes waiting for a renewal (smaller plan, other cycle).
    IF (s.pending_plan_id IS NOT NULL OR s.pending_cycle IS NOT NULL)
       AND (s.billing_cycle = 'monthly' OR s.annual_period_end IS NULL OR v_today > s.annual_period_end)
       AND NOT EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind IN ('monthly', 'annual')) THEN
      UPDATE public.saas_company_subscriptions SET plan_id = coalesce(pending_plan_id, plan_id), billing_cycle = coalesce(pending_cycle, billing_cycle),
        pending_plan_id = NULL, pending_cycle = NULL,
        annual_period_start = CASE WHEN coalesce(pending_cycle, billing_cycle) = 'monthly' THEN NULL ELSE annual_period_start END,
        annual_period_end = CASE WHEN coalesce(pending_cycle, billing_cycle) = 'monthly' THEN NULL ELSE annual_period_end END
       WHERE id = s.id;
    END IF;
    SELECT * INTO s FROM public.saas_company_subscriptions WHERE company_id = r.id;

    v_sum := public.kaiflow_sync_company_subscription(r.id);
    CONTINUE WHEN coalesce((v_sum ->> 'billable')::boolean, true) = false;

    IF s.billing_cycle = 'monthly' THEN
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind = 'monthly');
      v_amount := round(coalesce((v_sum ->> 'cycle_total')::numeric, 0), 2);
      CONTINUE WHEN v_amount <= 0;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, p.period_start, p.period_end, v_amount,
        coalesce(v_sum -> 'lines', '[]'::jsonb) || CASE WHEN (v_sum ->> 'vat')::numeric > 0 THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', (v_sum ->> 'vat')::numeric)) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', p.period_start, p_mode, 'monthly', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    ELSIF s.annual_period_end IS NULL OR v_today > s.annual_period_end THEN
      -- A new year: everything active now × 12, less the discount.
      v_start := coalesce(s.annual_period_end + 1, p.period_start);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = v_start AND b.kind = 'annual');
      v_amount := round(coalesce((v_sum ->> 'cycle_total')::numeric, 0), 2);
      CONTINUE WHEN v_amount <= 0;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, v_start, (v_start + interval '1 year' - interval '1 day')::date, v_amount,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('description', (l ->> 'description') || ' × 12 months', 'amount', (l ->> 'amount')::numeric * 12)), '[]'::jsonb)
           FROM jsonb_array_elements(v_sum -> 'lines') l)
        || jsonb_build_array(jsonb_build_object('description', v_sum ->> 'discount_label', 'amount', -(v_sum ->> 'discount')::numeric))
        || CASE WHEN (v_sum ->> 'vat')::numeric > 0 THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', (v_sum ->> 'vat')::numeric)) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', v_start, p_mode, 'annual', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN
        v_n := v_n + 1;
        UPDATE public.saas_company_subscriptions SET annual_period_start = v_start,
          annual_period_end = (v_start + interval '1 year' - interval '1 day')::date,
          annual_paid_amount = round((v_sum ->> 'cycle_subtotal')::numeric - (v_sum ->> 'discount')::numeric, 2),
          annual_base_monthly = (v_sum ->> 'monthly_charge')::numeric
         WHERE id = s.id;
      END IF;
    ELSE
      -- During the year: extras above what the annual bill covered, this month, less the discount.
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start AND b.kind = 'extras');
      v_extra := (v_sum ->> 'monthly_charge')::numeric - coalesce(s.annual_base_monthly, (v_sum ->> 'monthly_charge')::numeric);
      CONTINUE WHEN v_extra <= 0;
      v_amount := round(v_extra * (1 - st.annual_discount), 2);
      IF st.vat_enabled THEN v_amount := v_amount + round(v_amount * st.vat_rate, 2); END IF;
      INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode, kind, snapshot)
      VALUES (r.id, p.period_start, p.period_end, v_amount,
        jsonb_build_array(
          jsonb_build_object('description', 'Extras added since your annual bill (this month)', 'amount', v_extra),
          jsonb_build_object('description', format('Annual discount (%s%%)', round(st.annual_discount * 100)), 'amount', -round(v_extra * st.annual_discount, 2)))
        || CASE WHEN st.vat_enabled THEN jsonb_build_array(jsonb_build_object('description', 'VAT', 'amount', round(round(v_extra * (1 - st.annual_discount), 2) * st.vat_rate, 2))) ELSE '[]'::jsonb END,
        v_sum ->> 'plan_name', p.period_start, p_mode, 'extras', v_sum)
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    END IF;

    UPDATE public.saas_company_subscriptions SET subscription_status = 'active', billing_status = 'active',
           next_billing_date = (p.period_end + 1), updated_at = now()
     WHERE company_id = r.id AND subscription_status = 'trialing';
  END LOOP;
  RETURN v_n;
END $$;

-- ── 7b. Platform admin list: the plan each company is (or will be) billed on, and its cycle ──
CREATE OR REPLACE FUNCTION public.platform_search_companies(p_query text DEFAULT ''::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NOT public.platform_is_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  RETURN QUERY
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'code', c.code,
    'plan_code', coalesce(p.code, cs.plan_name),
    'billing_plan', (public.billing_effective_plan(c.id)).code,
    'billing_cycle', coalesce(s.billing_cycle, 'monthly'),
    'plan_chosen', s.chosen_plan_id IS NOT NULL OR coalesce(s.subscription_status, '') <> 'trialing',
    'subscription_status', coalesce(cs.status, s.subscription_status, 'unknown'),
    'employee_count', coalesce(cs.employee_count, s.current_employee_count, 0),
    'employee_limit', coalesce(cs.included_employees, s.employee_limit, 25),
    'monthly_charge', coalesce(cs.monthly_charge, 0),
    'standard_monthly_charge', coalesce(cs.standard_monthly_charge, cs.monthly_charge, 0),
    'price_override', cs.price_override,
    'is_platform_home', coalesce(c.is_platform_home, false),
    'created_at', c.created_at, 'subscription_active', c.subscription_active)
  FROM public.companies c
  LEFT JOIN public.saas_company_subscriptions s ON s.company_id = c.id
  LEFT JOIN public.saas_plans p ON p.id = s.plan_id
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  WHERE p_query IS NULL OR p_query = '' OR c.name ILIKE '%' || p_query || '%' OR c.code ILIKE '%' || p_query || '%'
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

-- ── 8. Access ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.billing_effective_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_price(public.saas_plans, text, int, int, int, int, int, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_plan_employee_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_create_due_bills(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_quote(text, text, int, int, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_quote(text, text, int, int, int, int, int) TO authenticated;
REVOKE ALL ON FUNCTION public.billing_change_plan(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_change_plan(uuid, text, text) TO authenticated;

-- ── 9. Winters: Business, keeping the agreed R1,500 (Nyarie, 6 Nov 2026) ─────
UPDATE public.saas_company_subscriptions s SET chosen_plan_id = (SELECT id FROM public.saas_plans WHERE code = 'kaiflow_standard')
  FROM public.companies c WHERE c.id = s.company_id AND c.name = 'WINTERS BUSINESS ENTERPRISE';

-- ── Rollback ───────────────────────────────────────────────────────────────
-- 1. Plans: UPDATE saas_plans p SET name=b.name, description=b.description, monthly_price=b.monthly_price, ... , is_active=b.is_active
--    FROM saas_plans_backup_20261106 b WHERE b.id = p.id;
-- 2. Functions: re-run kaiflow_sync_company_subscription from 20261027170000_company_price_override.sql and
--    billing_create_due_bills from 20261104100000_billing_run.sql.
-- 3. DROP TRIGGER trg_enforce_plan_employee_limit ON employees; platform_search_companies: re-run its
--    previous version (only adds keys, so the old page keeps working either way).
-- 4. Bills: CREATE UNIQUE INDEX on billing_bills (company_id, period_start) again (only monthly bills exist today).
-- The new columns, billing_settings and the new functions can stay; nothing else reads them.
