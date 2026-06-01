create table if not exists public.invite_delivery_audit (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  actor_auth_user_id uuid not null,
  target_employee_id bigint references public.employees(id) on delete set null,
  email text not null,
  flow text not null default 'unknown',
  mode text not null default 'unknown',
  status text not null default 'sent',
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invite_delivery_audit_status_chk'
      and conrelid = 'public.invite_delivery_audit'::regclass
  ) then
    alter table public.invite_delivery_audit
      add constraint invite_delivery_audit_status_chk
      check (status in ('sent', 'failed'));
  end if;
end $$;
create index if not exists idx_invite_delivery_audit_company_created
  on public.invite_delivery_audit(company_id, created_at desc);
create index if not exists idx_invite_delivery_audit_email
  on public.invite_delivery_audit(lower(email));
alter table public.invite_delivery_audit enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policy where polname = 'p_invite_delivery_audit_hr_company'
  ) then
    create policy p_invite_delivery_audit_hr_company on public.invite_delivery_audit
      for select using (company_id = current_hr_company_id());
  end if;
end $$;
