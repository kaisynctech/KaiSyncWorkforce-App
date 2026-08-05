-- ════════════════════════════════════════════════════════════════════════════
-- FINANCE MODULE FOUNDATION  (Phase 2 schema + Phase 3 VAT columns)
--
-- Adds the enterprise finance schema on top of the existing payroll-centric
-- payments module WITHOUT touching payroll, the legacy business_* tables, or
-- any existing flow. Every new table is uuid-keyed, company-scoped and RLS
-- protected. Money is stored as numeric(14,2) and VAT rate as a fraction
-- numeric(6,4) (0.1500 == 15%) for deterministic, auditable accounting.
--
-- Counterparty note: suppliers and contractors both live in public.contractors
-- (distinguished by partner_kind), so supplier_invoices.supplier_id and
-- contractor_payouts.contractor_id both reference public.contractors(id).
--
-- Rollback notes are at the bottom of this file.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;
-- ─── Phase 3: company-level VAT configuration ───────────────────────────────
alter table public.companies
  add column if not exists is_vat_registered boolean not null default true,
  add column if not exists vat_number text,
  add column if not exists default_vat_rate numeric(6,4) not null default 0.1500,
  add column if not exists finance_vat_inclusive_default boolean not null default false;
-- ─── Phase 3: supplier / contractor VAT registration ────────────────────────
alter table public.contractors
  add column if not exists is_vat_registered boolean not null default false,
  add column if not exists vat_number text,
  add column if not exists default_vat_rate numeric(6,4);
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: client invoices
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  client_id         uuid references public.clients(id) on delete set null,
  project_id        uuid references public.client_deals(id) on delete set null,
  quote_id          uuid,                                  -- forward-compat (no FK: no uuid quotes table yet)
  invoice_number    text,
  status            text not null default 'draft'
                      check (status in ('draft','sent','viewed','partially_paid','paid','overdue','cancelled')),
  currency          text not null default 'ZAR',
  subtotal          numeric(14,2) not null default 0,
  vat_rate          numeric(6,4)  not null default 0.1500,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,
  balance_due       numeric(14,2) not null default 0,
  is_vat_inclusive  boolean not null default false,
  tax_type          text not null default 'standard',
  discount_amount   numeric(14,2) not null default 0,
  issue_date        date not null default current_date,
  due_date          date,
  paid_date         date,
  notes             text,
  created_by        uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_finance_invoices_company_status
  on public.finance_invoices(company_id, status, issue_date desc);
create index if not exists idx_finance_invoices_client
  on public.finance_invoices(company_id, client_id, issue_date desc) where client_id is not null;
create index if not exists idx_finance_invoices_project
  on public.finance_invoices(company_id, project_id) where project_id is not null;
create unique index if not exists uq_finance_invoices_number
  on public.finance_invoices(company_id, invoice_number) where invoice_number is not null;
-- ─── invoice line items ─────────────────────────────────────────────────────
create table if not exists public.finance_invoice_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  invoice_id        uuid not null references public.finance_invoices(id) on delete cascade,
  line_no           int  not null default 1,
  description       text not null,
  quantity          numeric(12,3) not null default 1,
  unit_price        numeric(14,2) not null default 0,
  discount_amount   numeric(14,2) not null default 0,
  discount_percent  numeric(6,4)  not null default 0,
  subtotal          numeric(14,2) not null default 0,
  vat_rate          numeric(6,4)  not null default 0.1500,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  is_vat_inclusive  boolean not null default false,
  tax_type          text not null default 'standard',
  created_at        timestamptz not null default now()
);
create index if not exists idx_finance_invoice_lines_invoice
  on public.finance_invoice_lines(invoice_id, line_no);
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: supplier invoices (payables)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.supplier_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  supplier_id       uuid references public.contractors(id) on delete set null,
  job_id            uuid references public.jobs(id) on delete set null,
  project_id        uuid references public.client_deals(id) on delete set null,
  invoice_number    text,
  subtotal          numeric(14,2) not null default 0,
  vat_rate          numeric(6,4)  not null default 0.1500,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  amount_paid       numeric(14,2) not null default 0,
  balance_due       numeric(14,2) not null default 0,
  is_vat_inclusive  boolean not null default false,
  tax_type          text not null default 'standard',
  due_date          date,
  status            text not null default 'received'
                      check (status in ('draft','received','approved','partially_paid','paid','overdue','cancelled')),
  approval_status   text not null default 'pending'
                      check (approval_status in ('pending','approved','rejected')),
  attachment_urls   text[] not null default '{}',
  notes             text,
  created_by        uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_supplier_invoices_company_status
  on public.supplier_invoices(company_id, status, due_date);
