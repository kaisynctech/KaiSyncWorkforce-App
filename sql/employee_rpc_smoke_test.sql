-- Employee RPC smoke test
-- Purpose: verify the phase2 RPCs exist and execute.
-- Run block-by-block in Supabase SQL editor and replace placeholders first.

-- 1) Replace these values
--    company code: your tenant code (example '01')
--    employee code: a valid employee code for that company
with ctx as (
  select
    '01'::text as company_code,
    'FN211956'::text as employee_code
)
select *
from public.employee_resolve_by_code(
  (select company_code from ctx),
  (select employee_code from ctx)
);

-- 2) Build typed ids from resolve result
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956')
  limit 1
)
select
  employee_id,
  company_id
from resolved;

-- 3) Jobs for employee (should return only assigned jobs in same company)
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956')
  limit 1
)
select count(*) as job_count
from public.employee_get_jobs_for_employee(
  (select company_id from resolved),
  (select employee_id from resolved)
);

-- 4) Incidents list should run without permission/function errors
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956')
  limit 1
)
select count(*) as incident_count
from public.employee_get_incidents_for_employee(
  (select company_id from resolved),
  (select employee_id from resolved)
);

-- 5) Inventory listing should run without permission/function errors
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956')
  limit 1
)
select count(*) as inventory_count
from public.employee_get_inventory_items(
  (select company_id from resolved),
  (select employee_id from resolved)
);

-- 6) Optional: dry-run incident insert (commented to avoid writing data by default)
-- with resolved as (
--   select *
--   from public.employee_resolve_by_code('01', 'FN211956')
--   limit 1
-- )
-- select public.employee_insert_incident(
--   (select company_id from resolved),
--   (select employee_id from resolved),
--   null,
--   'Smoke test incident',
--   'low',
--   now(),
--   array[]::text[]
-- );
