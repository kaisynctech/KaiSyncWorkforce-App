-- Statements for clients, suppliers and contractors; statement reminders; and real read-only for companies
-- whose KaiSync bill is more than 7 days late.

-- 1. Statements (owner, HR and admins — the people who see the Money overview) ----------------------------

-- Client: the same statement the client sees in their portal (invoices, payments, credit notes, refunds).
CREATE OR REPLACE FUNCTION public.client_statement(p_client_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.clients WHERE id = p_client_id;
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(v_company)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN public._cpc_get_statement(p_client_id);
END $$;

-- Supplier: bills (what you owe) and what you paid against them. Debit = billed, credit = paid.
CREATE OR REPLACE FUNCTION public.supplier_statement(p_supplier_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.contractors WHERE id = p_supplier_id;
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(v_company)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN coalesce((
    SELECT json_agg(row_to_json(e) ORDER BY e.entry_date, e.ord) FROM (
      SELECT created_at::date entry_date, 1 ord, 'invoice' kind, id invoice_id, invoice_number reference,
             'Bill ' || coalesce(invoice_number, '') description, total_amount debit, 0::numeric credit, due_date, status
      FROM public.supplier_invoices
      WHERE supplier_id = p_supplier_id AND company_id = v_company AND coalesce(status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')
      UNION ALL
      SELECT coalesce(paid_at::date, updated_at::date), 2, 'payment', id, invoice_number,
             'Payment made', 0, amount_paid, NULL, NULL
      FROM public.supplier_invoices
      WHERE supplier_id = p_supplier_id AND company_id = v_company AND coalesce(amount_paid, 0) > 0
        AND coalesce(status, '') NOT IN ('cancelled', 'void', 'voided', 'rejected')) e), '[]'::json);
END $$;

-- Contractor: approved payouts (what you owe them) and what was paid. Debit = owed, credit = paid.
CREATE OR REPLACE FUNCTION public.contractor_statement(p_contractor_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.contractors WHERE id = p_contractor_id;
  IF auth.uid() IS NULL OR v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(v_company)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN coalesce((
    SELECT json_agg(row_to_json(e) ORDER BY e.entry_date, e.ord) FROM (
      SELECT coalesce(p.payout_date, p.created_at::date) entry_date, 1 ord, 'invoice' kind, p.id invoice_id,
             j.job_code reference, 'Payout' || coalesce(' — ' || nullif(j.title, ''), '') description,
             p.total_amount - coalesce(p.retention_amount, 0) debit, 0::numeric credit, NULL::date due_date,
             coalesce(p.approval_status, 'pending') status
      FROM public.contractor_payouts p LEFT JOIN public.jobs j ON j.id = p.job_id
      WHERE p.contractor_id = p_contractor_id AND p.company_id = v_company
        AND coalesce(p.approval_status, '') <> 'rejected' AND coalesce(p.payout_status, '') NOT IN ('cancelled', 'rejected')
      UNION ALL
      SELECT coalesce(p.paid_at::date, p.payout_date), 2, 'payment', p.id, j.job_code, 'Paid',
             0, p.total_amount - coalesce(p.retention_amount, 0), NULL, NULL
      FROM public.contractor_payouts p LEFT JOIN public.jobs j ON j.id = p.job_id
      WHERE p.contractor_id = p_contractor_id AND p.company_id = v_company AND p.payout_status = 'paid') e), '[]'::json);
END $$;

REVOKE ALL ON FUNCTION public.client_statement(uuid), public.supplier_statement(uuid), public.contractor_statement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_statement(uuid), public.supplier_statement(uuid), public.contractor_statement(uuid) TO authenticated;

-- 2. Statement reminders sent to clients (written by the send_statement_email function) -----------------
CREATE TABLE IF NOT EXISTS public.statement_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sent_by uuid,
  recipient_email text NOT NULL,
  balance numeric(14,2),
  overdue numeric(14,2),
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS statement_reminders_client_idx ON public.statement_reminders (client_id, created_at DESC);
ALTER TABLE public.statement_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY statement_reminders_read ON public.statement_reminders FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
GRANT SELECT ON public.statement_reminders TO authenticated;

-- 3. Read-only when the KaiSync bill is more than 7 days late ---------------------------------------------
-- Everyone can still see everything; nothing new can be added or changed in the business records below.
-- Clocking in/out, leave, incidents, messages and billing itself keep working. Paying lifts it at once.
CREATE OR REPLACE FUNCTION public.company_writable(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company_id AND c.billing_locked_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.company_writable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_writable(uuid) TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_invoices', 'finance_invoice_lines', 'credit_notes', 'credit_note_lines',
    'commercial_quotes', 'commercial_quote_lines', 'clients', 'client_deals', 'jobs', 'sites',
    'contractors', 'contractor_payouts', 'supplier_invoices', 'supplier_invoice_lines', 'purchase_orders',
    'inventory_items', 'company_expenses', 'payment_approvals'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass AND polname = 'billing_read_only_insert') THEN
      EXECUTE format('CREATE POLICY billing_read_only_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.company_writable(company_id))', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass AND polname = 'billing_read_only_update') THEN
      EXECUTE format('CREATE POLICY billing_read_only_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.company_writable(company_id))', t);
    END IF;
  END LOOP;
END $$;
