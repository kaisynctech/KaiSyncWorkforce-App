set search_path = public;
-- Hotfix: remove self-referencing employees SELECT policy recursion.
-- Existing p_employees_company_peer_select queried public.employees inside an
-- employees policy, which can recurse once additional restrictive policies are present.

create or replace function public.auth_employee_company_ids()
returns setof bigint
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select distinct e.company_id
  from public.employees e
  where e.profile_id = auth.uid();
$$;
revoke all on function public.auth_employee_company_ids() from public;
grant execute on function public.auth_employee_company_ids() to authenticated;
drop policy if exists p_employees_company_peer_select on public.employees;
create policy p_employees_company_peer_select on public.employees
  for select to authenticated
  using (
    employees.company_id in (
      select public.auth_employee_company_ids()
    )
  );
