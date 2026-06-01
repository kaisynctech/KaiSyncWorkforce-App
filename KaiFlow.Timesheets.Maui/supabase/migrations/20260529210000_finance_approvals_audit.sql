-- ════════════════════════════════════════════════════════════════════════════
-- FINANCE APPROVALS & AUDIT TRAIL  (Phase 8)
--
-- Extends the payables tables with approval decision metadata and adds a
-- dedicated, append-only finance audit log. Purely additive: no existing
-- column, constraint or flow is changed. UUID-keyed, company-scoped, RLS
-- protected, consistent with the Phase 2 finance foundation.
--
-- Rollback notes are at the bottom of this file.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;

-- ─── Approval decision metadata on payables ─────────────────────────────────
alter table public.supplier_invoices
  add column if not exists approved_by uuid references public.employees(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists paid_at     timestamptz;

alter table public.contractor_payouts
  add column if not exists approved_by uuid references public.employees(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists paid_at     timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- Finance audit log (append-only)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.finance_audit_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  entity_type  text not null,          -- finance_invoice | supplier_invoice | contractor_payout | refund
  entity_id    uuid,
  action       text not null,          -- approved | rejected | paid | refunded | status_changed
  actor_id     uuid references public.employees(id) on delete set null,
  actor_name   text,
  amount       numeric(14,2) not null default 0,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_finance_audit_company_time
  on public.finance_audit_log(company_id, created_at desc);
create index if not exists idx_finance_audit_entity
  on public.finance_audit_log(entity_type, entity_id, created_at desc) where entity_id is not null;

alter table public.finance_audit_log enable row level security;

-- Insert/select for company members; no update/delete (append-only audit trail).
drop policy if exists finance_audit_log_select on public.finance_audit_log;
create policy finance_audit_log_select on public.finance_audit_log for select to authenticated
  using (company_id = any(public.user_company_ids()));

drop policy if exists finance_audit_log_insert on public.finance_audit_log;
create policy finance_audit_log_insert on public.finance_audit_log for insert to authenticated
  with check (company_id = any(public.user_company_ids()));

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
-- ────────────────────────────────────────────────────────────────────────────
--   drop table if exists public.finance_audit_log cascade;
--   alter table public.supplier_invoices
--     drop column if exists approved_by,
--     drop column if exists approved_at,
--     drop column if exists paid_at;
--   alter table public.contractor_payouts
--     drop column if exists approved_by,
--     drop column if exists approved_at,
--     drop column if exists paid_at;
-- ════════════════════════════════════════════════════════════════════════════
