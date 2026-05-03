-- Employee access level foundation
-- Distinguishes employee, manager, and hr_admin in app logic.

set search_path = public;

alter table public.employees
  add column if not exists access_level text not null default 'employee';

update public.employees
set access_level = 'employee'
where access_level is null
   or access_level not in ('employee', 'manager', 'hr_admin');

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'employees'
      and constraint_name = 'employees_access_level_chk'
  ) then
    alter table public.employees drop constraint employees_access_level_chk;
  end if;
end;
$$;

alter table public.employees
  add constraint employees_access_level_chk
  check (access_level in ('employee', 'manager', 'hr_admin'));

create index if not exists idx_employees_company_access_level
  on public.employees(company_id, access_level);
