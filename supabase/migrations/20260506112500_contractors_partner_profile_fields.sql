alter table public.contractors
  add column if not exists partner_profile jsonb not null default '{}'::jsonb;
update public.contractors
set partner_profile = '{}'::jsonb
where partner_profile is null;
