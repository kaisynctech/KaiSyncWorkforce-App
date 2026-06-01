-- ════════════════════════════════════════════════════════════════════════════
-- FINANCE PORTAL READ RPCs  (Phase 3 portal wiring)
--
-- Security-definer, anon-safe read endpoints so the code-login portals (which
-- carry no Supabase JWT, and therefore cannot pass the authenticated RLS path)
-- can see their own finance records:
--   • client portal     → their finance_invoices  (resolved by company + client code)
--   • contractor portal  → their contractor_payouts (resolved by company + contractor code)
--
-- Mirrors the existing client_portal_* / contractor_portal_* code-resolution
-- pattern. Draft / cancelled documents are never exposed to the portal.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;

-- ─── Client portal: their invoices ──────────────────────────────────────────
create or replace function public.client_portal_list_invoices(
  p_company_code text,
  p_client_code  text
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.issue_date desc), '[]'::json)
  from (
    select
      i.id,
      i.company_id,
      i.client_id,
      i.invoice_number,
      i.status,
      i.currency,
      i.subtotal,
      i.vat_rate,
      i.vat_amount,
      i.total_amount,
      i.amount_paid,
      i.balance_due,
      i.issue_date,
      i.due_date,
      i.paid_date,
      i.notes
    from public.finance_invoices i
    inner join public.clients cl   on cl.id = i.client_id
    inner join public.companies c  on c.id = i.company_id
    where upper(trim(c.code)) = upper(trim(p_company_code))
      and upper(trim(cl.client_code)) = upper(trim(p_client_code))
      and cl.client_code is not null
      and i.status not in ('draft', 'cancelled')
  ) t;
$$;

-- ─── Contractor portal: their payouts ───────────────────────────────────────
create or replace function public.contractor_portal_list_payouts(
  p_company_code    text,
  p_contractor_code text
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(row_to_json(t) order by t.created_at desc), '[]'::json)
  from (
    select
      p.id,
      p.company_id,
      p.contractor_id,
      p.subtotal,
      p.vat_rate,
      p.vat_amount,
      p.total_amount,
      p.retention_amount,
      p.payout_status,
      p.payout_date,
      p.created_at
    from public.contractor_payouts p
    inner join public.contractors ct on ct.id = p.contractor_id
    inner join public.companies c    on c.id = p.company_id
    where upper(trim(c.code)) = upper(trim(p_company_code))
      and upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      and ct.contractor_code is not null
      and ct.is_active = true
      and p.payout_status <> 'cancelled'
  ) t;
$$;

grant execute on function public.client_portal_list_invoices(text, text) to anon, authenticated;
grant execute on function public.contractor_portal_list_payouts(text, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
--   drop function if exists public.client_portal_list_invoices(text, text);
--   drop function if exists public.contractor_portal_list_payouts(text, text);
-- ════════════════════════════════════════════════════════════════════════════
