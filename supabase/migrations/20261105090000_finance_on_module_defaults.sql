-- Finance is part of every KaiSync plan (it was switched off on the Free Trial and Starter seed plans,
-- which is what every company is on while trialling).
UPDATE public.saas_plans
   SET features_json = jsonb_set(features_json, '{features,finance_module}', 'true'::jsonb, true),
       description = CASE WHEN code = 'free_trial' THEN '30-day free trial with every module.' ELSE description END
 WHERE coalesce((features_json->'features'->>'finance_module')::boolean, false) = false;

-- New companies now start with every module except Farms and Property Management (app defaults).
-- Companies that relied on the old defaults (no saved module settings) keep exactly what they had.
UPDATE public.companies
   SET enabled_modules = jsonb_build_object(
     'ticketing', true, 'clients', true, 'inventory', true, 'suppliers', true, 'attendance', true, 'reports', true,
     'scheduling', true, 'payroll', true, 'paperless', false, 'incidents', true, 'employees', true, 'contractors', true,
     'property_management', true, 'asset_compliance', true, 'my_pa', true, 'leave', true, 'messaging', true,
     'settings', true, 'farms', false)
 WHERE coalesce(enabled_modules, '{}'::jsonb) = '{}'::jsonb;
