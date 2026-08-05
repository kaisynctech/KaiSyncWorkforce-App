create table if not exists public.integration_oauth_states (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  hr_user_id uuid not null,
  provider text not null check (provider in ('google_calendar', 'microsoft_calendar')),
  state_token text not null unique,
  code_verifier text,
  redirect_to text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_integration_oauth_states_lookup
  on public.integration_oauth_states(state_token, provider);
alter table public.integration_oauth_states enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'integration_oauth_states'
      and policyname = 'integration_oauth_states_hr_rw'
  ) then
    create policy integration_oauth_states_hr_rw
      on public.integration_oauth_states
      for all
      using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
