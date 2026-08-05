-- ============================================================
-- Migration 1: role taxonomy + owner bootstrap
--
-- Widens employees.access_level to {employee, manager, admin, hr_admin, owner}.
-- Promotes the existing self-registered owner per company to access_level='owner'.
-- Updates self_register_company() so future signups land as owner immediately.
-- Adds transfer_company_owner_employee() so ownership can move later.
--
-- Reversible: drop new check constraint, restore the previous one,
-- demote owners back to hr_admin, drop the new RPC.
--
-- See: docs/roles_and_visibility.md §6
-- ============================================================

set search_path = public;
-- 1. Widen employees.access_level constraint.
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
  check (access_level in ('employee', 'manager', 'admin', 'hr_admin', 'owner'));
-- 2. Backfill: promote the bootstrap owner-employee per company.
-- Bootstrap rows are identifiable because hr_users.role='owner' has been written
-- since the self_register migration in 2026-05-05.
update public.employees e
set access_level = 'owner'
from public.hr_users h
where h.auth_user_id = e.profile_id
  and h.company_id = e.company_id
  and coalesce(h.is_active, true) = true
  and h.role = 'owner'
  and e.access_level <> 'owner';
-- 3. Update self_register_company() so the employee row is born as owner.
--    This replaces the previous body which stamped 'hr_admin'.
create or replace function public.self_register_company(
  p_company_name text,
  p_owner_first_name text default '',
  p_owner_last_name text default ''
)
returns table (
  company_id bigint,
  company_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_code text;
  v_company_id bigint;
  v_email text;
  v_fn text;
  v_ln text;
  v_ecode text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'You must be signed in to register a company.';
  end if;

  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'Company name is required.';
  end if;

  if exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = v_uid
      and h.is_active = true
  ) then
    raise exception 'This HR account is already mapped to a company.';
  end if;

  select au.email into v_email
  from auth.users au
  where au.id = v_uid;

  v_fn := coalesce(nullif(btrim(p_owner_first_name), ''), split_part(v_email, '@', 1));
  v_ln := coalesce(nullif(btrim(p_owner_last_name), ''), '');

  loop
    v_code := lpad(nextval('public.company_code_seq')::text, 2, '0');
    begin
      insert into public.companies (name, company_code, plan_code, trial_started_at)
      values (btrim(p_company_name), v_code, 'free_trial', now())
      returning id into v_company_id;
      exit;
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  insert into public.hr_users (
    auth_user_id,
    company_id,
    role,
    is_active,
    display_name
  ) values (
    v_uid,
    v_company_id,
    'owner',
    true,
    nullif(btrim(v_fn || ' ' || v_ln), '')
  );

  v_ecode := v_code || '-OWNER';

  insert into public.employees (
    company_id,
    name,
    surname,
    employee_code,
    employment_date,
    employment_type,
    employment_type_label,
    position,
    monthly_salary,
    hourly_rate,
    weekly_rate,
    daily_rate,
    work_days_weekly,
    daily_hours,
    branch,
    access_level,
    worker_type,
    invite_status,
    profile_id,
    email
  ) values (
    v_company_id,
    v_fn,
    v_ln,
    v_ecode,
    current_date,
    'part-time',
    'Part-time',
    'Company owner',
    0,
    0,
    0,
    0,
    5,
    8,
    '',
    'owner',           -- was 'hr_admin'
    'employee',
    'accepted',
    v_uid,
    lower(trim(v_email))
  );

  return query
  select v_company_id, v_code;
end;
$$;
grant execute on function public.self_register_company(text, text, text)
  to authenticated;
-- 4. Helper: transfer the company-owner employee designation.
-- Promoting one employee to owner demotes whichever employee currently holds
-- that designation in the same company down to 'hr_admin'. Caller must already
-- be the owner; enforced by RLS-friendly check via auth.uid().
create or replace function public.transfer_company_owner_employee(
  p_company_id bigint,
  p_new_owner_employee_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_caller_is_owner boolean;
  v_target_company bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Caller must be the current owner-employee in this company.
  select exists (
    select 1
    from public.employees e
    where e.profile_id = v_uid
      and e.company_id = p_company_id
      and e.access_level = 'owner'
  ) into v_caller_is_owner;

  if not v_caller_is_owner then
    raise exception 'Only the company owner can transfer ownership.';
  end if;

  -- Target must be in the same company.
  select e.company_id into v_target_company
  from public.employees e
  where e.id = p_new_owner_employee_id;

  if v_target_company is null then
    raise exception 'Target employee not found.';
  end if;
  if v_target_company <> p_company_id then
    raise exception 'Target employee belongs to a different company.';
  end if;

  -- Demote current owner(s) — defensive in case of dirty data.
  update public.employees
  set access_level = 'hr_admin'
  where company_id = p_company_id
    and access_level = 'owner'
    and id <> p_new_owner_employee_id;

  -- Promote target.
  update public.employees
  set access_level = 'owner'
  where id = p_new_owner_employee_id;

  -- Mirror to hr_users.role if a portal account exists for the target.
  update public.hr_users h
  set role = 'owner'
  from public.employees e
  where e.id = p_new_owner_employee_id
    and h.auth_user_id = e.profile_id
    and h.company_id = p_company_id;

  update public.hr_users h
  set role = case when h.role = 'owner' then 'admin' else h.role end
  where h.company_id = p_company_id
    and h.auth_user_id <> coalesce(
      (select e.profile_id from public.employees e where e.id = p_new_owner_employee_id),
      '00000000-0000-0000-0000-000000000000'::uuid
    );
end;
$$;
revoke all on function public.transfer_company_owner_employee(bigint, bigint) from public;
grant execute on function public.transfer_company_owner_employee(bigint, bigint)
  to authenticated;
-- 5. Convenience: a stable read function for "is the current user the owner of company X?"
-- Used by RLS in later migrations and by app gates that want a single source of truth.
create or replace function public.is_company_owner(p_company_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.employees e
    where e.profile_id = auth.uid()
      and e.company_id = p_company_id
      and e.access_level = 'owner'
  );
$$;
revoke all on function public.is_company_owner(bigint) from public;
grant execute on function public.is_company_owner(bigint) to authenticated;
