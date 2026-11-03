-- Accounting readiness, part 1: safe document numbers and a complete customer ledger.
--
-- Before:
--  * invoice and quote numbers were MAX(existing)+1 and job codes COUNT(jobs)+1, worked out before the
--    row was saved — two people saving at once got the same number (the save of the second failed on
--    the unique index for invoices/jobs; quotes had no unique index at all), and deleting one job made
--    the next job code collide with an existing one, so no new job could be saved;
--  * an invoice number was taken before the invoice was sent, so a failed send left a gap;
--  * the number functions answered for any company;
--  * sending an invoice wrote nothing to the customer ledger, so the client "Outstanding" figure
--    (debits − credits) only ever saw payments and went negative.
--
-- After:
--  * one counter row per company, document kind and year, moved forward in the same transaction that
--    saves the document (row lock = no two people get the same number);
--  * an invoice gets its number from the database at the moment it stops being a draft, in the same
--    save — if the save fails, the number is not used, so issued invoice numbers have no gaps;
--  * an issued invoice number never changes;
--  * the customer ledger gets a debit when an invoice is issued, a correction when an issued invoice's
--    total changes, and a credit when an issued invoice is cancelled or voided; existing issued
--    invoices are backfilled once.

-- ── Counters ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_counters (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  kind text NOT NULL CHECK (kind IN ('invoice', 'quote', 'job')),
  period text NOT NULL,             -- the year for invoices and quotes ('2026'); 'all' for jobs
  last_value bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, kind, period)
);
ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
-- No policies: only the numbering functions below (SECURITY DEFINER) touch this table.

-- Next value for a counter. The first call for a company/kind/period starts after the highest number
-- already used, so existing documents keep their numbers and new ones carry on from them.
CREATE OR REPLACE FUNCTION public._doc_counter_next(p_company_id uuid, p_kind text, p_period text, p_floor bigint)
RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.document_counters AS c (company_id, kind, period, last_value)
  VALUES (p_company_id, p_kind, p_period, coalesce(p_floor, 0) + 1)
  ON CONFLICT (company_id, kind, period)
  DO UPDATE SET last_value = greatest(c.last_value, coalesce(p_floor, 0)) + 1, updated_at = now()
  RETURNING last_value
$$;

