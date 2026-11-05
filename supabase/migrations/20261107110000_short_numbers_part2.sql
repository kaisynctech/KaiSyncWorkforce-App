-- Short numbers, part 2: jobs J0001 (no company prefix), contractor quotes CQ0001, our own supplier-bill
-- number BILL0001, payment receipts REC0001 and remittance advice REM0001. Same counters as INV/QU/CN/PO.
-- Existing numbers stay as they are; counters carry on after the highest number already used.

ALTER TABLE public.document_counters DROP CONSTRAINT document_counters_kind_check;
ALTER TABLE public.document_counters ADD CONSTRAINT document_counters_kind_check
  CHECK (kind = ANY (ARRAY['invoice', 'quote', 'job', 'credit_note', 'purchase_order', 'rfq', 'grn',
                           'contractor_quote', 'bill', 'receipt', 'remittance']));

ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS bill_number text;
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS remittance_number text;
ALTER TABLE public.contractor_payouts ADD COLUMN IF NOT EXISTS remittance_number text;
ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS receipt_number text;

CREATE OR REPLACE FUNCTION public._doc_max_used(p_company_id uuid, p_kind text, p_period text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint; w bigint;
BEGIN
  IF p_kind = 'invoice' THEN
    SELECT max(coalesce(substring(invoice_number FROM '^INV-\d{4}-(\d+)$'), substring(invoice_number FROM '^INV(\d+)$'))::bigint) INTO v
      FROM public.finance_invoices WHERE company_id = p_company_id AND invoice_number ~ '^INV(-\d{4}-)?\d+$';
  ELSIF p_kind = 'quote' THEN
    SELECT max(coalesce(substring(quote_number FROM '^QT-\d{4}-(\d+)$'), substring(quote_number FROM '^QU(\d+)$'))::bigint) INTO v
      FROM public.commercial_quotes WHERE company_id = p_company_id AND quote_number ~ '^(QT-\d{4}-|QU)\d+$';
  ELSIF p_kind = 'credit_note' THEN
    SELECT max(substring(credit_note_number FROM '^CN-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.credit_notes WHERE company_id = p_company_id AND credit_note_number ~ '^CN-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'purchase_order' THEN
    SELECT max(substring(po_number FROM '^PO-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.purchase_orders WHERE company_id = p_company_id AND po_number ~ '^PO-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'rfq' THEN
    SELECT max(substring(rfq_number FROM '^RFQ-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.rfqs WHERE company_id = p_company_id AND rfq_number ~ '^RFQ-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'grn' THEN
    SELECT max(substring(grn_number FROM '^GRN-?(?:\d{4}-)?(\d+)$')::bigint) INTO v
      FROM public.goods_received_notes WHERE company_id = p_company_id AND grn_number ~ '^GRN-?(\d{4}-)?\d+$';
  ELSIF p_kind = 'contractor_quote' THEN
    -- Old: QT-<company>-<contractor>-0001 (counted per contractor); new: CQ0001 (per company).
    SELECT max(coalesce(substring(quote_number FROM '^CQ(\d+)$'), substring(quote_number FROM '^QT-.*-(\d+)$'))::bigint) INTO v
      FROM public.contractor_quotes WHERE company_id = p_company_id AND quote_number ~ '^(CQ\d+|QT-.*-\d+)$';
  ELSIF p_kind = 'bill' THEN
    SELECT max(substring(bill_number FROM '^BILL(\d+)$')::bigint) INTO v
      FROM public.supplier_invoices WHERE company_id = p_company_id AND bill_number ~ '^BILL\d+$';
  ELSIF p_kind = 'receipt' THEN
    SELECT max(substring(receipt_number FROM '^REC(\d+)$')::bigint) INTO v
      FROM public.finance_transactions WHERE company_id = p_company_id AND receipt_number ~ '^REC\d+$';
  ELSIF p_kind = 'remittance' THEN
    SELECT max(substring(remittance_number FROM '^REM(\d+)$')::bigint) INTO v
      FROM public.supplier_invoices WHERE company_id = p_company_id AND remittance_number ~ '^REM\d+$';
    SELECT max(substring(remittance_number FROM '^REM(\d+)$')::bigint) INTO w
      FROM public.contractor_payouts WHERE company_id = p_company_id AND remittance_number ~ '^REM\d+$';
    v := greatest(coalesce(v, 0), coalesce(w, 0));
  ELSE
    -- Jobs: old <code>-J0001, new J0001. (Very old J<code><4 digits>, e.g. J280001, is not counted.)
    SELECT max(coalesce(substring(job_code FROM '-J(\d+)$'), substring(job_code FROM '^J(\d{4,5})$'))::bigint) INTO v
      FROM public.jobs WHERE company_id = p_company_id AND (job_code ~ '-J\d+$' OR job_code ~ '^J\d{4,5}$');
  END IF;
  RETURN coalesce(v, 0);
END $$;

CREATE OR REPLACE FUNCTION public._doc_next_number(p_company_id uuid, p_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n bigint; v_prefix text;
BEGIN
  v_n := public._doc_counter_next(p_company_id, p_kind, 'all', public._doc_max_used(p_company_id, p_kind, 'all'));
  v_prefix := CASE p_kind
    WHEN 'invoice' THEN 'INV' WHEN 'quote' THEN 'QU' WHEN 'credit_note' THEN 'CN' WHEN 'purchase_order' THEN 'PO'
    WHEN 'rfq' THEN 'RFQ' WHEN 'grn' THEN 'GRN' WHEN 'contractor_quote' THEN 'CQ' WHEN 'bill' THEN 'BILL'
    WHEN 'receipt' THEN 'REC' WHEN 'remittance' THEN 'REM' ELSE 'J' END;
  RETURN v_prefix || lpad(v_n::text, 4, '0');
END $$;

-- Contractor quotes (made in the contractor portal): CQ0001 per company.
CREATE OR REPLACE FUNCTION public.generate_contractor_quote_number(p_company_id uuid, p_contractor_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contractors WHERE id = p_contractor_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN public._doc_next_number(p_company_id, 'contractor_quote');
END $$;

-- Supplier bills: our own number on every bill as it is captured; remittance number once it is paid.
CREATE OR REPLACE FUNCTION public._trg_supplier_bill_numbers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.bill_number IS NOT NULL THEN NEW.bill_number := OLD.bill_number; END IF;
  IF TG_OP = 'UPDATE' AND OLD.remittance_number IS NOT NULL THEN NEW.remittance_number := OLD.remittance_number; END IF;
  IF NEW.bill_number IS NULL THEN NEW.bill_number := public._doc_next_number(NEW.company_id, 'bill'); END IF;
  IF NEW.remittance_number IS NULL AND coalesce(NEW.amount_paid, 0) > 0 THEN
    NEW.remittance_number := public._doc_next_number(NEW.company_id, 'remittance');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER supplier_bill_numbers BEFORE INSERT OR UPDATE ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_supplier_bill_numbers();

-- Contractor payouts: remittance number once paid.
CREATE OR REPLACE FUNCTION public._trg_payout_remittance_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.remittance_number IS NOT NULL THEN NEW.remittance_number := OLD.remittance_number; END IF;
  IF NEW.remittance_number IS NULL AND NEW.payout_status = 'paid' THEN
    NEW.remittance_number := public._doc_next_number(NEW.company_id, 'remittance');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER payout_remittance_number BEFORE INSERT OR UPDATE ON public.contractor_payouts
  FOR EACH ROW EXECUTE FUNCTION public._trg_payout_remittance_number();

-- Client payments received: receipt number on each one.
CREATE OR REPLACE FUNCTION public._trg_receipt_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.receipt_number IS NOT NULL THEN NEW.receipt_number := OLD.receipt_number; END IF;
  IF NEW.receipt_number IS NULL AND NEW.direction = 'incoming' AND NEW.source_table = 'finance_invoices' THEN
    NEW.receipt_number := public._doc_next_number(NEW.company_id, 'receipt');
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER finance_receipt_number BEFORE INSERT OR UPDATE ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public._trg_receipt_number();

-- Number what is already there, oldest first (the triggers fill the numbers in).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.supplier_invoices WHERE bill_number IS NULL ORDER BY company_id, created_at LOOP
    UPDATE public.supplier_invoices SET updated_at = updated_at WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.contractor_payouts WHERE remittance_number IS NULL AND payout_status = 'paid' ORDER BY company_id, coalesce(paid_at, updated_at) LOOP
    UPDATE public.contractor_payouts SET updated_at = updated_at WHERE id = r.id;
  END LOOP;
  FOR r IN SELECT id FROM public.finance_transactions WHERE receipt_number IS NULL AND direction = 'incoming' AND source_table = 'finance_invoices'
           ORDER BY company_id, transaction_date, created_at LOOP
    UPDATE public.finance_transactions SET receipt_number = NULL WHERE id = r.id;
  END LOOP;
END $$;

-- Statements show the new numbers: supplier bills by BILL number, payments by REM number.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.supplier_statement(uuid)'::regprocedure);
  d := replace(d, $a$SELECT created_at::date entry_date, 1 ord, 'invoice' kind, id invoice_id, invoice_number reference,
             'Bill ' || coalesce(invoice_number, '') description,$a$, $a$SELECT created_at::date entry_date, 1 ord, 'invoice' kind, id invoice_id, coalesce(bill_number, invoice_number) reference,
             'Bill' || coalesce(' — their invoice ' || invoice_number, '') description,$a$);
  d := replace(d, $a$SELECT coalesce(paid_at::date, updated_at::date), 2, 'payment', id, invoice_number,
             'Payment made',$a$, $a$SELECT coalesce(paid_at::date, updated_at::date), 2, 'payment', id, coalesce(remittance_number, bill_number, invoice_number),
             'Payment made',$a$);
  EXECUTE d;
  d := pg_get_functiondef('public.contractor_statement(uuid)'::regprocedure);
  d := replace(d, $a$SELECT coalesce(p.paid_at::date, p.payout_date), 2, 'payment', p.id, j.job_code, 'Paid',$a$,
                  $a$SELECT coalesce(p.paid_at::date, p.payout_date), 2, 'payment', p.id, coalesce(p.remittance_number, j.job_code), 'Paid',$a$);
  EXECUTE d;
END $$;
