-- app_events: append-only telemetry sink (UUID schema).
-- Replaces the never-applied bigint draft at 20260516120000.

set search_path = public;
create table if not exists public.app_events (
  id           bigserial primary key,
  company_id   uuid references public.companies(id) on delete set null,
  auth_user_id uuid null,
  screen       text not null,
  action       text not null,
  level        text not null check (level in ('info', 'warning', 'error')),
  error_text   text null,
  meta         jsonb null,
  user_agent   text null,
  app_version  text null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_app_events_company_time
  on public.app_events(company_id, created_at desc);
create index if not exists idx_app_events_user_time
  on public.app_events(auth_user_id, created_at desc);
create index if not exists idx_app_events_level_time
  on public.app_events(level, created_at desc) where level <> 'info';
alter table public.app_events enable row level security;
drop policy if exists p_app_events_insert on public.app_events;
create policy p_app_events_insert on public.app_events
  for insert to authenticated
  with check (
    (app_events.auth_user_id is null or app_events.auth_user_id = auth.uid())
    and (
      app_events.company_id is null
      or app_events.company_id = any(public.user_company_ids())
    )
  );
drop policy if exists p_app_events_select_owner on public.app_events;
create policy p_app_events_select_owner on public.app_events
  for select to authenticated
  using (
    app_events.company_id is not null
    and exists (
      select 1
      from public.companies c
      where c.id = app_events.company_id
        and c.owner_user_id = auth.uid()
    )
  );
create or replace function public.prune_old_app_events(p_days int default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with d as (
    delete from public.app_events
    where created_at < now() - (p_days::text || ' days')::interval
    returning id
  )
  select count(*) into v_deleted from d;
  return v_deleted;
end;
$$;
revoke all on function public.prune_old_app_events(int) from public;
grant execute on function public.prune_old_app_events(int) to service_role;