-- Highest number already used, so a counter never hands out a number that exists.
CREATE OR REPLACE FUNCTION public._doc_max_used(p_company_id uuid, p_kind text, p_period text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v bigint;
BEGIN
  IF p_kind = 'invoice' THEN
    SELECT max(substring(invoice_number FROM '^INV-' || p_period || '-(\d+)$')::bigint) INTO v
    FROM public.finance_invoices WHERE company_id = p_company_id AND invoice_number LIKE 'INV-' || p_period || '-%';
  ELSIF p_kind = 'quote' THEN
    SELECT max(substring(quote_number FROM '^QT-' || p_period || '-(\d+)$')::bigint) INTO v
    FROM public.commercial_quotes WHERE company_id = p_company_id AND quote_number LIKE 'QT-' || p_period || '-%';
  ELSE
    SELECT max(substring(job_code FROM '-J(\d+)$')::bigint) INTO v
    FROM public.jobs WHERE company_id = p_company_id AND job_code ~ '-J\d+$';
  END IF;
  RETURN coalesce(v, 0);
END $$;

CREATE OR REPLACE FUNCTION public._doc_next_number(p_company_id uuid, p_kind text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_year text := to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'YYYY'); v_period text; v_n bigint; v_prefix text;
BEGIN
  v_period := CASE WHEN p_kind = 'job' THEN 'all' ELSE v_year END;
  -- The counter row lock keeps two saves apart; the floor makes sure a number typed or imported by
  -- hand is never handed out again.
  v_n := public._doc_counter_next(p_company_id, p_kind, v_period, public._doc_max_used(p_company_id, p_kind, v_year));
  IF p_kind = 'invoice' THEN RETURN 'INV-' || v_year || '-' || lpad(v_n::text, 4, '0'); END IF;
  IF p_kind = 'quote' THEN RETURN 'QT-' || v_year || '-' || lpad(v_n::text, 4, '0'); END IF;
  SELECT upper(coalesce(nullif(trim(c.code), ''), 'JOB')) INTO v_prefix FROM public.companies c WHERE c.id = p_company_id;
  RETURN coalesce(v_prefix, 'JOB') || '-J' || lpad(v_n::text, 4, '0');
END $$;

-- ── Public number functions (same names and results as before) ────────────────────────────
-- Called directly from the app they now check the person belongs to the company; called from inside
-- other database functions or scheduled jobs (no signed-in person) they work as before.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN public._doc_next_number(p_company_id, 'invoice');
END $$;

CREATE OR REPLACE FUNCTION public.generate_quote_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (p_company_id = ANY (public.user_company_ids())) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN public._doc_next_number(p_company_id, 'quote');
END $$;

-- Job codes are also made inside linked-company, resident-portal and scheduled-plan functions where the
-- signed-in person (if any) belongs to another company, so this one keeps no membership check; it now
-- only hands out a code, it cannot read or change anything.
CREATE OR REPLACE FUNCTION public._next_job_code(p_company_id uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public._doc_next_number(p_company_id, 'job');
END $$;

-- ── Invoices: number on issue, number never changes ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_number IS NOT NULL AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     AND OLD.status NOT IN ('draft') THEN
    RAISE EXCEPTION 'An issued invoice keeps its number (%).', OLD.invoice_number USING ERRCODE = '23514';
  END IF;
  IF NEW.invoice_number IS NULL AND NEW.status NOT IN ('draft', 'cancelled', 'voided') THEN
    NEW.invoice_number := public._doc_next_number(NEW.company_id, 'invoice');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER invoice_number_on_issue BEFORE INSERT OR UPDATE OF status, invoice_number ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_invoice_number();

-- ── Customer ledger follows the invoice ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_invoice_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_issued_now boolean := NEW.status NOT IN ('draft', 'cancelled', 'voided');
  v_issued_before boolean := TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft', 'cancelled', 'voided');
  v_booked numeric;
  v_ref text := coalesce(NEW.invoice_number, NEW.id::text);
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  -- What the ledger already holds for this invoice (debits minus the corrections and cancellations).
  SELECT coalesce(sum(debit - credit), 0) INTO v_booked FROM public.customer_ledger_entries
   WHERE source_table = 'finance_invoices' AND source_id = NEW.id AND entry_type IN ('invoice', 'invoice_adjustment', 'invoice_cancelled');

  IF v_issued_now AND NOT EXISTS (SELECT 1 FROM public.customer_ledger_entries
       WHERE source_table = 'finance_invoices' AND source_id = NEW.id AND entry_type = 'invoice') THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref, coalesce(NEW.total_amount, 0), 0, coalesce(NEW.issue_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date), auth.uid());
  ELSIF v_issued_now AND v_issued_before AND round(coalesce(NEW.total_amount, 0) - v_booked, 2) <> 0 THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice_adjustment', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref || ' total changed',
      greatest(coalesce(NEW.total_amount, 0) - v_booked, 0), greatest(v_booked - coalesce(NEW.total_amount, 0), 0),
      (now() AT TIME ZONE 'Africa/Johannesburg')::date, auth.uid());
  ELSIF NOT v_issued_now AND v_issued_before AND NEW.status IN ('cancelled', 'voided') AND v_booked > 0 THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
      description, debit, credit, entry_date, created_by)
    VALUES (NEW.company_id, NEW.client_id, 'invoice_cancelled', 'finance_invoices', NEW.id, NEW.invoice_number,
      'Invoice ' || v_ref || ' ' || NEW.status, 0, v_booked, (now() AT TIME ZONE 'Africa/Johannesburg')::date, auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER invoice_customer_ledger AFTER INSERT OR UPDATE OF status, total_amount, client_id ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_invoice_ledger();

-- ── Quotes: no two quotes with the same number in a company ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_quotes_number ON public.commercial_quotes (company_id, quote_number)
  WHERE quote_number IS NOT NULL;

-- ── One-off backfill: debit for every invoice already issued to a client ──────────────────
INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
  description, debit, credit, entry_date)
SELECT i.company_id, i.client_id, 'invoice', 'finance_invoices', i.id, i.invoice_number,
       'Invoice ' || coalesce(i.invoice_number, i.id::text), coalesce(i.total_amount, 0), 0, coalesce(i.issue_date, i.created_at::date)
FROM public.finance_invoices i
WHERE i.client_id IS NOT NULL AND i.status NOT IN ('draft', 'cancelled', 'voided')
  AND NOT EXISTS (SELECT 1 FROM public.customer_ledger_entries l
                  WHERE l.source_table = 'finance_invoices' AND l.source_id = i.id AND l.entry_type = 'invoice');

-- Permissions (run separately):
-- REVOKE ALL ON FUNCTION public._doc_counter_next(uuid, text, text, bigint), public._doc_max_used(uuid, text, text),
--   public._doc_next_number(uuid, text), public._trg_invoice_number(), public._trg_invoice_ledger() FROM PUBLIC, anon, authenticated;
-- generate_invoice_number / generate_quote_number / _next_job_code keep their existing grants.
