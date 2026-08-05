-- ============================================================
-- Migration 2: company_role_permissions table + seed + has_permission()
--
-- Per-company × per-role × per-permission_key boolean matrix. Owner is
-- not a row in this table; the resolver short-circuits owner = always true.
-- See: docs/roles_and_visibility.md §3
--
-- Reversible: drop the function, drop the table.
-- ============================================================

set search_path = public;
-- 1. Table
create table if not exists public.company_role_permissions (
  company_id      bigint not null references public.companies(id) on delete cascade,
  role            text   not null check (role in ('employee','manager','admin','hr_admin')),
  permission_key  text   not null,
  allowed         boolean not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid null,
  primary key (company_id, role, permission_key)
);
create index if not exists idx_company_role_perms_lookup
  on public.company_role_permissions (company_id, role);
alter table public.company_role_permissions enable row level security;
-- 2. RLS: any authenticated HR/employee in the company can read; only the
--    company owner can write.
drop policy if exists p_company_role_perms_select on public.company_role_permissions;
create policy p_company_role_perms_select on public.company_role_permissions
  for select to authenticated
  using (
    company_id in (select public.auth_active_hr_company_ids())
    or exists (
      select 1 from public.employees e
      where e.profile_id = auth.uid()
        and e.company_id = company_role_permissions.company_id
    )
  );
drop policy if exists p_company_role_perms_owner_write on public.company_role_permissions;
create policy p_company_role_perms_owner_write on public.company_role_permissions
  for all to authenticated
  using (public.is_company_owner(company_id))
  with check (public.is_company_owner(company_id));
