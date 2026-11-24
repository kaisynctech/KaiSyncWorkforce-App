-- Money: one overview of everything coming in and going out, plus a list of the company's own
-- subscriptions and regular costs (software, phones, rent, insurance…).
--
-- company_expenses: what the company pays regularly (or once). Each payment day counts as money out.
-- money_overview(company, from, to): every figure for the Money pages in one call (owner, HR and admins).
--   Income  = invoiced (excl. VAT) minus credit notes, by invoice / credit-note date.
--   Expenses = payroll (gross pay on payslips ending in the period), contractor payouts, supplier bills,
--              subscriptions and other expenses (excl. VAT).
--   Cash    = payments received from clients, and what was actually paid out in the period.

CREATE TABLE IF NOT EXISTS public.company_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT 'Other',
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),       -- per payment, including VAT
  vat_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  start_date date NOT NULL,                                -- first (or only) payment day
  end_date date,                                           -- last payment on or before this day
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('card', 'debit_order', 'eft', 'cash', 'other')),
  supplier_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  notes text,
  archived_at timestamptz,                                 -- removed from the list (kept for history)
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS company_expenses_company_idx ON public.company_expenses (company_id);
ALTER TABLE public.company_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_expenses_read ON public.company_expenses FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
CREATE POLICY company_expenses_insert ON public.company_expenses FOR INSERT TO authenticated
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
CREATE POLICY company_expenses_update ON public.company_expenses FOR UPDATE TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
GRANT SELECT, INSERT, UPDATE ON public.company_expenses TO authenticated;

