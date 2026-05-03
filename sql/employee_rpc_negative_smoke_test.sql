-- Employee RPC negative smoke test (tenant isolation)
-- Run block-by-block in Supabase SQL editor after replacing placeholders.
-- Expected outcome: cross-tenant reads return 0 rows, and cross-tenant writes fail.

-- Replace with real values:
--   A = tenant/employee you are testing as primary
--   B = a different tenant and a valid employee in that tenant
with a as (
  select * from public.employee_resolve_by_code('01', 'FN211956') limit 1
),
b as (
  select * from public.employee_resolve_by_code('02', 'FN999999') limit 1
)
select
  (select company_id from a) as a_company_id,
  (select employee_id from a) as a_employee_id,
  (select company_id from b) as b_company_id,
  (select employee_id from b) as b_employee_id;

-- 1) Read jobs using A employee against B company (must be 0)
with a as (
  select * from public.employee_resolve_by_code('01', 'FN211956') limit 1
),
b as (
  select * from public.employee_resolve_by_code('02', 'FN999999') limit 1
)
select count(*) as should_be_zero
from public.employee_get_jobs_for_employee(
  (select company_id from b),
  (select employee_id from a)
);

-- 2) Read incidents using A employee against B company (must be 0)
with a as (
  select * from public.employee_resolve_by_code('01', 'FN211956') limit 1
),
b as (
  select * from public.employee_resolve_by_code('02', 'FN999999') limit 1
)
select count(*) as should_be_zero
from public.employee_get_incidents_for_employee(
  (select company_id from b),
  (select employee_id from a)
);

-- 3) Read inventory usage for B job with A employee (must be 0)
-- Replace p_job_id with a real job id from tenant B.
with a as (
  select * from public.employee_resolve_by_code('01', 'FN211956') limit 1
),
b as (
  select * from public.employee_resolve_by_code('02', 'FN999999') limit 1
)
select count(*) as should_be_zero
from public.employee_get_inventory_usage_for_job(
  (select company_id from b),
  1, -- TODO: replace with tenant B job id
  (select employee_id from a)
);

-- 4) Cross-tenant write should fail (uncomment to test)
-- Replace p_job_id with a real tenant B job id assigned in B.
-- with a as (
--   select * from public.employee_resolve_by_code('01', 'FN211956') limit 1
-- ),
-- b as (
--   select * from public.employee_resolve_by_code('02', 'FN999999') limit 1
-- )
-- select public.employee_update_job_status(
--   (select company_id from b),
--   (select employee_id from a),
--   1, -- TODO: replace with tenant B job id
--   'in_progress'
-- );
-- Expected: exception "Not allowed to update this job"
