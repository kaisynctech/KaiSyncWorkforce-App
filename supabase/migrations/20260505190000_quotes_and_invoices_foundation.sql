create table if not exists public.business_quotes (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  quote_type text not null check (quote_type in ('vendor', 'client')),
  source_mode text not null default 'manual' check (source_mode in ('manual', 'upload')),
  title text not null,
  partner_id bigint references public.contractors(id) on delete set null,
  client_id bigint references public.clients(id) on delete set null,
  job_id bigint references public.jobs(id) on delete set null,
  deal_id bigint references public.client_deals(id) on delete set null,
  status text not null default 'draft' check (
    status in (
      'draft', 'received', 'sent', 'approved', 'rejected', 'expired', 'converted'
    )
  ),
  currency text not null default 'ZAR',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  valid_until date,
  notes text,
  source_file_name text,
  source_file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_quotes_company
  on public.business_quotes(company_id, quote_type, status, created_at desc);
create table if not exists public.business_quote_items (
  id bigserial primary key,
  quote_id bigint not null references public.business_quotes(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  line_no int not null default 1,
  description text not null,
  qty numeric(12,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(8,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_business_quote_items_quote
  on public.business_quote_items(quote_id, line_no);
create table if not exists public.business_invoices (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  quote_id bigint references public.business_quotes(id) on delete set null,
  client_id bigint references public.clients(id) on delete set null,
  job_id bigint references public.jobs(id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'sent', 'partial', 'paid', 'overdue', 'void')
  ),
  invoice_number text,
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'ZAR',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  balance_due numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_business_invoices_company
  on public.business_invoices(company_id, status, issue_date desc);
create table if not exists public.business_invoice_payments (
  id bigserial primary key,
  invoice_id bigint not null references public.business_invoices(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete cascade,
  amount numeric(14,2) not null,
  paid_at timestamptz not null default now(),
  payment_method text,
  reference text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_business_invoice_payments_invoice
  on public.business_invoice_payments(invoice_id, paid_at desc);
alter table public.business_quotes enable row level security;
alter table public.business_quote_items enable row level security;
alter table public.business_invoices enable row level security;
alter table public.business_invoice_payments enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='business_quotes' and policyname='business_quotes_hr_rw'
  ) then
    create policy business_quotes_hr_rw on public.business_quotes
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='business_quote_items' and policyname='business_quote_items_hr_rw'
  ) then
    create policy business_quote_items_hr_rw on public.business_quote_items
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='business_invoices' and policyname='business_invoices_hr_rw'
  ) then
    create policy business_invoices_hr_rw on public.business_invoices
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='business_invoice_payments' and policyname='business_invoice_payments_hr_rw'
  ) then
    create policy business_invoice_payments_hr_rw on public.business_invoice_payments
      for all using (company_id = current_hr_company_id())
      with check (company_id = current_hr_company_id());
  end if;
end $$;
