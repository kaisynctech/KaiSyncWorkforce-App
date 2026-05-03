-- Smart scheduling + routing smoke test
-- Replace placeholders before running.
--
-- IMPORTANT:
-- If step 1 returns 0 rows, STOP and use a valid company/employee code first.

-- 1) Resolve an existing employee in your tenant (must return exactly 1 row)
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956') -- TODO replace
  limit 1
)
select company_id, employee_id
from resolved;

-- 2) Create a sample shift + immediately offer assignment (no manual shift_id needed)
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956') -- TODO replace
  limit 1
),
new_shift as (
  insert into public.shifts (
    company_id, title, starts_at, ends_at, required_headcount, status
  )
  select
    r.company_id,
    'Smoke Shift',
    now() + interval '2 hour',
    now() + interval '10 hour',
    1,
    'open'
  from resolved r
  returning id, company_id
)
insert into public.shift_assignments (
  company_id, shift_id, employee_id, status
)
select
  s.company_id,
  s.id as shift_id,
  r.employee_id,
  'offered'
from new_shift s
join resolved r on r.company_id = s.company_id
on conflict (shift_id, employee_id) do update set status = excluded.status
returning id, shift_id, employee_id, status;

-- 3) Optional recipient routing test
-- Replace recipient_user_id with a REAL auth.users UUID linked in hr_users for same company.
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956') -- TODO replace
  limit 1
)
insert into public.submission_recipients (
  company_id, submission_type, submission_id, recipient_user_id
)
select
  r.company_id,
  'incident',
  99999,
  '00000000-0000-0000-0000-000000000000'::uuid -- TODO replace
from resolved r
on conflict do nothing;

-- 4) Optional notification queue test
-- Replace recipient_user_id with same real UUID as above.
with resolved as (
  select *
  from public.employee_resolve_by_code('01', 'FN211956') -- TODO replace
  limit 1
)
insert into public.notification_queue (
  company_id, recipient_user_id, source, title, body, payload
)
select
  r.company_id,
  '00000000-0000-0000-0000-000000000000'::uuid, -- TODO replace
  'smoke_test',
  'Scheduling smoke',
  'Queue write test',
  '{"ok":true}'::jsonb
from resolved r
returning id, status;