-- 3. Seed defaults — see matrix in docs/roles_and_visibility.md §3.1.
--    Idempotent: ON CONFLICT DO NOTHING so re-running doesn't trample
--    customer overrides.
do $$
declare
  v_company_id bigint;
  -- (role, key, allowed) tuples for the defaults
  v_defaults text[][] := array[
    -- Inventory
    ['employee',  'inventory.view',                'true' ],
    ['manager',   'inventory.view',                'true' ],
    ['admin',     'inventory.view',                'true' ],
    ['hr_admin',  'inventory.view',                'true' ],
    ['employee',  'inventory.edit',                'false'],
    ['manager',   'inventory.edit',                'true' ],
    ['admin',     'inventory.edit',                'true' ],
    ['hr_admin',  'inventory.edit',                'true' ],
    -- Clients
    ['employee',  'clients.view',                  'true' ],
    ['manager',   'clients.view',                  'true' ],
    ['admin',     'clients.view',                  'true' ],
    ['hr_admin',  'clients.view',                  'true' ],
    ['employee',  'clients.edit',                  'false'],
    ['manager',   'clients.edit',                  'true' ],
    ['admin',     'clients.edit',                  'true' ],
    ['hr_admin',  'clients.edit',                  'true' ],
    -- Attendance
    ['employee',  'attendance.view_self',          'true' ],
    ['manager',   'attendance.view_self',          'true' ],
    ['admin',     'attendance.view_self',          'true' ],
    ['hr_admin',  'attendance.view_self',          'true' ],
    ['manager',   'attendance.view_team',          'true' ],
    ['admin',     'attendance.view_team',          'true' ],
    ['hr_admin',  'attendance.view_team',          'true' ],
    ['admin',     'attendance.view_all',           'true' ],
    ['hr_admin',  'attendance.view_all',           'true' ],
    -- Scheduling
    ['employee',  'scheduling.view',               'true' ],  -- own only, app-side scope
    ['manager',   'scheduling.view',               'true' ],
    ['admin',     'scheduling.view',               'true' ],
    ['hr_admin',  'scheduling.view',               'true' ],
    ['manager',   'scheduling.edit',               'true' ],
    ['admin',     'scheduling.edit',               'true' ],
    ['hr_admin',  'scheduling.edit',               'true' ],
    -- Payments — sensitive, default-deny non-HR
    ['employee',  'payments.view_payroll',         'true' ],  -- own salary only, scoped by app
    ['manager',   'payments.view_payroll',         'false'],
    ['admin',     'payments.view_payroll',         'false'],
    ['hr_admin',  'payments.view_payroll',         'true' ],
    ['manager',   'payments.view_money_in',        'false'],
    ['admin',     'payments.view_money_in',        'false'],
    ['hr_admin',  'payments.view_money_in',        'true' ],
    ['manager',   'payments.view_money_out',       'false'],
    ['admin',     'payments.view_money_out',       'false'],
    ['hr_admin',  'payments.view_money_out',       'true' ],
    ['hr_admin',  'payments.approve',              'true' ],
    -- Reports — split operational vs financial
    ['manager',   'reports.view_operational',      'true' ],
    ['admin',     'reports.view_operational',      'true' ],
    ['hr_admin',  'reports.view_operational',      'true' ],
    ['manager',   'reports.view_financial',        'false'],
    ['admin',     'reports.view_financial',        'false'],
    ['hr_admin',  'reports.view_financial',        'true' ],
    -- Jobs
    ['employee',  'jobs.view',                     'true' ],
    ['manager',   'jobs.view',                     'true' ],
    ['admin',     'jobs.view',                     'true' ],
    ['hr_admin',  'jobs.view',                     'true' ],
    ['manager',   'jobs.create',                   'true' ],
    ['admin',     'jobs.create',                   'true' ],
    ['hr_admin',  'jobs.create',                   'true' ],
    ['manager',   'jobs.edit',                     'true' ],
    ['admin',     'jobs.edit',                     'true' ],
    ['hr_admin',  'jobs.edit',                     'true' ],
    -- Projects (client_deals)
    ['employee',  'projects.view',                 'true' ],
    ['manager',   'projects.view',                 'true' ],
    ['admin',     'projects.view',                 'true' ],
    ['hr_admin',  'projects.view',                 'true' ],
    ['manager',   'projects.create',               'true' ],
    ['admin',     'projects.create',               'true' ],
    ['hr_admin',  'projects.create',               'true' ],
    ['manager',   'projects.edit',                 'true' ],
    ['admin',     'projects.edit',                 'true' ],
    ['hr_admin',  'projects.edit',                 'true' ],
    -- Incidents
    ['employee',  'incidents.view',                'true' ],
    ['manager',   'incidents.view',                'true' ],
    ['admin',     'incidents.view',                'true' ],
    ['hr_admin',  'incidents.view',                'true' ],
    ['employee',  'incidents.create',              'true' ],
    ['manager',   'incidents.create',              'true' ],
    ['admin',     'incidents.create',              'true' ],
    ['hr_admin',  'incidents.create',              'true' ],
    -- Leave — HR/Owner only by default
    ['hr_admin',  'leave.view_team',               'true' ],
    ['hr_admin',  'leave.view_all',                'true' ],
    ['hr_admin',  'leave.approve',                 'true' ],
    -- Employees module
    ['manager',   'employees.view',                'true' ],
    ['admin',     'employees.view',                'true' ],
    ['hr_admin',  'employees.view',                'true' ],
    ['manager',   'employees.create',              'true' ],
    ['admin',     'employees.create',              'true' ],
    ['hr_admin',  'employees.create',              'true' ],
    ['admin',     'employees.edit',                'true' ],
    ['hr_admin',  'employees.edit',                'true' ],
    -- Contractors module
    ['manager',   'contractors.view',              'true' ],
    ['admin',     'contractors.view',              'true' ],
    ['hr_admin',  'contractors.view',              'true' ],
    ['manager',   'contractors.create',            'true' ],
    ['admin',     'contractors.create',            'true' ],
    ['hr_admin',  'contractors.create',            'true' ],
    ['manager',   'contractors.edit',              'true' ],
    ['admin',     'contractors.edit',              'true' ],
    ['hr_admin',  'contractors.edit',              'true' ],
    -- Settings
    ['admin',     'settings.view',                 'true' ],
    ['hr_admin',  'settings.view',                 'true' ],
    ['hr_admin',  'settings.edit_modules',         'true' ],
    -- Audit
    ['hr_admin',  'audit.view',                    'true' ]
  ];
  i int;
begin
  for v_company_id in select id from public.companies loop
    for i in 1 .. array_length(v_defaults, 1) loop
      insert into public.company_role_permissions
        (company_id, role, permission_key, allowed)
      values (
        v_company_id,
        v_defaults[i][1],
        v_defaults[i][2],
        v_defaults[i][3]::boolean
      )
      on conflict (company_id, role, permission_key) do nothing;
    end loop;
  end loop;
