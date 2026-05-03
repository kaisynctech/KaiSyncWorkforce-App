-- App update remote config (Option A).
-- Run this in Supabase SQL editor for each environment.

create table if not exists public.app_release_config (
  config_key text primary key default 'global',
  is_enabled boolean not null default true,
  latest_version text not null default '0.1.0',
  minimum_supported_version text,
  force_update boolean not null default false,
  update_url_android text,
  update_url_ios text,
  update_url_web text,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at_app_release_config()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_release_config_updated_at on public.app_release_config;
create trigger trg_app_release_config_updated_at
before update on public.app_release_config
for each row execute function public.set_updated_at_app_release_config();

alter table public.app_release_config enable row level security;

drop policy if exists p_app_release_config_select_all on public.app_release_config;
create policy p_app_release_config_select_all
on public.app_release_config
for select
to anon, authenticated
using (true);

drop policy if exists p_app_release_config_write_hr_admin on public.app_release_config;
create policy p_app_release_config_write_hr_admin
on public.app_release_config
for all
to authenticated
using (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and lower(h.role) in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and lower(h.role) in ('owner', 'admin')
  )
);

insert into public.app_release_config (
  config_key,
  is_enabled,
  latest_version,
  minimum_supported_version,
  force_update,
  update_url_android,
  update_url_ios,
  update_url_web
)
values (
  'global',
  true,
  '0.1.0',
  null,
  false,
  'https://play.google.com/store',
  'https://apps.apple.com/',
  'https://your-app-domain.example.com'
)
on conflict (config_key) do nothing;

