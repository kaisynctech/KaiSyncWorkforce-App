set search_path = public;
-- Stamp matrix edits with actor + timestamp server-side.
create or replace function public.touch_company_role_permissions_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists trg_touch_company_role_permissions_audit on public.company_role_permissions;
create trigger trg_touch_company_role_permissions_audit
before insert or update on public.company_role_permissions
for each row
execute function public.touch_company_role_permissions_audit();
-- Keep existing companies aligned with security intent: employees should not
-- have payroll-wide visibility by default.
update public.company_role_permissions
set allowed = false,
    updated_at = now(),
    updated_by = coalesce(updated_by, auth.uid())
where role = 'employee'
  and permission_key = 'payments.view_payroll'
  and allowed = true
  and updated_by is null;
-- Ensure newly-created companies are patched after the legacy seed trigger runs.
create or replace function public.patch_company_role_permissions_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.company_role_permissions
  set allowed = false,
      updated_at = now(),
      updated_by = auth.uid()
  where company_id = new.id
    and role = 'employee'
    and permission_key = 'payments.view_payroll';
  return new;
end;
$$;
drop trigger if exists trg_z_patch_company_role_permissions_defaults on public.companies;
create trigger trg_z_patch_company_role_permissions_defaults
after insert on public.companies
for each row
execute function public.patch_company_role_permissions_defaults();
-- Restrictive write policies: matrix permissions now gate mutations even when
-- broad permissive company policies exist.

drop policy if exists r_jobs_matrix_insert on public.jobs;
create policy r_jobs_matrix_insert on public.jobs
  as restrictive
  for insert to authenticated
  with check (public.has_permission(jobs.company_id, 'jobs.create'));
drop policy if exists r_jobs_matrix_update on public.jobs;
create policy r_jobs_matrix_update on public.jobs
  as restrictive
  for update to authenticated
  using (public.has_permission(jobs.company_id, 'jobs.edit'))
  with check (public.has_permission(jobs.company_id, 'jobs.edit'));
drop policy if exists r_jobs_matrix_delete on public.jobs;
create policy r_jobs_matrix_delete on public.jobs
  as restrictive
  for delete to authenticated
  using (public.has_permission(jobs.company_id, 'jobs.edit'));
drop policy if exists r_client_deals_matrix_insert on public.client_deals;
create policy r_client_deals_matrix_insert on public.client_deals
  as restrictive
  for insert to authenticated
  with check (public.has_permission(client_deals.company_id, 'projects.create'));
drop policy if exists r_client_deals_matrix_update on public.client_deals;
create policy r_client_deals_matrix_update on public.client_deals
  as restrictive
  for update to authenticated
  using (public.has_permission(client_deals.company_id, 'projects.edit'))
  with check (public.has_permission(client_deals.company_id, 'projects.edit'));
drop policy if exists r_client_deals_matrix_delete on public.client_deals;
create policy r_client_deals_matrix_delete on public.client_deals
  as restrictive
  for delete to authenticated
  using (public.has_permission(client_deals.company_id, 'projects.edit'));
drop policy if exists r_employees_matrix_insert on public.employees;
create policy r_employees_matrix_insert on public.employees
  as restrictive
  for insert to authenticated
  with check (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_permission(employees.company_id, 'contractors.create')
      else public.has_permission(employees.company_id, 'employees.create')
    end
  );
drop policy if exists r_employees_matrix_update on public.employees;
create policy r_employees_matrix_update on public.employees
  as restrictive
  for update to authenticated
  using (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_permission(employees.company_id, 'contractors.edit')
      else public.has_permission(employees.company_id, 'employees.edit')
    end
  )
  with check (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_permission(employees.company_id, 'contractors.edit')
      else public.has_permission(employees.company_id, 'employees.edit')
    end
  );
