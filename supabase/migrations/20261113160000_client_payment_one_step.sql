-- Money in (piece 3b): record a client payment in one safe step.
-- Before: the browser did 4 separate writes (invoice totals, money entry, client account line, history log), so a
-- dropped signal could leave an invoice "paid" with no payment entry, and two people at once could overwrite each
-- other. Now one database step does all of it together, with the invoice locked while it saves.
-- Also: one payment can cover several invoices of the same client; anything paid beyond what's owed is kept as
-- client credit (its own money entry + client account line); a proof of payment is linked to the payment it became.
-- Existing triggers keep working: the client-account 'payment' line still queues the payment for Xero; receipt
-- numbers still come from the finance_transactions trigger.

-- 1. Client credit is its own kind of money entry.
ALTER TABLE public.finance_transactions DROP CONSTRAINT IF EXISTS finance_transactions_transaction_type_check;
ALTER TABLE public.finance_transactions ADD CONSTRAINT finance_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY['invoice', 'supplier_payment', 'contractor_payment', 'payroll', 'expense',
    'refund', 'adjustment', 'client_credit']));

-- 2. Which payment a proof became.
ALTER TABLE public.finance_payment_proofs
  ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES public.finance_transactions(id) ON DELETE SET NULL;

-- 3. The one step. p_allocations: [{ "invoice_id": uuid, "amount": number }]
CREATE OR REPLACE FUNCTION public.record_client_payment(
  p_company_id uuid,
  p_client_id uuid,
  p_allocations jsonb,
  p_total numeric,
  p_method text,
  p_date date,
  p_reference text,
  p_notes text,
  p_proof_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid;
  v_alloc jsonb;
  v_inv public.finance_invoices%ROWTYPE;
  v_amt numeric;
  v_left numeric;
  v_sum numeric := 0;
  v_tx uuid;
  v_first_tx uuid;
  v_credit numeric;
  v_total numeric := round(coalesce(p_total, 0), 2);
  v_date date := coalesce(p_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(p_company_id, 'invoices.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF v_total <= 0 THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;
  v_emp := public._my_employee_id(p_company_id);

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) LOOP
    v_amt := round(coalesce((v_alloc->>'amount')::numeric, 0), 2);
    CONTINUE WHEN v_amt <= 0;

    SELECT * INTO v_inv FROM public.finance_invoices
     WHERE id = (v_alloc->>'invoice_id')::uuid AND company_id = p_company_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
    IF v_inv.client_id IS DISTINCT FROM p_client_id THEN RAISE EXCEPTION 'OTHER_CLIENT'; END IF;
    IF v_inv.status IN ('draft', 'cancelled', 'voided') THEN RAISE EXCEPTION 'INVOICE_NOT_OPEN'; END IF;
    IF v_amt > round(coalesce(v_inv.balance_due, 0), 2) + 0.005 THEN RAISE EXCEPTION 'MORE_THAN_OWED'; END IF;

    v_left := greatest(0, round(coalesce(v_inv.total_amount, 0) - coalesce(v_inv.amount_paid, 0) - v_amt, 2));
    UPDATE public.finance_invoices SET
      amount_paid = round(coalesce(amount_paid, 0) + v_amt, 2),
      balance_due = v_left,
      status = CASE WHEN v_left <= 0 THEN 'paid'
                    WHEN due_date IS NOT NULL AND due_date < v_today THEN 'overdue'
                    ELSE 'partially_paid' END,
      paid_date = CASE WHEN v_left <= 0 THEN v_date ELSE paid_date END
    WHERE id = v_inv.id;

    INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
      reference_number, amount, total_amount, transaction_date, payment_method, notes, created_by)
    VALUES (p_company_id, 'invoice', 'incoming', 'finance_invoices', v_inv.id,
      coalesce(nullif(trim(p_reference), ''), v_inv.invoice_number), v_amt, v_amt, v_date, p_method,
      nullif(trim(p_notes), ''), v_emp)
    RETURNING id INTO v_tx;
    v_first_tx := coalesce(v_first_tx, v_tx);

    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id,
      reference_number, description, debit, credit, entry_date, created_by)
    VALUES (p_company_id, p_client_id, 'payment', 'finance_invoices', v_inv.id, v_inv.invoice_number,
      'Payment received — ' || coalesce(v_inv.invoice_number, v_inv.id::text), 0, v_amt, v_date, auth.uid());

    INSERT INTO public.finance_audit_log (company_id, entity_type, entity_id, action, amount, actor_id, note)
    VALUES (p_company_id, 'finance_invoice', v_inv.id, 'paid', v_amt, v_emp, p_method);

    v_sum := v_sum + v_amt;
  END LOOP;

  v_credit := round(v_total - v_sum, 2);
  IF v_credit < 0 THEN RAISE EXCEPTION 'ALLOCATED_MORE_THAN_RECEIVED'; END IF;
  IF v_credit > 0 THEN
    INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
      reference_number, amount, total_amount, transaction_date, payment_method, notes, created_by)
    VALUES (p_company_id, 'client_credit', 'incoming', 'clients', p_client_id,
      nullif(trim(p_reference), ''), v_credit, v_credit, v_date, p_method,
      coalesce(nullif(trim(p_notes), ''), 'Paid more than owed: kept as credit'), v_emp)
    RETURNING id INTO v_tx;
    v_first_tx := coalesce(v_first_tx, v_tx);

    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id,
      reference_number, description, debit, credit, entry_date, created_by)
    VALUES (p_company_id, p_client_id, 'credit', 'clients', p_client_id, nullif(trim(p_reference), ''),
      'Credit kept for the client', 0, v_credit, v_date, auth.uid());

    INSERT INTO public.finance_audit_log (company_id, entity_type, entity_id, action, amount, actor_id, note)
    VALUES (p_company_id, 'client', p_client_id, 'credit', v_credit, v_emp, p_method);
  END IF;

  IF p_proof_id IS NOT NULL THEN
    UPDATE public.finance_payment_proofs SET status = 'accepted', reviewed_by = v_emp, reviewed_at = now(),
      transaction_id = v_first_tx
    WHERE id = p_proof_id AND company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object('allocated', v_sum, 'credit', greatest(v_credit, 0), 'transaction_id', v_first_tx);
END $$;

REVOKE ALL ON FUNCTION public.record_client_payment(uuid, uuid, jsonb, numeric, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_client_payment(uuid, uuid, jsonb, numeric, text, date, text, text, uuid) TO authenticated;
