-- Keep Xero's numbers the same as KaiSync's for supplier bills, in the two cases Xero can't simply "update":
--  * A cancelled purchase order that was (part) paid: Xero gets a supplier credit note for the bill (clears what was
--    still owed; the paid part waits as "to be refunded"), and the supplier's refund is recorded on that credit note.
--  * A price change after the bill already has payments in Xero: Xero gets an extra bill (price went up) or a
--    supplier credit note (price went down) for the difference. xero_synced_total remembers what Xero shows.

ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS xero_synced_total numeric;

ALTER TABLE public.xero_sync_queue DROP CONSTRAINT xero_sync_queue_entity_check;
ALTER TABLE public.xero_sync_queue ADD CONSTRAINT xero_sync_queue_entity_check CHECK (entity = ANY (ARRAY[
  'client', 'supplier', 'invoice', 'invoice_void', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment',
  'invoice_pdf', 'supplier_refund']));
ALTER TABLE public.xero_doc_links DROP CONSTRAINT xero_doc_links_entity_check;
ALTER TABLE public.xero_doc_links ADD CONSTRAINT xero_doc_links_entity_check CHECK (entity = ANY (ARRAY[
  'invoice', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment', 'xero_payment', 'xero_supplier_payment',
  'tracking_project', 'tracking_job', 'item_inventory', 'item_catalogue', 'invoice_pdf',
  'supplier_credit', 'supplier_bill_adj', 'supplier_refund']));

-- Cancelled PO: its bill is cancelled whether or not something was paid (nothing more is owed); what was paid
-- stays on it as "to be refunded". Xero: voided when nothing was paid, otherwise credited.
CREATE OR REPLACE FUNCTION public._trg_po_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill uuid;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.supplier_invoices SET status = 'cancelled', balance_due = 0, updated_at = now()
     WHERE po_id = NEW.id AND grn_id IS NULL AND status <> 'cancelled';
    RETURN NEW;
  END IF;
  IF NEW.status IN ('sent', 'partially_received', 'received') AND public._po_bill_of(NEW.id) IS NULL THEN
    v_bill := public._po_sync_bill(NEW.id, true);
  END IF;
  RETURN NEW;
END $$;

-- The refund is on the cancelled PO's bill.
CREATE OR REPLACE FUNCTION public.po_record_refund(p_po_id uuid, p_amount numeric, p_date date, p_reference text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE po public.purchase_orders%ROWTYPE; b public.supplier_invoices%ROWTYPE; v_amt numeric := round(coalesce(p_amount, 0), 2);
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'payments.approve') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO b FROM public.supplier_invoices
   WHERE po_id = po.id AND grn_id IS NULL AND coalesce(amount_paid, 0) - coalesce(amount_refunded, 0) > 0.004
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTHING_TO_REFUND'; END IF;
  IF v_amt <= 0 OR v_amt > round(coalesce(b.amount_paid, 0) - coalesce(b.amount_refunded, 0), 2) + 0.005 THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  UPDATE public.supplier_invoices SET amount_refunded = round(coalesce(amount_refunded, 0) + v_amt, 2), updated_at = now() WHERE id = b.id;
  INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
    reference_number, amount, total_amount, transaction_date, payment_method, notes, created_by)
  VALUES (po.company_id, 'refund', 'incoming', 'supplier_invoices', b.id, nullif(trim(coalesce(p_reference, '')), ''),
    v_amt, v_amt, coalesce(p_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date), 'refund',
    'Refund from supplier for cancelled ' || coalesce(po.po_number, 'PO'), public._my_employee_id(po.company_id));
END $function$;

-- Xero: every cancelled bill goes across (void or credit), and supplier refunds go too.
CREATE OR REPLACE FUNCTION public._trg_xero_supplier_invoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_label text := 'Supplier invoice ' || coalesce(NEW.invoice_number, NEW.bill_number, '');
BEGIN
  IF NEW.approval_status = 'approved' AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved'
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount) AND NEW.status <> 'cancelled' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_bill', NEW.id, v_label, coalesce(NEW.approved_at::date, NEW.created_at::date));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND (coalesce(NEW.amount_paid, 0) > 0
          OR EXISTS (SELECT 1 FROM public.xero_doc_links WHERE company_id = NEW.company_id AND entity = 'supplier_bill' AND record_id = NEW.id)) THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_bill', NEW.id, v_label || ' (cancelled)', NULL);
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._trg_xero_supplier_payment_tx() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source_table = 'supplier_invoices' AND NEW.transaction_type = 'supplier_payment' AND NEW.direction = 'outgoing' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_payment', NEW.id,
      'Supplier payment ' || coalesce(NEW.reference_number, ''), NEW.transaction_date);
  ELSIF NEW.source_table = 'supplier_invoices' AND NEW.transaction_type = 'refund' AND NEW.direction = 'incoming' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_refund', NEW.id,
      'Supplier refund ' || coalesce(NEW.reference_number, ''), NEW.transaction_date);
  END IF;
  RETURN NEW;
END $$;