create index if not exists idx_supplier_invoices_supplier
  on public.supplier_invoices(company_id, supplier_id) where supplier_id is not null;
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: contractor payouts
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.contractor_payouts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  contractor_id     uuid references public.contractors(id) on delete set null,
  job_id            uuid references public.jobs(id) on delete set null,
  subtotal          numeric(14,2) not null default 0,
  vat_rate          numeric(6,4)  not null default 0.1500,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  retention_amount  numeric(14,2) not null default 0,
  is_vat_inclusive  boolean not null default false,
  tax_type          text not null default 'standard',
  payout_status     text not null default 'pending'
                      check (payout_status in ('pending','approved','paid','cancelled')),
  approval_status   text not null default 'pending'
                      check (approval_status in ('pending','approved','rejected')),
  payout_date       date,
  notes             text,
  created_by        uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_contractor_payouts_company_status
  on public.contractor_payouts(company_id, payout_status, payout_date);
create index if not exists idx_contractor_payouts_contractor
  on public.contractor_payouts(company_id, contractor_id) where contractor_id is not null;
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: universal finance ledger
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_transactions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  transaction_type  text not null
                      check (transaction_type in
                        ('invoice','supplier_payment','contractor_payment','payroll','expense','refund','adjustment')),
  direction         text not null check (direction in ('incoming','outgoing')),
  source_table      text,
  source_id         uuid,
  reference_number  text,
  amount            numeric(14,2) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,
  transaction_date  date not null default current_date,
  payment_method    text,
  notes             text,
  created_by        uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_finance_transactions_company_date
  on public.finance_transactions(company_id, transaction_date desc);
create index if not exists idx_finance_transactions_type
  on public.finance_transactions(company_id, transaction_type, direction, transaction_date desc);
create index if not exists idx_finance_transactions_source
  on public.finance_transactions(source_table, source_id) where source_id is not null;
-- ════════════════════════════════════════════════════════════════════════════
-- Phase 2: VAT periods
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_vat_periods (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  output_vat    numeric(14,2) not null default 0,
  input_vat     numeric(14,2) not null default 0,
  vat_due       numeric(14,2) not null default 0,
  submitted     boolean not null default false,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_finance_vat_periods_company_range
  on public.finance_vat_periods(company_id, start_date, end_date);
-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security  (HR / JWT users via PostgREST; code-login users via RPCs)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.finance_invoices       enable row level security;
alter table public.finance_invoice_lines  enable row level security;
alter table public.supplier_invoices      enable row level security;
alter table public.contractor_payouts     enable row level security;
alter table public.finance_transactions   enable row level security;
alter table public.finance_vat_periods    enable row level security;
drop policy if exists finance_invoices_all on public.finance_invoices;
create policy finance_invoices_all on public.finance_invoices for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
drop policy if exists finance_invoice_lines_all on public.finance_invoice_lines;
create policy finance_invoice_lines_all on public.finance_invoice_lines for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
drop policy if exists supplier_invoices_all on public.supplier_invoices;
create policy supplier_invoices_all on public.supplier_invoices for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
drop policy if exists contractor_payouts_all on public.contractor_payouts;
create policy contractor_payouts_all on public.contractor_payouts for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
drop policy if exists finance_transactions_all on public.finance_transactions;
create policy finance_transactions_all on public.finance_transactions for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
drop policy if exists finance_vat_periods_all on public.finance_vat_periods;
create policy finance_vat_periods_all on public.finance_vat_periods for all to authenticated
  using (company_id = any(public.user_company_ids()))
  with check (company_id = any(public.user_company_ids()));
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
-- ────────────────────────────────────────────────────────────────────────────
-- The following reverses this migration. Drop tables first (children before
-- parents), then the added columns. Run only if the finance module must be
-- fully removed; this destroys finance data.
--
--   drop table if exists public.finance_invoice_lines cascade;
--   drop table if exists public.finance_invoices       cascade;
--   drop table if exists public.supplier_invoices      cascade;
--   drop table if exists public.contractor_payouts     cascade;
--   drop table if exists public.finance_transactions   cascade;
--   drop table if exists public.finance_vat_periods    cascade;
--
--   alter table public.contractors
--     drop column if exists is_vat_registered,
--     drop column if exists vat_number,
--     drop column if exists default_vat_rate;
--
--   alter table public.companies
--     drop column if exists is_vat_registered,
--     drop column if exists vat_number,
--     drop column if exists default_vat_rate,
--     drop column if exists finance_vat_inclusive_default;
-- ════════════════════════════════════════════════════════════════════════════;
