-- Company subscription/settings foundation
-- Adds placeholder subscription fields for plan gating and settings UX.

set search_path = public;

alter table public.companies
  add column if not exists plan_code text not null default 'free_trial',
  add column if not exists plan_price_zar numeric(12,2) not null default 700.00,
  add column if not exists max_users integer not null default 20,
  add column if not exists subscription_active boolean not null default true;

update public.companies
set
  plan_code = coalesce(nullif(btrim(plan_code), ''), 'free_trial'),
  plan_price_zar = coalesce(plan_price_zar, 700.00),
  max_users = case when max_users is null or max_users < 1 then 20 else max_users end,
  subscription_active = coalesce(subscription_active, true);

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'companies'
      and constraint_name = 'companies_max_users_chk'
  ) then
    alter table public.companies drop constraint companies_max_users_chk;
  end if;
end;
$$;

alter table public.companies
  add constraint companies_max_users_chk check (max_users >= 1);
