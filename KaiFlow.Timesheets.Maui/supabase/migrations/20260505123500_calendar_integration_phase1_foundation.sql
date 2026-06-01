-- Phase 1 foundation for KaiFlow Calendar/My PA external sync.
-- Adds:
-- 1) company_integration_connections - OAuth/account linkage per provider.
-- 2) calendar_event_links - mapping between KaiFlow source events and provider event IDs.

create table if not exists public.company_integration_connections (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'microsoft_calendar', 'teams', 'zoom', 'xero', 'quickbooks')),
  connection_status text not null default 'disconnected' check (connection_status in ('disconnected', 'connected', 'error')),
  external_account_id text,
  external_account_email text,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);
create index if not exists idx_company_integration_connections_company
  on public.company_integration_connections(company_id, provider);
create table if not exists public.calendar_event_links (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  source_type text not null check (source_type in ('pa_task', 'job', 'meeting', 'shift')),
  source_id bigint not null,
  provider text not null check (provider in ('google_calendar', 'microsoft_calendar', 'teams', 'zoom')),
  external_event_id text not null,
  sync_status text not null default 'pending' check (sync_status in ('pending', 'synced', 'error')),
  external_calendar_id text,
  last_synced_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_type, source_id, provider),
  unique (provider, external_event_id)
);
create index if not exists idx_calendar_event_links_company
  on public.calendar_event_links(company_id, source_type, source_id);
alter table public.company_integration_connections enable row level security;
alter table public.calendar_event_links enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_integration_connections'
      and policyname = 'company_integration_connections_hr_rw'
  ) then
    create policy company_integration_connections_hr_rw
      on public.company_integration_connections
      for all
      using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calendar_event_links'
      and policyname = 'calendar_event_links_hr_rw'
  ) then
    create policy calendar_event_links_hr_rw
      on public.calendar_event_links
      for all
      using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_company_integration_connections_updated_at on public.company_integration_connections;
create trigger trg_company_integration_connections_updated_at
before update on public.company_integration_connections
for each row execute procedure public.set_updated_at_timestamp();
drop trigger if exists trg_calendar_event_links_updated_at on public.calendar_event_links;
create trigger trg_calendar_event_links_updated_at
before update on public.calendar_event_links
for each row execute procedure public.set_updated_at_timestamp();