end;
$$;
-- 4. Trigger to seed defaults for any company created in the future.
create or replace function public.seed_company_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_defaults text[][] := array[
    ['employee',  'inventory.view',                'true' ],
    ['manager',   'inventory.view',                'true' ],
    ['admin',     'inventory.view',                'true' ],
    ['hr_admin',  'inventory.view',                'true' ],
    ['employee',  'inventory.edit',                'false'],
    ['manager',   'inventory.edit',                'true' ],
    ['admin',     'inventory.edit',                'true' ],
    ['hr_admin',  'inventory.edit',                'true' ],
    ['employee',  'clients.view',                  'true' ],
    ['manager',   'clients.view',                  'true' ],
    ['admin',     'clients.view',                  'true' ],
    ['hr_admin',  'clients.view',                  'true' ],
    ['employee',  'clients.edit',                  'false'],
    ['manager',   'clients.edit',                  'true' ],
    ['admin',     'clients.edit',                  'true' ],
    ['hr_admin',  'clients.edit',                  'true' ],
    ['employee',  'attendance.view_self',          'true' ],
    ['manager',   'attendance.view_self',          'true' ],
    ['admin',     'attendance.view_self',          'true' ],
    ['hr_admin',  'attendance.view_self',          'true' ],
    ['manager',   'attendance.view_team',          'true' ],
    ['admin',     'attendance.view_team',          'true' ],
    ['hr_admin',  'attendance.view_team',          'true' ],
    ['admin',     'attendance.view_all',           'true' ],
    ['hr_admin',  'attendance.view_all',           'true' ],
    ['employee',  'scheduling.view',               'true' ],
    ['manager',   'scheduling.view',               'true' ],
    ['admin',     'scheduling.view',               'true' ],
    ['hr_admin',  'scheduling.view',               'true' ],
    ['manager',   'scheduling.edit',               'true' ],
    ['admin',     'scheduling.edit',               'true' ],
    ['hr_admin',  'scheduling.edit',               'true' ],
    ['employee',  'payments.view_payroll',         'true' ],
    ['manager',   'payments.view_payroll',         'false'],
    ['admin',     'payments.view_payroll',         'false'],
    ['hr_admin',  'payments.view_payroll',         'true' ],
    ['manager',   'payments.view_money_in',        'false'],
    ['admin',     'payments.view_money_in',        'false'],
    ['hr_admin',  'payments.view_money_in',        'true' ],
    ['manager',   'payments.view_money_out',       'false'],
    ['admin',     'payments.view_money_out',       'false'],
    ['hr_admin',  'payments.view_money_out',       'true' ],
    ['hr_admin',  'payments.approve',              'true' ],
    ['manager',   'reports.view_operational',      'true' ],
    ['admin',     'reports.view_operational',      'true' ],
    ['hr_admin',  'reports.view_operational',      'true' ],
    ['manager',   'reports.view_financial',        'false'],
    ['admin',     'reports.view_financial',        'false'],
    ['hr_admin',  'reports.view_financial',        'true' ],
    ['employee',  'jobs.view',                     'true' ],
    ['manager',   'jobs.view',                     'true' ],
    ['admin',     'jobs.view',                     'true' ],
    ['hr_admin',  'jobs.view',                     'true' ],
    ['manager',   'jobs.create',                   'true' ],
    ['admin',     'jobs.create',                   'true' ],
    ['hr_admin',  'jobs.create',                   'true' ],
    ['manager',   'jobs.edit',                     'true' ],
    ['admin',     'jobs.edit',                     'true' ],
    ['hr_admin',  'jobs.edit',                     'true' ],
    ['employee',  'projects.view',                 'true' ],
    ['manager',   'projects.view',                 'true' ],
    ['admin',     'projects.view',                 'true' ],
    ['hr_admin',  'projects.view',                 'true' ],
    ['manager',   'projects.create',               'true' ],
    ['admin',     'projects.create',               'true' ],
    ['hr_admin',  'projects.create',               'true' ],
    ['manager',   'projects.edit',                 'true' ],
    ['admin',     'projects.edit',                 'true' ],
    ['hr_admin',  'projects.edit',                 'true' ],
    ['employee',  'incidents.view',                'true' ],
    ['manager',   'incidents.view',                'true' ],
    ['admin',     'incidents.view',                'true' ],
    ['hr_admin',  'incidents.view',                'true' ],
    ['employee',  'incidents.create',              'true' ],
    ['manager',   'incidents.create',              'true' ],
    ['admin',     'incidents.create',              'true' ],
    ['hr_admin',  'incidents.create',              'true' ],
    ['hr_admin',  'leave.view_team',               'true' ],
    ['hr_admin',  'leave.view_all',                'true' ],
    ['hr_admin',  'leave.approve',                 'true' ],
    ['manager',   'employees.view',                'true' ],
    ['admin',     'employees.view',                'true' ],
    ['hr_admin',  'employees.view',                'true' ],
    ['manager',   'employees.create',              'true' ],
    ['admin',     'employees.create',              'true' ],
    ['hr_admin',  'employees.create',              'true' ],
    ['admin',     'employees.edit',                'true' ],
    ['hr_admin',  'employees.edit',                'true' ],
    ['manager',   'contractors.view',              'true' ],
    ['admin',     'contractors.view',              'true' ],
    ['hr_admin',  'contractors.view',              'true' ],
    ['manager',   'contractors.create',            'true' ],
    ['admin',     'contractors.create',            'true' ],
    ['hr_admin',  'contractors.create',            'true' ],
    ['manager',   'contractors.edit',              'true' ],
    ['admin',     'contractors.edit',              'true' ],
    ['hr_admin',  'contractors.edit',              'true' ],
    ['admin',     'settings.view',                 'true' ],
    ['hr_admin',  'settings.view',                 'true' ],
    ['hr_admin',  'settings.edit_modules',         'true' ],
    ['hr_admin',  'audit.view',                    'true' ]
  ];
  i int;
