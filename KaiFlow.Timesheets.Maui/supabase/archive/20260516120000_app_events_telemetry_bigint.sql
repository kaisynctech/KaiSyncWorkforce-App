-- ============================================================
-- app_events: lightweight, append-only telemetry sink so we can see
-- what's happening in production builds (where debugPrint is stripped).
--
-- Volume control: clients write at most a couple of events per minute
-- per session under normal use. A NOTICE-level info event is dropped
-- client-side when the user is offline; errors are always retained.
--
-- Privacy: the screen + action labels are app-defined; meta is a small
-- jsonb blob. Do NOT log PII, full URLs with tokens, or auth headers.
-- ============================================================

set search_path = public;

create table if not exists public.app_events (
  id           bigserial primary key,
  company_id   bigint references public.companies(id) on delete set null,
  auth_user_id uuid null,
  screen       text not null,
  action       text not null,
  level        text not null check (level in ('info','warning','error')),
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

-- INSERT: any authenticated client may write events to their own
-- (auth_user_id, company_id). The column constraints below enforce
-- "must match auth.uid() if set" and "company_id must be one the
-- caller belongs to". Anonymous inserts (no JWT) are denied.
drop policy if exists p_app_events_insert on public.app_events;
create policy p_app_events_insert on public.app_events
  for insert to authenticated
  with check (
    -- auth_user_id must be the caller's or null
    (app_events.auth_user_id is null or app_events.auth_user_id = auth.uid())
    -- if company_id is set, caller must belong to it
    and (
      app_events.company_id is null
      or app_events.company_id in (select public.auth_active_hr_company_ids())
      or exists (
        select 1 from public.employees e
        where e.profile_id = auth.uid()
          and e.company_id = app_events.company_id
      )
    )
  );

-- SELECT: only the company owner can read raw events, and only for
-- their own company. Audit-view permission is implied for owners.
drop policy if exists p_app_events_select_owner on public.app_events;
create policy p_app_events_select_owner on public.app_events
  for select to authenticated
  using (
    app_events.company_id is not null
    and public.is_company_owner(app_events.company_id)
  );

-- No UPDATE or DELETE policy: events are append-only.
-- Retention is handled by a scheduled job, not the app.

-- Convenience: prune events older than 90 days. Call from a cron job.
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
