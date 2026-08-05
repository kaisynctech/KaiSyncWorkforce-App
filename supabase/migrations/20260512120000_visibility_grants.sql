-- ============================================================
-- Migration 3: project/job visibility + grants
--
-- Adds a visibility column to client_deals (the "project" entity in the UI)
-- and to jobs. Jobs default to 'inherit' which resolves to the parent deal's
-- setting. Allowlists for 'restricted' visibility live in visibility_grants.
--
-- See: docs/roles_and_visibility.md §4
-- ============================================================

set search_path = public;
-- 1. Visibility columns on client_deals and jobs.
alter table public.client_deals
  add column if not exists visibility text not null default 'all';
alter table public.client_deals
  drop constraint if exists client_deals_visibility_chk;
alter table public.client_deals
  add constraint client_deals_visibility_chk
  check (visibility in ('all','restricted','private'));
alter table public.jobs
  add column if not exists visibility text not null default 'inherit';
alter table public.jobs
  drop constraint if exists jobs_visibility_chk;
alter table public.jobs
  add constraint jobs_visibility_chk
  check (visibility in ('inherit','all','restricted','private'));
create index if not exists idx_client_deals_visibility
  on public.client_deals(company_id, visibility);
create index if not exists idx_jobs_visibility
  on public.jobs(company_id, visibility);
-- 2. Grants table: allowlist for restricted rows.
create table if not exists public.visibility_grants (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  scope text not null check (scope in ('deal','job')),
  scope_id bigint not null,
  target_type text not null check (target_type in ('employee','team')),
  target_id bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid null,
  unique (scope, scope_id, target_type, target_id)
);
create index if not exists idx_visibility_grants_lookup
  on public.visibility_grants(scope, scope_id);
create index if not exists idx_visibility_grants_target
  on public.visibility_grants(target_type, target_id);
create index if not exists idx_visibility_grants_company
  on public.visibility_grants(company_id);
alter table public.visibility_grants enable row level security;
drop policy if exists p_visibility_grants_company_select on public.visibility_grants;
create policy p_visibility_grants_company_select on public.visibility_grants
  for select to authenticated
  using (
    company_id in (select public.auth_active_hr_company_ids())
    or exists (
      select 1 from public.employees e
      where e.profile_id = auth.uid()
        and e.company_id = visibility_grants.company_id
    )
  );
-- Insert/update/delete: only roles with create/edit on the parent scope.
-- Resolved via has_permission() on jobs.edit / projects.edit.
drop policy if exists p_visibility_grants_company_write on public.visibility_grants;
create policy p_visibility_grants_company_write on public.visibility_grants
  for all to authenticated
  using (
    public.is_company_owner(company_id)
    or (scope = 'job'  and public.has_permission(company_id, 'jobs.edit'))
    or (scope = 'deal' and public.has_permission(company_id, 'projects.edit'))
  )
  with check (
    public.is_company_owner(company_id)
    or (scope = 'job'  and public.has_permission(company_id, 'jobs.edit'))
    or (scope = 'deal' and public.has_permission(company_id, 'projects.edit'))
  );
-- 3. Resolver helpers.
-- is_visible_to_me(scope, scope_id, company_id) returns true if the caller
-- should see that row. Owner short-circuits. Falls back through visibility
-- mode → grants → assignee/manager/team membership.
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
  v_visibility text;
  v_parent_deal bigint;
  v_assignee bigint;
  v_my_employee_id bigint;
begin
  if v_uid is null then
    return false;
  end if;

  -- Owner sees all.
  if public.is_company_owner(p_company_id) then
    return true;
  end if;

  -- HR/Admin with module-level all-view.
  if (p_scope = 'job'  and public.has_permission(p_company_id, 'jobs.view'))
   or (p_scope = 'deal' and public.has_permission(p_company_id, 'projects.view')) then
    -- Continue to per-row visibility resolution below; module permission alone
    -- is necessary but not sufficient when visibility='restricted' or 'private'.
    null;
  else
    return false;
  end if;

  -- Resolve effective visibility.
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

  -- 'all' visibility: any authenticated company member with the module
  -- permission (already gated above) sees it.
  if v_visibility = 'all' then
    return true;
  end if;

  -- Look up the caller's employee.id in this company.
  select e.id into v_my_employee_id
  from public.employees e
  where e.profile_id = v_uid
    and e.company_id = p_company_id
  limit 1;

  if v_my_employee_id is null then
    -- Pure HR-portal user with no employee row: 'restricted' grants can still
    -- name them by hr_users, but for now we keep the model employee-centric.
    return false;
  end if;

  -- 'private': only the assignee sees it (Owner already returned true above).
  if v_visibility = 'private' then
    return v_assignee is not null and v_assignee = v_my_employee_id;
  end if;

  -- 'restricted': caller must have a grant (direct or via team), or be the
  -- assignee, or be the assignee's named manager.
  if v_visibility = 'restricted' then
    if v_assignee is not null and v_assignee = v_my_employee_id then
      return true;
    end if;

    -- Direct grant.
    if exists (
      select 1
      from public.visibility_grants g
      where g.scope = p_scope
        and g.scope_id = p_scope_id
        and g.company_id = p_company_id
        and g.target_type = 'employee'
        and g.target_id   = v_my_employee_id
    ) then
      return true;
    end if;

    -- Team grant.
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

    -- Manager-of-the-assignee fallback (so a manager always sees jobs they
    -- created or whose assignee reports to them).
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
-- 4. Layer the visibility resolver into RLS for jobs and client_deals.
-- We add NEW policies named *_visibility that AND with existing policies.
-- Existing per-company policies still apply; this one further restricts.