begin
  for i in 1 .. array_length(v_defaults, 1) loop
    insert into public.company_role_permissions
      (company_id, role, permission_key, allowed)
    values (
      new.id,
      v_defaults[i][1],
      v_defaults[i][2],
      v_defaults[i][3]::boolean
    )
    on conflict (company_id, role, permission_key) do nothing;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_seed_company_role_permissions on public.companies;
create trigger trg_seed_company_role_permissions
after insert on public.companies
for each row
execute function public.seed_company_role_permissions();
-- 5. has_permission(): the canonical resolver.
--    Owner short-circuits to true. Otherwise reads the matrix for the caller's
--    access_level in that company. Fallback: false (deny by default).
create or replace function public.has_permission(
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

  -- Owner shortcut.
  if exists (
    select 1
    from public.employees e
    where e.profile_id = auth.uid()
      and e.company_id = p_company_id
      and e.access_level = 'owner'
  ) then
    return true;
  end if;

  -- Resolve current role: prefer hr_users.role for portal accounts,
  -- fall back to employees.access_level.
  select coalesce(
    (select h.role
       from public.hr_users h
       where h.auth_user_id = auth.uid()
         and h.company_id = p_company_id
         and coalesce(h.is_active, true) = true
       limit 1),
    (select e.access_level
       from public.employees e
       where e.profile_id = auth.uid()
         and e.company_id = p_company_id
       limit 1)
  ) into v_role;

  if v_role is null then
    return false;
  end if;

  -- Map legacy role aliases to taxonomy values used in company_role_permissions.
  v_role := case v_role
    when 'hr'      then 'hr_admin'
    when 'payroll' then 'hr_admin'
    when 'viewer'  then 'employee'
    else v_role
  end;

  if v_role not in ('employee','manager','admin','hr_admin') then
    return false;
  end if;

  select crp.allowed into v_allowed
  from public.company_role_permissions crp
  where crp.company_id = p_company_id
    and crp.role = v_role
    and crp.permission_key = p_permission_key;

  return coalesce(v_allowed, false);
end;
$$;
revoke all on function public.has_permission(bigint, text) from public;
grant execute on function public.has_permission(bigint, text) to authenticated;
-- 6. Bulk read RPC for the app: return the full permission map for the caller
--    in one round-trip. The Flutter app caches this per (company_id, role) on
--    company switch.
create or replace function public.my_permissions(p_company_id bigint)
returns table (permission_key text, allowed boolean)
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role text;
  v_is_owner boolean;
begin
  if auth.uid() is null then
    return;
  end if;

  v_is_owner := exists (
    select 1
    from public.employees e
    where e.profile_id = auth.uid()
      and e.company_id = p_company_id
      and e.access_level = 'owner'
  );

  if v_is_owner then
    return query
      select distinct crp.permission_key, true
      from public.company_role_permissions crp
      where crp.company_id = p_company_id;
    return;
  end if;

  select coalesce(
    (select h.role from public.hr_users h
       where h.auth_user_id = auth.uid()
         and h.company_id = p_company_id
         and coalesce(h.is_active, true) = true
       limit 1),
    (select e.access_level from public.employees e
       where e.profile_id = auth.uid()
         and e.company_id = p_company_id
       limit 1)
  ) into v_role;

  v_role := case v_role
    when 'hr'      then 'hr_admin'
    when 'payroll' then 'hr_admin'
    when 'viewer'  then 'employee'
    else v_role
  end;

  if v_role not in ('employee','manager','admin','hr_admin') then
    return;
  end if;

  return query
    select crp.permission_key, crp.allowed
    from public.company_role_permissions crp
    where crp.company_id = p_company_id
      and crp.role = v_role;
end;
$$;
revoke all on function public.my_permissions(bigint) from public;
grant execute on function public.my_permissions(bigint) to authenticated;
