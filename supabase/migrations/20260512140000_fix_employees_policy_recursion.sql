set search_path = public;
-- Hotfix: avoid recursive RLS loop on employees.
-- r_employees_matrix_* called has_permission(), which reads employees; that
-- re-entered employees RLS and triggered "infinite recursion detected".

create or replace function public.has_hr_role_permission(
  p_company_id bigint,
  p_permission_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role text;
  v_allowed boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select h.role
    into v_role
  from public.hr_users h
  where h.auth_user_id = auth.uid()
    and h.company_id = p_company_id
    and coalesce(h.is_active, true) = true
  limit 1;

  if v_role is null then
    return false;
  end if;

  if v_role = 'owner' then
    return true;
  end if;

  v_role := case v_role
    when 'hr' then 'hr_admin'
    when 'payroll' then 'hr_admin'
    when 'viewer' then 'employee'
    else v_role
  end;

  select crp.allowed
    into v_allowed
  from public.company_role_permissions crp
  where crp.company_id = p_company_id
    and crp.role = v_role
    and crp.permission_key = p_permission_key
  limit 1;

  return coalesce(v_allowed, false);
end;
$$;
revoke all on function public.has_hr_role_permission(bigint, text) from public;
grant execute on function public.has_hr_role_permission(bigint, text) to authenticated;
drop policy if exists r_employees_matrix_insert on public.employees;
create policy r_employees_matrix_insert on public.employees
  as restrictive
  for insert to authenticated
  with check (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_hr_role_permission(employees.company_id, 'contractors.create')
      else public.has_hr_role_permission(employees.company_id, 'employees.create')
    end
  );
drop policy if exists r_employees_matrix_update on public.employees;
create policy r_employees_matrix_update on public.employees
  as restrictive
  for update to authenticated
  using (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_hr_role_permission(employees.company_id, 'contractors.edit')
      else public.has_hr_role_permission(employees.company_id, 'employees.edit')
    end
  )
  with check (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_hr_role_permission(employees.company_id, 'contractors.edit')
      else public.has_hr_role_permission(employees.company_id, 'employees.edit')
    end
  );
drop policy if exists r_employees_matrix_delete on public.employees;
create policy r_employees_matrix_delete on public.employees
  as restrictive
  for delete to authenticated
  using (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_hr_role_permission(employees.company_id, 'contractors.edit')
      else public.has_hr_role_permission(employees.company_id, 'employees.edit')
    end
  );
