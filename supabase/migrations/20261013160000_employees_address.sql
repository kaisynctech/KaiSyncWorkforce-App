-- Home or postal address printed at the top of the payslip.
-- Employees are column-privileged: a new column is invisible until SELECT is granted.

alter table public.employees
  add column if not exists address text;

comment on column public.employees.address is
  'Home or postal address shown at the top of the payslip.';

grant select (address) on table public.employees to anon, authenticated;
grant update (address) on table public.employees to authenticated;
