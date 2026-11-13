-- Money out (piece 4b): supplier payments in one safe step, receipt photos on expenses, and the one bill that was
-- marked paid without a payment entry gets its entry.

-- 1. Supplier payment in one step. Only approved bills can be paid (decided 13 Nov 2026); permission
--    payments.approve (owner, admin, HR by default). Bill row locked while saving; part payments allowed.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_company_id uuid, p_bill_id uuid, p_amount numeric, p_method text, p_date date, p_reference text, p_notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bill public.supplier_invoices%ROWTYPE;
  v_tx uuid;
  v_emp uuid;
  v_amt numeric := round(coalesce(p_amount, 0), 2);
  v_left numeric;
  v_date date := coalesce(p_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(p_company_id, 'payments.approve') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO v_bill FROM public.supplier_invoices WHERE id = p_bill_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
  IF v_bill.approval_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'NOT_APPROVED'; END IF;
  IF v_bill.status = 'cancelled' THEN RAISE EXCEPTION 'BILL_CANCELLED'; END IF;
  IF v_amt <= 0 OR v_amt > round(coalesce(v_bill.balance_due, 0), 2) + 0.005 THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  v_emp := public._my_employee_id(p_company_id);

  v_left := greatest(0, round(coalesce(v_bill.total_amount, 0) - coalesce(v_bill.amount_paid, 0) - v_amt, 2));
  UPDATE public.supplier_invoices SET
    amount_paid = round(coalesce(amount_paid, 0) + v_amt, 2),
    balance_due = v_left,
    status = CASE WHEN v_left <= 0 THEN 'paid' ELSE 'partially_paid' END,
    paid_at = CASE WHEN v_left <= 0 THEN now() ELSE paid_at END
  WHERE id = p_bill_id;

  INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
    reference_number, amount, total_amount, transaction_date, payment_method, notes, created_by)
  VALUES (p_company_id, 'supplier_payment', 'outgoing', 'supplier_invoices', p_bill_id,
    coalesce(nullif(trim(p_reference), ''), v_bill.invoice_number), v_amt, v_amt, v_date, p_method,
    nullif(trim(p_notes), ''), v_emp)
  RETURNING id INTO v_tx;

  INSERT INTO public.finance_audit_log (company_id, entity_type, entity_id, action, amount, actor_id, note)
  VALUES (p_company_id, 'supplier_invoice', p_bill_id, 'paid', v_amt, v_emp, p_method);

  RETURN v_tx;
END $$;
REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, uuid, numeric, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, uuid, numeric, text, date, text, text) TO authenticated;

-- 2. Receipt photo (and the job it was for) on an expense.
ALTER TABLE public.company_expenses
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

-- Receipts live in workforce-media under expense_receipts/{company_id}/… : only the company's owner, admins and HR
-- can upload or read them (other company files stay as they are).
DROP POLICY IF EXISTS p_workforce_media_expense_receipts_insert ON storage.objects;
CREATE POLICY p_workforce_media_expense_receipts_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'expense_receipts'
    AND public._media_company(name) = ANY (public.user_company_ids())
    AND public.role_is_hr_or_above(public.get_my_role(public._media_company(name))));

CREATE OR REPLACE FUNCTION public.media_staff_can_read(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f text[] := storage.foldername(p_name);
  v_company uuid := public._media_company(p_name);
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF public.media_read_granted(p_name) THEN RETURN true; END IF;
  IF f[1] = 'leave_attachments' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id::text = f[2]
        AND e.company_id = ANY (public.user_company_ids())
        AND (e.user_id = auth.uid()
             OR public.role_is_hr_or_above(public.get_my_role(e.company_id))
             OR public.get_my_role(e.company_id) = 'manager'));
  END IF;
  IF v_company IS NULL THEN
    RETURN EXISTS (SELECT 1 FROM unnest(public.user_company_ids()) c(id)
                   WHERE public.role_is_hr_or_above(public.get_my_role(c.id)));
  END IF;
  IF NOT (v_company = ANY (public.user_company_ids())) THEN RETURN false; END IF;
  IF f[1] = 'employee_documents' THEN
    v_role := public.get_my_role(v_company);
    RETURN public.role_is_hr_or_above(v_role)
        OR EXISTS (SELECT 1 FROM public.employees e
                   WHERE e.id::text = f[3] AND e.company_id = v_company AND e.user_id = auth.uid());
  END IF;
  -- New: expense receipts are for the office only.
  IF f[1] = 'expense_receipts' THEN
    RETURN public.role_is_hr_or_above(public.get_my_role(v_company));
  END IF;
  RETURN true;
END $function$;

-- 3. Bills marked paid with no payment entry (live check on 13 Nov: one, Ironvale test bill BILL0001, R 23):
--    give each its entry, dated when it was marked paid, so money out adds up.
INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
  reference_number, amount, total_amount, transaction_date, payment_method, notes)
SELECT si.company_id, 'supplier_payment', 'outgoing', 'supplier_invoices', si.id,
  coalesce(si.invoice_number, si.bill_number), si.amount_paid, si.amount_paid,
  coalesce((si.paid_at AT TIME ZONE 'Africa/Johannesburg')::date, (si.updated_at AT TIME ZONE 'Africa/Johannesburg')::date, current_date),
  NULL, 'Recorded on 13 Nov 2026: the bill was marked paid without a payment entry'
FROM public.supplier_invoices si
WHERE coalesce(si.amount_paid, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.finance_transactions t
                  WHERE t.source_table = 'supplier_invoices' AND t.source_id = si.id AND t.direction = 'outgoing');
