-- Short document numbers everywhere, like INV0001 and QU0001: credit notes CN0001, purchase orders PO0001,
-- RFQs RFQ0001, goods received GRN0001. One counter per company and kind (no duplicates, even when two
-- people save at once). Old long numbers (PO-2026-0001) stay as they are; the counter carries on after them.
-- Credit notes get their number when issued, like invoices when sent, and keep it.

CREATE OR REPLACE FUNCTION public._doc_max_used(p_company_id uuid, p_kind text, p_period text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
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
  ELSE
    SELECT max(substring(job_code FROM '-J(\d+)$')::bigint) INTO v
      FROM public.jobs WHERE company_id = p_company_id AND job_code ~ '-J\d+$';
  END IF;
  RETURN coalesce(v, 0);
END $$;

CREATE OR REPLACE FUNCTION public._doc_next_number(p_company_id uuid, p_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n bigint; v_prefix text;
BEGIN
  v_n := public._doc_counter_next(p_company_id, p_kind, 'all', public._doc_max_used(p_company_id, p_kind, 'all'));
  IF p_kind = 'invoice' THEN RETURN 'INV' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'quote' THEN RETURN 'QU' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'credit_note' THEN RETURN 'CN' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'purchase_order' THEN RETURN 'PO' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'rfq' THEN RETURN 'RFQ' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'grn' THEN RETURN 'GRN' || lpad(v_n::text, 4, '0'); END IF;
  SELECT upper(coalesce(nullif(trim(c.code), ''), 'JOB')) INTO v_prefix FROM public.companies c WHERE c.id = p_company_id;
  RETURN coalesce(v_prefix, 'JOB') || '-J' || lpad(v_n::text, 4, '0');
END $$;

-- The app asks for PO, RFQ and GRN numbers when it saves them. Same names, short numbers, members only.
CREATE OR REPLACE FUNCTION public.generate_po_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN public._doc_next_number(p_company_id, 'purchase_order');
END $$;

CREATE OR REPLACE FUNCTION public.generate_rfq_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN public._doc_next_number(p_company_id, 'rfq');
END $$;

CREATE OR REPLACE FUNCTION public.generate_grn_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN public._doc_next_number(p_company_id, 'grn');
END $$;

-- Credit notes: numbered when issued (any status except draft or voided), and the number never changes after.
CREATE OR REPLACE FUNCTION public._trg_credit_note_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.credit_note_number IS NOT NULL AND NEW.credit_note_number IS DISTINCT FROM OLD.credit_note_number THEN
    RAISE EXCEPTION 'An issued credit note keeps its number (%).', OLD.credit_note_number USING ERRCODE = '23514';
  END IF;
  IF NEW.credit_note_number IS NULL AND NEW.status NOT IN ('draft', 'voided') THEN
    NEW.credit_note_number := public._doc_next_number(NEW.company_id, 'credit_note');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER credit_note_number_on_issue BEFORE INSERT OR UPDATE OF status, credit_note_number ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public._trg_credit_note_number();

-- The counter table only knew invoice, quote and job.
ALTER TABLE public.document_counters DROP CONSTRAINT document_counters_kind_check;
ALTER TABLE public.document_counters ADD CONSTRAINT document_counters_kind_check
  CHECK (kind = ANY (ARRAY['invoice', 'quote', 'job', 'credit_note', 'purchase_order', 'rfq', 'grn']));