-- Jobs SELECT: caller must be in the company AND visible to them.
drop policy if exists p_jobs_visibility_select on public.jobs;
create policy p_jobs_visibility_select on public.jobs
  for select to authenticated
  using (
    public.is_visible_to_me('job', jobs.id, jobs.company_id)
  );
-- client_deals SELECT: caller must be in the company AND visible to them.
drop policy if exists p_client_deals_visibility_select on public.client_deals;
create policy p_client_deals_visibility_select on public.client_deals
  for select to authenticated
  using (
    public.is_visible_to_me('deal', client_deals.id, client_deals.company_id)
  );
-- Note: the existing p_client_deals_hr_company_all and any FOR ALL policy on
-- jobs continue to handle insert/update/delete via the company scope check.
-- The NEW visibility policies above are SELECT-only and must be combined with
-- existing FOR-ALL policies — Postgres takes the OR of all permissive policies
-- for the same command, so we need to drop the SELECT side of the old policies.
--
-- Drop the broad SELECT side of the existing client_deals policy and replace
-- with non-SELECT FOR ALL:
do $$
declare
  v_polname text;
begin
  -- client_deals: split the existing FOR ALL into write-only.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'client_deals'
      and policyname = 'p_client_deals_hr_company_all'
  ) then
    drop policy p_client_deals_hr_company_all on public.client_deals;
  end if;
end;
$$;
-- Re-add INSERT/UPDATE/DELETE policy for client_deals (FOR ALL EXCEPT SELECT).
-- Postgres has no "FOR ALL EXCEPT SELECT", so add three separate policies.
drop policy if exists p_client_deals_hr_company_insert on public.client_deals;
create policy p_client_deals_hr_company_insert on public.client_deals
  for insert to authenticated
  with check (
    exists (
      select 1 from public.hr_users h
      where h.auth_user_id = auth.uid()
        and h.is_active = true
        and h.company_id = client_deals.company_id
    )
  );
drop policy if exists p_client_deals_hr_company_update on public.client_deals;
create policy p_client_deals_hr_company_update on public.client_deals
  for update to authenticated
  using (
    exists (
      select 1 from public.hr_users h
      where h.auth_user_id = auth.uid()
        and h.is_active = true
        and h.company_id = client_deals.company_id
    )
  )
  with check (
    exists (
      select 1 from public.hr_users h
      where h.auth_user_id = auth.uid()
        and h.is_active = true
        and h.company_id = client_deals.company_id
    )
  );
drop policy if exists p_client_deals_hr_company_delete on public.client_deals;
create policy p_client_deals_hr_company_delete on public.client_deals
  for delete to authenticated
  using (
    exists (
      select 1 from public.hr_users h
      where h.auth_user_id = auth.uid()
        and h.is_active = true
        and h.company_id = client_deals.company_id
    )
  );
-- 5. Convenience view: list of grants for a deal/job along with the resolved
-- target name. Useful for the picker UI.
create or replace view public.v_visibility_grants_with_targets as
select
  g.id,
  g.company_id,
  g.scope,
  g.scope_id,
  g.target_type,
  g.target_id,
  g.created_at,
  case
    when g.target_type = 'employee' then trim(coalesce(e.name,'') || ' ' || coalesce(e.surname,''))
    when g.target_type = 'team'     then wt.name
    else null
  end as target_label
from public.visibility_grants g
left join public.employees e
  on g.target_type = 'employee' and e.id = g.target_id
left join public.work_teams wt
  on g.target_type = 'team' and wt.id = g.target_id;
grant select on public.v_visibility_grants_with_targets to authenticated;