drop policy if exists r_employees_matrix_delete on public.employees;
create policy r_employees_matrix_delete on public.employees
  as restrictive
  for delete to authenticated
  using (
    case
      when coalesce(employees.worker_type, 'employee') in ('contractor', 'subcontractor')
        then public.has_permission(employees.company_id, 'contractors.edit')
      else public.has_permission(employees.company_id, 'employees.edit')
    end
  );
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'contractors'
  ) then
    execute $sql$
      drop policy if exists r_contractors_matrix_insert on public.contractors;
      create policy r_contractors_matrix_insert on public.contractors
        as restrictive
        for insert to authenticated
        with check (public.has_permission(contractors.company_id, 'contractors.create'));

      drop policy if exists r_contractors_matrix_update on public.contractors;
      create policy r_contractors_matrix_update on public.contractors
        as restrictive
        for update to authenticated
        using (public.has_permission(contractors.company_id, 'contractors.edit'))
        with check (public.has_permission(contractors.company_id, 'contractors.edit'));

      drop policy if exists r_contractors_matrix_delete on public.contractors;
      create policy r_contractors_matrix_delete on public.contractors
        as restrictive
        for delete to authenticated
        using (public.has_permission(contractors.company_id, 'contractors.edit'));
    $sql$;
  end if;
end
$$;
drop policy if exists r_leave_requests_matrix_insert on public.leave_requests;
create policy r_leave_requests_matrix_insert on public.leave_requests
  as restrictive
  for insert to authenticated
  with check (
    public.has_permission(leave_requests.company_id, 'leave.approve')
    or exists (
      select 1
      from public.employees e
      where e.id = leave_requests.employee_id
        and e.company_id = leave_requests.company_id
        and e.profile_id = auth.uid()
    )
  );
drop policy if exists r_leave_requests_matrix_update on public.leave_requests;
create policy r_leave_requests_matrix_update on public.leave_requests
  as restrictive
  for update to authenticated
  using (
    public.has_permission(leave_requests.company_id, 'leave.approve')
    or exists (
      select 1
      from public.employees e
      where e.id = leave_requests.employee_id
        and e.company_id = leave_requests.company_id
        and e.profile_id = auth.uid()
    )
  )
  with check (
    public.has_permission(leave_requests.company_id, 'leave.approve')
    or exists (
      select 1
      from public.employees e
      where e.id = leave_requests.employee_id
        and e.company_id = leave_requests.company_id
        and e.profile_id = auth.uid()
    )
  );
drop policy if exists r_leave_requests_matrix_delete on public.leave_requests;
create policy r_leave_requests_matrix_delete on public.leave_requests
  as restrictive
  for delete to authenticated
  using (public.has_permission(leave_requests.company_id, 'leave.approve'));
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'payment_approvals'
  ) then
    execute $sql$
      drop policy if exists r_payment_approvals_matrix_insert on public.payment_approvals;
      create policy r_payment_approvals_matrix_insert on public.payment_approvals
        as restrictive
        for insert to authenticated
        with check (public.has_permission(payment_approvals.company_id, 'payments.approve'));

      drop policy if exists r_payment_approvals_matrix_update on public.payment_approvals;
      create policy r_payment_approvals_matrix_update on public.payment_approvals
        as restrictive
        for update to authenticated
        using (public.has_permission(payment_approvals.company_id, 'payments.approve'))
        with check (public.has_permission(payment_approvals.company_id, 'payments.approve'));

      drop policy if exists r_payment_approvals_matrix_delete on public.payment_approvals;
      create policy r_payment_approvals_matrix_delete on public.payment_approvals
        as restrictive
        for delete to authenticated
        using (public.has_permission(payment_approvals.company_id, 'payments.approve'));
    $sql$;
  end if;
