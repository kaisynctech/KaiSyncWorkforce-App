set search_path = public;

create table if not exists public.client_deals (
  id bigint generated always as identity primary key,
  company_id bigint not null,
  client_id bigint not null references public.clients(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'negotiation', 'won', 'lost')),
  offer_amount numeric(12,2) not null default 0,
  expected_close_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_payments (
  id bigint generated always as identity primary key,
  company_id bigint not null,
  client_id bigint not null references public.clients(id) on delete cascade,
  deal_id bigint references public.client_deals(id) on delete set null,
  description text not null,
  amount_due numeric(12,2) not null default 0,
  due_date date,
  paid_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue', 'partial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_notes (
  id bigint generated always as identity primary key,
  company_id bigint not null,
  client_id bigint not null references public.clients(id) on delete cascade,
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.client_files (
  id bigint generated always as identity primary key,
  company_id bigint not null,
  client_id bigint not null references public.clients(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  file_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_client_deals_company_client on public.client_deals(company_id, client_id);
create index if not exists idx_client_payments_company_client on public.client_payments(company_id, client_id);
create index if not exists idx_client_notes_company_client on public.client_notes(company_id, client_id);
create index if not exists idx_client_files_company_client on public.client_files(company_id, client_id);

create or replace function public.client_workspace_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_client_deals_touch_updated_at on public.client_deals;
create trigger trg_client_deals_touch_updated_at
before update on public.client_deals
for each row execute function public.client_workspace_touch_updated_at();

drop trigger if exists trg_client_payments_touch_updated_at on public.client_payments;
create trigger trg_client_payments_touch_updated_at
before update on public.client_payments
for each row execute function public.client_workspace_touch_updated_at();

alter table public.client_deals enable row level security;
alter table public.client_payments enable row level security;
alter table public.client_notes enable row level security;
alter table public.client_files enable row level security;

drop policy if exists p_client_deals_hr_company_all on public.client_deals;
create policy p_client_deals_hr_company_all on public.client_deals
for all to authenticated
using (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_deals.company_id
  )
)
with check (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_deals.company_id
  )
);

drop policy if exists p_client_payments_hr_company_all on public.client_payments;
create policy p_client_payments_hr_company_all on public.client_payments
for all to authenticated
using (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_payments.company_id
  )
)
with check (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_payments.company_id
  )
);

drop policy if exists p_client_notes_hr_company_all on public.client_notes;
create policy p_client_notes_hr_company_all on public.client_notes
for all to authenticated
using (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_notes.company_id
  )
)
with check (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_notes.company_id
  )
);

drop policy if exists p_client_files_hr_company_all on public.client_files;
create policy p_client_files_hr_company_all on public.client_files
for all to authenticated
using (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_files.company_id
  )
)
with check (
  exists (
    select 1
    from public.hr_users h
    where h.auth_user_id = auth.uid()
      and h.is_active = true
      and h.company_id = client_files.company_id
  )
);

grant select, insert, update, delete on public.client_deals to authenticated;
grant select, insert, update, delete on public.client_payments to authenticated;
grant select, insert, update, delete on public.client_notes to authenticated;
grant select, insert, update, delete on public.client_files to authenticated;
