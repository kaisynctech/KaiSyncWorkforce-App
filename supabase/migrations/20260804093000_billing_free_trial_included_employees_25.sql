-- Align Free Trial included employees with Business (25, not legacy 15).

UPDATE public.saas_plans
SET
  included_employees = 25,
  included_contractors = coalesce(included_contractors, 50),
  included_properties = coalesce(included_properties, 20),
  description = 'Free trial — includes 25 employees, 50 portal contractors, and 20 properties (Business seat limits).'
WHERE code = 'free_trial';

UPDATE public.company_subscriptions cs
SET
  included_employees = 25,
  included_contractors = coalesce(cs.included_contractors, 50),
  included_properties = coalesce(cs.included_properties, 20),
  monthly_charge = public.kaiflow_calculate_monthly_charge(
    cs.employee_count,
    cs.contractor_count,
    cs.property_count,
    cs.base_price,
    25,
    cs.additional_employee_price,
    coalesce(cs.included_contractors, 50),
    cs.additional_contractor_price,
    coalesce(cs.included_properties, 20),
    cs.additional_property_price
  ),
  updated_at = now()
WHERE cs.included_employees = 15;