end
$$;
-- Employee scope hardening: employees should never see all-company jobs just
-- because visibility='all'. They only see jobs assigned to them.
create or replace function public.is_visible_to_me(
  p_scope text,
  p_scope_id bigint,
  p_company_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_visibility text;
  v_parent_deal bigint;
  v_assignee bigint;
  v_my_employee_id bigint;
begin
  if v_uid is null then
    return false;
  end if;

  if public.is_company_owner(p_company_id) then
    return true;
  end if;

  select coalesce(
    (select h.role
       from public.hr_users h
      where h.auth_user_id = v_uid
        and h.company_id = p_company_id
        and coalesce(h.is_active, true) = true
      limit 1),
    (select e.access_level
       from public.employees e
      where e.profile_id = v_uid
        and e.company_id = p_company_id
      limit 1)
  ) into v_role;

  v_role := case v_role
    when 'hr' then 'hr_admin'
    when 'payroll' then 'hr_admin'
    when 'viewer' then 'employee'
    else v_role
  end;

  if (p_scope = 'job' and public.has_permission(p_company_id, 'jobs.view'))
     or (p_scope = 'deal' and public.has_permission(p_company_id, 'projects.view')) then
    null;
  else
    return false;
  end if;

  if p_scope = 'job' then
    select j.visibility, j.deal_id, j.assignee_employee_id
      into v_visibility, v_parent_deal, v_assignee
      from public.jobs j
      where j.id = p_scope_id and j.company_id = p_company_id;

    if v_visibility is null then
      return false;
    end if;

    if v_visibility = 'inherit' then
      if v_parent_deal is null then
        v_visibility := 'all';
      else
        select cd.visibility into v_visibility
        from public.client_deals cd
        where cd.id = v_parent_deal and cd.company_id = p_company_id;
        v_visibility := coalesce(v_visibility, 'all');
      end if;
    end if;
  elsif p_scope = 'deal' then
    select cd.visibility into v_visibility
      from public.client_deals cd
      where cd.id = p_scope_id and cd.company_id = p_company_id;
    if v_visibility is null then
      return false;
    end if;
    v_assignee := null;
  else
    return false;
  end if;

  select e.id into v_my_employee_id
  from public.employees e
  where e.profile_id = v_uid
    and e.company_id = p_company_id
  limit 1;

  if v_visibility = 'all' then
    if v_role = 'employee' then
      if p_scope <> 'job' or v_my_employee_id is null then
        return false;
      end if;
      return exists (
        select 1
        from public.jobs j
        where j.id = p_scope_id
          and j.company_id = p_company_id
          and (
            j.assignee_employee_id = v_my_employee_id
            or v_my_employee_id = any(coalesce(j.assigned_employee_ids, '{}'::bigint[]))
          )
      );
    end if;
    return true;
  end if;

  if v_my_employee_id is null then
    return false;
  end if;

  if v_visibility = 'private' then
    return v_assignee is not null and v_assignee = v_my_employee_id;
  end if;

  if v_visibility = 'restricted' then
    if v_assignee is not null and v_assignee = v_my_employee_id then
      return true;
    end if;

    if exists (
      select 1
      from public.visibility_grants g
      where g.scope = p_scope
        and g.scope_id = p_scope_id
        and g.company_id = p_company_id
        and g.target_type = 'employee'
        and g.target_id = v_my_employee_id
    ) then
      return true;
    end if;

    if exists (
      select 1
      from public.visibility_grants g
      join public.work_team_members m
        on m.team_id = g.target_id
       and m.company_id = g.company_id
      where g.scope = p_scope
        and g.scope_id = p_scope_id
        and g.company_id = p_company_id
        and g.target_type = 'team'
        and m.employee_id = v_my_employee_id
    ) then
      return true;
    end if;

    if v_assignee is not null and exists (
      select 1
      from public.employees e
      where e.id = v_assignee
        and e.manager_user_id = v_uid
    ) then
      return true;
    end if;

    return false;
  end if;

  return false;
end;
$$;
revoke all on function public.is_visible_to_me(text, bigint, bigint) from public;
grant execute on function public.is_visible_to_me(text, bigint, bigint) to authenticated;
