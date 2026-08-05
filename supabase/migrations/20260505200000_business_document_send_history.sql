create table if not exists public.business_document_sends (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  document_type text not null check (document_type in ('quote', 'invoice')),
  document_id bigint not null,
  channel text not null default 'email' check (channel in ('email')),
  recipient_email text not null,
  subject text,
  body_preview text,
  sent_at timestamptz not null default now(),
  sent_by_user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_business_document_sends_lookup
  on public.business_document_sends(company_id, document_type, document_id, sent_at desc);
alter table public.business_document_sends enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'business_document_sends'
      and policyname = 'business_document_sends_hr_rw'
  ) then
    create policy business_document_sends_hr_rw
      on public.business_document_sends
      for all
      using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