-- Every payment day of every expense between two dates.
CREATE OR REPLACE FUNCTION public._expense_payments(p_company_id uuid, p_from date, p_to date)
RETURNS TABLE (expense_id uuid, pay_date date, amount numeric, vat_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, d.pay_date, e.amount, e.vat_amount
  FROM public.company_expenses e
  CROSS JOIN LATERAL (
    SELECT (CASE e.frequency
              WHEN 'weekly' THEN e.start_date + (n * 7)
              WHEN 'monthly' THEN (e.start_date + make_interval(months => n))::date
              WHEN 'quarterly' THEN (e.start_date + make_interval(months => n * 3))::date
              WHEN 'yearly' THEN (e.start_date + make_interval(years => n))::date
              ELSE e.start_date END) AS pay_date
    FROM generate_series(0, CASE WHEN e.frequency = 'once' THEN 0 ELSE 600 END) n
  ) d
  WHERE e.company_id = p_company_id AND e.archived_at IS NULL
    AND d.pay_date BETWEEN greatest(p_from, e.start_date) AND least(p_to, coalesce(e.end_date, p_to))
$$;
REVOKE ALL ON FUNCTION public._expense_payments(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.money_overview(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_vat_registered boolean;
  r jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT coalesce(is_vat_registered, false) INTO v_vat_registered FROM public.companies WHERE id = p_company_id;

  -- Income ---------------------------------------------------------------------------------------------
  WITH inv AS (
    SELECT coalesce(sum(subtotal), 0) sub, coalesce(sum(vat_amount), 0) vat, count(*) n
    FROM public.finance_invoices
    WHERE company_id = p_company_id AND status NOT IN ('draft', 'cancelled', 'voided')
      AND issue_date BETWEEN p_from AND p_to),
  cn AS (
    SELECT coalesce(sum(subtotal), 0) sub, coalesce(sum(vat_amount), 0) vat, coalesce(sum(refund_amount), 0) refunded, count(*) n
    FROM public.credit_notes
    WHERE company_id = p_company_id AND coalesce(status, '') NOT IN ('draft', 'void', 'voided', 'cancelled')
      AND issue_date BETWEEN p_from AND p_to)
  SELECT r || jsonb_build_object('income', jsonb_build_object(
      'invoiced', round(inv.sub, 2), 'invoice_count', inv.n, 'invoiced_vat', round(inv.vat, 2),
      'credit_notes', round(cn.sub, 2), 'credit_note_count', cn.n, 'credit_note_vat', round(cn.vat, 2),
      'refunded', round(cn.refunded, 2), 'total', round(inv.sub - cn.sub, 2)))
  INTO r FROM inv, cn;

  -- Payroll (payslips whose period ends in the range; rejected ones left out) --------------------------
  WITH slip AS (
    SELECT p.status, p.paid_at, p.period_end, e.department,
           coalesce(p.gross_pay, 0)::numeric gross, coalesce(p.net_pay, 0)::numeric net, coalesce(p.overtime_pay, 0)::numeric ot,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(trim(x ->> 'label')) = 'PAYE'), (p.payslip_lines ->> 'paye')::numeric, 0) paye,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(trim(x ->> 'label')) = 'UIF'), (p.payslip_lines ->> 'uif')::numeric, 0) uif,
           coalesce((SELECT sum((x ->> 'amount')::numeric) FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(p.deductions_breakdown) = 'array' THEN p.deductions_breakdown ELSE '[]' END) x
             WHERE upper(replace(trim(x ->> 'label'), ' ', '')) IN ('MEIBC', 'MIEBC', 'MIBCO')), 0) meibc,
           p.employee_id
    FROM public.payment_approvals p JOIN public.employees e ON e.id = p.employee_id
    WHERE p.company_id = p_company_id AND p.status <> 'rejected' AND p.period_end BETWEEN p_from AND p_to
      AND (coalesce(p.gross_pay, 0) <> 0 OR coalesce(p.net_pay, 0) <> 0)),
  tot AS (
    SELECT coalesce(sum(gross), 0) gross, coalesce(sum(net), 0) net, coalesce(sum(ot), 0) ot, coalesce(sum(paye), 0) paye,
           coalesce(sum(uif), 0) uif, coalesce(sum(meibc), 0) meibc, count(DISTINCT employee_id) people,
           coalesce(sum(net) FILTER (WHERE status = 'paid'), 0) net_paid, coalesce(sum(net) FILTER (WHERE status <> 'paid'), 0) net_unpaid
    FROM slip),
  dep AS (
    SELECT coalesce(nullif(trim(department), ''), 'No department') name, count(DISTINCT employee_id) people,
           round(sum(gross), 2) gross, round(sum(ot), 2) overtime, round(sum(net), 2) net
    FROM slip GROUP BY 1)
  SELECT r || jsonb_build_object('payroll', jsonb_build_object(
      'gross', round(tot.gross, 2), 'net', round(tot.net, 2), 'overtime', round(tot.ot, 2), 'paye', round(tot.paye, 2),
      'uif', round(tot.uif, 2), 'meibc', round(tot.meibc, 2), 'people', tot.people,
      'net_paid', round(tot.net_paid, 2), 'net_unpaid', round(tot.net_unpaid, 2),
      'departments', coalesce((SELECT jsonb_agg(to_jsonb(dep) ORDER BY dep.gross DESC) FROM dep), '[]'::jsonb)))
  INTO r FROM tot;

  -- Contractors ------------------------------------------------------------------------------------------
  WITH po AS (
    SELECT p.*, coalesce(c.name, 'Unknown contractor') cname
    FROM public.contractor_payouts p LEFT JOIN public.contractors c ON c.id = p.contractor_id
    WHERE p.company_id = p_company_id AND coalesce(p.approval_status, '') <> 'rejected' AND coalesce(p.payout_status, '') NOT IN ('cancelled', 'rejected')),
  per AS (
    SELECT contractor_id, min(cname) name, count(DISTINCT job_id) jobs,
           round(coalesce(sum(total_amount - coalesce(retention_amount, 0)) FILTER (WHERE payout_status = 'paid' AND coalesce(paid_at::date, payout_date) BETWEEN p_from AND p_to), 0), 2) paid,
           round(coalesce(sum(total_amount - coalesce(retention_amount, 0)) FILTER (WHERE approval_status = 'approved' AND payout_status <> 'paid'), 0), 2) approved_unpaid,
           round(coalesce(sum(total_amount) FILTER (WHERE coalesce(approval_status, 'pending') = 'pending'), 0), 2) waiting,
           round(coalesce(sum(retention_amount), 0), 2) retention
    FROM po GROUP BY contractor_id)
  SELECT r || jsonb_build_object('contractors', jsonb_build_object(
      'cost', round(coalesce((SELECT sum(subtotal) FROM po WHERE coalesce(payout_date, created_at::date) BETWEEN p_from AND p_to), 0), 2),
      'cost_vat', round(coalesce((SELECT sum(vat_amount) FROM po WHERE coalesce(payout_date, created_at::date) BETWEEN p_from AND p_to), 0), 2),
      'paid', coalesce((SELECT sum(paid) FROM per), 0),
      'approved_unpaid', coalesce((SELECT sum(approved_unpaid) FROM per), 0),
      'waiting', coalesce((SELECT sum(waiting) FROM per), 0),
      'waiting_count', (SELECT count(*) FROM po WHERE coalesce(approval_status, 'pending') = 'pending'),
      'retention', coalesce((SELECT sum(retention) FROM per), 0),
      'accounts', coalesce((SELECT jsonb_agg(to_jsonb(per) ORDER BY per.approved_unpaid + per.waiting DESC, per.paid DESC) FROM per), '[]'::jsonb)))
  INTO r;

  -- Suppliers (bills from contractors marked as suppliers) --------------------------------------------
  WITH b AS (
    SELECT s.*, coalesce(c.name, 'Unknown supplier') sname
    FROM public.supplier_invoices s LEFT JOIN public.contractors c ON c.id = s.supplier_id
    WHERE s.company_id = p_company_id AND coalesce(s.status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')),
  per AS (
    SELECT supplier_id, min(sname) name,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0), 0), 2) owe,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0 AND (due_date IS NULL OR due_date >= v_today)), 0), 2) not_due,
           round(coalesce(sum(balance_due) FILTER (WHERE balance_due > 0 AND due_date < v_today), 0), 2) overdue,
           count(*) FILTER (WHERE balance_due > 0) open_bills,
           round(coalesce(sum(amount_paid) FILTER (WHERE paid_at::date BETWEEN p_from AND p_to), 0), 2) paid,
           max(paid_at)::date last_paid
    FROM b GROUP BY supplier_id)
  SELECT r || jsonb_build_object('suppliers', jsonb_build_object(
      'cost', round(coalesce((SELECT sum(subtotal) FROM b WHERE created_at::date BETWEEN p_from AND p_to), 0), 2),
      'cost_vat', round(coalesce((SELECT sum(vat_amount) FROM b WHERE created_at::date BETWEEN p_from AND p_to), 0), 2),
      'owe', coalesce((SELECT sum(owe) FROM per), 0),
      'overdue', coalesce((SELECT sum(overdue) FROM per), 0),
      'paid', coalesce((SELECT sum(paid) FROM per), 0),
      'to_approve', (SELECT count(*) FROM b WHERE coalesce(approval_status, 'pending') = 'pending'),
      'due_soon', (SELECT count(*) FROM b WHERE balance_due > 0 AND due_date <= v_today + 7),
      'accounts', coalesce((SELECT jsonb_agg(to_jsonb(per) ORDER BY per.owe DESC, per.paid DESC) FROM per), '[]'::jsonb)))
  INTO r;

  -- Subscriptions and other expenses ---------------------------------------------------------------------
  WITH pay AS (SELECT * FROM public._expense_payments(p_company_id, p_from, p_to)),
  nxt AS (
    SELECT e.id, (SELECT min(x.pay_date) FROM public._expense_payments(p_company_id, v_today, v_today + 400) x WHERE x.expense_id = e.id) next_date
    FROM public.company_expenses e WHERE e.company_id = p_company_id AND e.archived_at IS NULL)
  SELECT r || jsonb_build_object('expenses', jsonb_build_object(
      'paid', round(coalesce((SELECT sum(amount) FROM pay), 0), 2),
      'cost', round(coalesce((SELECT sum(amount - vat_amount) FROM pay), 0), 2),
      'vat', round(coalesce((SELECT sum(vat_amount) FROM pay), 0), 2),
      'regular_cost', round(coalesce((SELECT sum(p.amount - p.vat_amount) FROM pay p JOIN public.company_expenses e ON e.id = p.expense_id WHERE e.frequency <> 'once'), 0), 2),
      'once_off_cost', round(coalesce((SELECT sum(p.amount - p.vat_amount) FROM pay p JOIN public.company_expenses e ON e.id = p.expense_id WHERE e.frequency = 'once'), 0), 2),
      'monthly_equivalent', round(coalesce((SELECT sum(CASE frequency WHEN 'weekly' THEN amount * 52 / 12.0 WHEN 'monthly' THEN amount
              WHEN 'quarterly' THEN amount / 3.0 WHEN 'yearly' THEN amount / 12.0 ELSE 0 END)
            FROM public.company_expenses WHERE company_id = p_company_id AND archived_at IS NULL AND (end_date IS NULL OR end_date >= v_today)), 0), 2),
      'due_soon', (SELECT count(*) FROM nxt WHERE next_date <= v_today + 14),
      'items', coalesce((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'category', e.category, 'amount', e.amount,
              'vat_amount', e.vat_amount, 'frequency', e.frequency, 'start_date', e.start_date, 'end_date', e.end_date,
              'payment_method', e.payment_method, 'notes', e.notes, 'next_date', nxt.next_date,
              'in_period', (SELECT coalesce(sum(amount), 0) FROM pay WHERE pay.expense_id = e.id))
            ORDER BY (nxt.next_date IS NULL), nxt.next_date, e.name)
            FROM public.company_expenses e JOIN nxt ON nxt.id = e.id), '[]'::jsonb)))
  INTO r;

  -- Clients: what they owe, how late, and payments -----------------------------------------------------
  WITH open AS (
    SELECT i.client_id, i.balance_due bal, (v_today - coalesce(i.due_date, i.issue_date)) late
    FROM public.finance_invoices i
    WHERE i.company_id = p_company_id AND i.status NOT IN ('draft', 'cancelled', 'voided', 'paid') AND i.balance_due > 0),
  pays AS (
    SELECT i.client_id, t.transaction_date, t.total_amount
    FROM public.finance_transactions t JOIN public.finance_invoices i ON i.id = t.source_id
    WHERE t.company_id = p_company_id AND t.source_table = 'finance_invoices' AND t.direction IN ('incoming', 'in')),
  per AS (
    SELECT o.client_id, round(sum(bal), 2) owed,
           round(coalesce(sum(bal) FILTER (WHERE late <= 0), 0), 2) not_due,
           round(coalesce(sum(bal) FILTER (WHERE late BETWEEN 1 AND 30), 0), 2) d30,
           round(coalesce(sum(bal) FILTER (WHERE late BETWEEN 31 AND 60), 0), 2) d60,
           round(coalesce(sum(bal) FILTER (WHERE late > 60), 0), 2) d90,
           count(*) invoices, max(late) oldest
    FROM open o GROUP BY o.client_id),
  days AS (
    SELECT avg(pd - i.issue_date) d FROM public.finance_invoices i
    JOIN LATERAL (SELECT max(t.transaction_date) pd FROM public.finance_transactions t WHERE t.source_id = i.id AND t.company_id = p_company_id) x ON true
    WHERE i.company_id = p_company_id AND i.status = 'paid' AND x.pd IS NOT NULL AND i.issue_date >= v_today - 365)
  SELECT r || jsonb_build_object('clients', jsonb_build_object(
      'owed', coalesce((SELECT sum(owed) FROM per), 0),
      'not_due', coalesce((SELECT sum(not_due) FROM per), 0),
      'd30', coalesce((SELECT sum(d30) FROM per), 0),
      'd60', coalesce((SELECT sum(d60) FROM per), 0),
      'd90', coalesce((SELECT sum(d90) FROM per), 0),
      'open_invoices', coalesce((SELECT sum(invoices) FROM per), 0),
      'late_60', (SELECT count(*) FROM open WHERE late > 60),
      'avg_days_to_pay', (SELECT round(d) FROM days),
      'received', round(coalesce((SELECT sum(total_amount) FROM pays WHERE transaction_date BETWEEN p_from AND p_to), 0), 2),
      'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object('client_id', per.client_id, 'name', coalesce(c.name, 'No client'),
              'owed', per.owed, 'not_due', per.not_due, 'd30', per.d30, 'd60', per.d60, 'd90', per.d90, 'invoices', per.invoices,
              'oldest_days', per.oldest, 'last_paid', (SELECT max(transaction_date) FROM pays WHERE pays.client_id = per.client_id))
            ORDER BY per.owed DESC)
            FROM per LEFT JOIN public.clients c ON c.id = per.client_id), '[]'::jsonb)))
  INTO r;

  -- Quotes to invoices -------------------------------------------------------------------------------------
  WITH q AS (
    SELECT * FROM public.commercial_quotes
    WHERE company_id = p_company_id AND status <> 'draft' AND coalesce(sent_at, created_at)::date BETWEEN p_from AND p_to),
  qi AS (
    SELECT DISTINCT ON (i.quote_id) i.quote_id, i.subtotal, i.status
    FROM public.finance_invoices i JOIN q ON q.id = i.quote_id
    WHERE i.status NOT IN ('draft', 'cancelled', 'voided') ORDER BY i.quote_id, i.created_at)
  SELECT r || jsonb_build_object('quotes', jsonb_build_object(
      'quoted', round(coalesce((SELECT sum(subtotal) FROM q), 0), 2), 'quoted_count', (SELECT count(*) FROM q),
      'accepted', round(coalesce((SELECT sum(subtotal) FROM q WHERE status = 'accepted'), 0), 2),
      'accepted_count', (SELECT count(*) FROM q WHERE status = 'accepted'),
      'invoiced', round(coalesce((SELECT sum(subtotal) FROM qi), 0), 2), 'invoiced_count', (SELECT count(*) FROM qi),
      'paid', round(coalesce((SELECT sum(subtotal) FROM qi WHERE status = 'paid'), 0), 2), 'paid_count', (SELECT count(*) FROM qi WHERE status = 'paid')))
  INTO r;

  -- Cash out in the period, VAT and the last 6 months ---------------------------------------------------
  r := r || jsonb_build_object(
    'cash_out', jsonb_build_object(
      'payroll', round(coalesce((SELECT sum(net_pay)::numeric FROM public.payment_approvals WHERE company_id = p_company_id AND status = 'paid'
                         AND coalesce(paid_at::date, period_end) BETWEEN p_from AND p_to), 0), 2),
      'contractors', (r -> 'contractors' ->> 'paid')::numeric,
      'suppliers', (r -> 'suppliers' ->> 'paid')::numeric,
      'expenses', (r -> 'expenses' ->> 'paid')::numeric,
      'refunds', (r -> 'income' ->> 'refunded')::numeric),
    'vat_registered', v_vat_registered,
    'vat', jsonb_build_object(
      'output', round((r -> 'income' ->> 'invoiced_vat')::numeric - (r -> 'income' ->> 'credit_note_vat')::numeric, 2),
      'input', round((r -> 'suppliers' ->> 'cost_vat')::numeric + (r -> 'contractors' ->> 'cost_vat')::numeric + (r -> 'expenses' ->> 'vat')::numeric, 2)),
    'series', coalesce((
      SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
        'in', round(coalesce((SELECT sum(t.total_amount) FROM public.finance_transactions t WHERE t.company_id = p_company_id
                 AND t.direction IN ('incoming', 'in') AND date_trunc('month', t.transaction_date) = m), 0), 2),
        'out', round(
           coalesce((SELECT sum(net_pay)::numeric FROM public.payment_approvals WHERE company_id = p_company_id AND status = 'paid'
                     AND date_trunc('month', coalesce(paid_at::date, period_end)) = m), 0)
         + coalesce((SELECT sum(total_amount - coalesce(retention_amount, 0)) FROM public.contractor_payouts WHERE company_id = p_company_id
                     AND payout_status = 'paid' AND date_trunc('month', coalesce(paid_at::date, payout_date)) = m), 0)
         + coalesce((SELECT sum(amount_paid) FROM public.supplier_invoices WHERE company_id = p_company_id
                     AND date_trunc('month', paid_at) = m), 0)
         + coalesce((SELECT sum(amount) FROM public._expense_payments(p_company_id, m::date, (m + interval '1 month - 1 day')::date)), 0), 2)) ORDER BY m)
      FROM generate_series(date_trunc('month', p_to::timestamp) - interval '5 months', date_trunc('month', p_to::timestamp), interval '1 month') m), '[]'::jsonb));

  r := r || jsonb_build_object('cash_out_total', round(
    (r -> 'cash_out' ->> 'payroll')::numeric + (r -> 'cash_out' ->> 'contractors')::numeric + (r -> 'cash_out' ->> 'suppliers')::numeric
    + (r -> 'cash_out' ->> 'expenses')::numeric + (r -> 'cash_out' ->> 'refunds')::numeric, 2),
    'from', p_from, 'to', p_to);
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.money_overview(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.money_overview(uuid, date, date) TO authenticated;
