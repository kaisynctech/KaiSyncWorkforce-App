-- Release 3: money coming back from Xero, and one-click setup.
-- • Payments entered in Xero (on invoices and bills that KaiSync sent) are recorded in KaiSync.
-- • A payment that came from Xero and is later deleted in Xero is reversed in KaiSync.
-- • An invoice voided in Xero (with no payments) is voided in KaiSync.
-- Nothing recorded from Xero is sent back to Xero (kaisync.from_xero switch). A payment never takes an invoice or
-- bill past what is owed, so a payment that is already in both places is never counted twice.
-- Rollback: SELECT cron.unschedule('xero-pull'); UPDATE xero_connections SET pull_from_xero = false;
--   (payments already recorded stay; they can be removed in KaiSync like any other payment)

-- ── 1. Settings and links ────────────────────────────────────────────────────
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS pull_from_xero boolean NOT NULL DEFAULT true;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS pulled_at timestamptz;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS pull_error text;

ALTER TABLE public.xero_doc_links DROP CONSTRAINT IF EXISTS xero_doc_links_entity_check;
ALTER TABLE public.xero_doc_links ADD CONSTRAINT xero_doc_links_entity_check CHECK (entity IN (
  'invoice', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment',
  'xero_payment', 'xero_supplier_payment'));
CREATE INDEX IF NOT EXISTS xero_doc_links_xero_id_idx ON public.xero_doc_links (company_id, xero_id);

-- Nothing is queued for Xero while KaiSync is recording something that came from Xero.
CREATE OR REPLACE FUNCTION public.xero_enqueue(p_company_id uuid, p_entity text, p_record_id uuid, p_label text DEFAULT NULL, p_doc_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.xero_connections%ROWTYPE;
BEGIN
  IF current_setting('kaisync.from_xero', true) = '1' THEN RETURN; END IF;
  SELECT * INTO c FROM public.xero_connections WHERE company_id = p_company_id;
  IF NOT FOUND OR NOT coalesce(c.is_active, true) OR NOT c.auto_sync THEN RETURN; END IF;
  IF p_doc_date IS NOT NULL AND c.sync_from IS NOT NULL AND p_doc_date < c.sync_from THEN RETURN; END IF;
  INSERT INTO public.xero_sync_queue (company_id, entity, record_id, label)
  VALUES (p_company_id, p_entity, p_record_id, p_label)
  ON CONFLICT (company_id, entity, record_id) WHERE status IN ('pending', 'working', 'error')
  DO UPDATE SET status = CASE WHEN xero_sync_queue.status = 'working' THEN 'working' ELSE 'pending' END,
                next_attempt_at = now(), label = coalesce(EXCLUDED.label, xero_sync_queue.label);
END $$;

-- ── 2. Record a client payment from Xero ─────────────────────────────────────
-- Returns 'recorded', 'exists' (already in KaiSync), or 'skipped: <why>'.
CREATE OR REPLACE FUNCTION public.xero_apply_payment(p_company_id uuid, p_invoice_id uuid, p_amount numeric, p_date date,
  p_reference text, p_xero_payment_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.finance_invoices%ROWTYPE; v_amt numeric; v_paid numeric; v_due numeric; v_status text; v_ledger uuid;
BEGIN
  PERFORM set_config('kaisync.from_xero', '1', true);
  IF EXISTS (SELECT 1 FROM public.xero_doc_links WHERE company_id = p_company_id AND xero_id = p_xero_payment_id
             AND entity IN ('payment', 'xero_payment')) THEN RETURN 'exists'; END IF;
  SELECT * INTO inv FROM public.finance_invoices WHERE id = p_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skipped: invoice not in KaiSync'; END IF;
  IF inv.status IN ('draft', 'cancelled', 'voided') THEN RETURN 'skipped: invoice is ' || inv.status; END IF;
  v_amt := round(least(coalesce(p_amount, 0), greatest(coalesce(inv.balance_due, inv.total_amount - coalesce(inv.amount_paid, 0)), 0)), 2);
  IF v_amt <= 0 THEN
    -- Already paid in KaiSync: remember the Xero payment so it is not looked at again.
    INSERT INTO public.xero_doc_links (company_id, entity, record_id, xero_id, xero_status, last_synced_at)
    VALUES (p_company_id, 'xero_payment', gen_random_uuid(), p_xero_payment_id, 'ALREADY_PAID', now());
    RETURN 'skipped: already paid in KaiSync';
  END IF;
  v_paid := round(coalesce(inv.amount_paid, 0) + v_amt, 2);
  v_due := greatest(round(inv.total_amount - v_paid, 2), 0);
  v_status := CASE WHEN v_due <= 0.005 THEN 'paid'
                   WHEN inv.due_date IS NOT NULL AND inv.due_date < (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN 'overdue'
                   ELSE 'partially_paid' END;
  UPDATE public.finance_invoices SET amount_paid = v_paid, balance_due = v_due, status = v_status,
         paid_date = CASE WHEN v_status = 'paid' THEN p_date ELSE paid_date END
   WHERE id = inv.id;
  INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
         amount, total_amount, transaction_date, payment_method, notes)
  VALUES (p_company_id, 'invoice', 'incoming', 'finance_invoices', inv.id, coalesce(nullif(p_reference, ''), inv.invoice_number),
         v_amt, v_amt, p_date, 'xero', 'Recorded from Xero');
  IF inv.client_id IS NOT NULL THEN
    INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
           description, debit, credit, entry_date)
    VALUES (p_company_id, inv.client_id, 'payment', 'finance_invoices', inv.id, inv.invoice_number,
           'Payment received (from Xero) — ' || coalesce(inv.invoice_number, ''), 0, v_amt, p_date)
    RETURNING id INTO v_ledger;
  END IF;
  INSERT INTO public.xero_doc_links (company_id, entity, record_id, xero_id, xero_number, xero_status, last_synced_at)
  VALUES (p_company_id, 'xero_payment', coalesce(v_ledger, gen_random_uuid()), p_xero_payment_id, inv.invoice_number, 'AUTHORISED', now());
  RETURN 'recorded';
END $$;

-- A payment that came from Xero was deleted there: take it off the invoice again.
CREATE OR REPLACE FUNCTION public.xero_reverse_payment(p_company_id uuid, p_xero_payment_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.xero_doc_links%ROWTYPE; le public.customer_ledger_entries%ROWTYPE; inv public.finance_invoices%ROWTYPE;
        v_paid numeric; v_due numeric;
BEGIN
  PERFORM set_config('kaisync.from_xero', '1', true);
  SELECT * INTO l FROM public.xero_doc_links WHERE company_id = p_company_id AND entity = 'xero_payment' AND xero_id = p_xero_payment_id;
  IF NOT FOUND OR l.xero_status <> 'AUTHORISED' THEN RETURN 'nothing to undo'; END IF;
  SELECT * INTO le FROM public.customer_ledger_entries WHERE id = l.record_id;
  IF NOT FOUND THEN RETURN 'nothing to undo'; END IF;
  SELECT * INTO inv FROM public.finance_invoices WHERE id = le.source_id FOR UPDATE;
  v_paid := greatest(round(coalesce(inv.amount_paid, 0) - le.credit, 2), 0);
  v_due := round(inv.total_amount - v_paid, 2);
  UPDATE public.finance_invoices SET amount_paid = v_paid, balance_due = v_due, paid_date = NULL,
         status = CASE WHEN v_paid <= 0 AND inv.due_date < (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN 'overdue'
                       WHEN v_paid <= 0 THEN 'sent'
                       WHEN inv.due_date < (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN 'overdue'
                       ELSE 'partially_paid' END
   WHERE id = inv.id AND status <> 'voided';
  INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
         amount, total_amount, transaction_date, payment_method, notes)
  VALUES (p_company_id, 'adjustment', 'outgoing', 'finance_invoices', inv.id, inv.invoice_number,
         le.credit, le.credit, (now() AT TIME ZONE 'Africa/Johannesburg')::date, 'xero', 'Payment deleted in Xero');
  INSERT INTO public.customer_ledger_entries (company_id, client_id, entry_type, source_table, source_id, reference_number,
         description, debit, credit, entry_date)
  VALUES (p_company_id, le.client_id, 'adjustment', 'finance_invoices', inv.id, inv.invoice_number,
         'Payment removed in Xero — ' || coalesce(inv.invoice_number, ''), le.credit, 0, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
  UPDATE public.xero_doc_links SET xero_status = 'DELETED', last_synced_at = now() WHERE id = l.id;
  RETURN 'reversed';
END $$;

-- ── 3. Record a supplier payment from Xero ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.xero_apply_supplier_payment(p_company_id uuid, p_supplier_invoice_id uuid, p_amount numeric,
  p_date date, p_reference text, p_xero_payment_id text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE si public.supplier_invoices%ROWTYPE; v_amt numeric; v_paid numeric; v_due numeric;
BEGIN
  PERFORM set_config('kaisync.from_xero', '1', true);
  IF EXISTS (SELECT 1 FROM public.xero_doc_links WHERE company_id = p_company_id AND xero_id = p_xero_payment_id
             AND entity IN ('supplier_payment', 'xero_supplier_payment')) THEN RETURN 'exists'; END IF;
  SELECT * INTO si FROM public.supplier_invoices WHERE id = p_supplier_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skipped: supplier invoice not in KaiSync'; END IF;
  IF si.status = 'cancelled' THEN RETURN 'skipped: supplier invoice is cancelled'; END IF;
  v_amt := round(least(coalesce(p_amount, 0), greatest(coalesce(si.balance_due, si.total_amount - coalesce(si.amount_paid, 0)), 0)), 2);
  IF v_amt > 0 THEN
    v_paid := round(coalesce(si.amount_paid, 0) + v_amt, 2);
    v_due := greatest(round(si.total_amount - v_paid, 2), 0);
    UPDATE public.supplier_invoices SET amount_paid = v_paid, balance_due = v_due,
           status = CASE WHEN v_due <= 0.005 THEN 'paid' ELSE status END,
           paid_at = CASE WHEN v_due <= 0.005 THEN p_date::timestamptz ELSE paid_at END, updated_at = now()
     WHERE id = si.id;
    INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id, reference_number,
           amount, total_amount, transaction_date, payment_method, notes)
    VALUES (p_company_id, 'supplier_payment', 'outgoing', 'supplier_invoices', si.id,
           coalesce(nullif(p_reference, ''), si.invoice_number, si.bill_number), v_amt, v_amt, p_date, 'xero', 'Recorded from Xero');
  END IF;
  INSERT INTO public.xero_doc_links (company_id, entity, record_id, xero_id, xero_number, xero_status, last_synced_at)
  VALUES (p_company_id, 'xero_supplier_payment', gen_random_uuid(), p_xero_payment_id, si.invoice_number,
          CASE WHEN v_amt > 0 THEN 'AUTHORISED' ELSE 'ALREADY_PAID' END, now());
  RETURN CASE WHEN v_amt > 0 THEN 'recorded' ELSE 'skipped: already paid in KaiSync' END;
END $$;

-- ── 4. Invoice voided in Xero ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xero_apply_invoice_void(p_company_id uuid, p_invoice_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.finance_invoices%ROWTYPE;
BEGIN
  PERFORM set_config('kaisync.from_xero', '1', true);
  SELECT * INTO inv FROM public.finance_invoices WHERE id = p_invoice_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND OR inv.status IN ('voided', 'cancelled') THEN RETURN 'exists'; END IF;
  IF coalesce(inv.amount_paid, 0) > 0 THEN RETURN 'skipped: it has payments in KaiSync — void it in KaiSync after checking'; END IF;
  UPDATE public.finance_invoices SET status = 'voided', voided_at = now(), void_reason = 'Voided in Xero' WHERE id = inv.id;
  UPDATE public.xero_doc_links SET xero_status = 'VOIDED', last_synced_at = now()
   WHERE company_id = p_company_id AND entity = 'invoice' AND record_id = inv.id;
  RETURN 'voided';
END $$;

REVOKE ALL ON FUNCTION public.xero_apply_payment(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_reverse_payment(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_apply_supplier_payment(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_apply_invoice_void(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xero_apply_payment(uuid, uuid, numeric, date, text, text), public.xero_reverse_payment(uuid, text),
  public.xero_apply_supplier_payment(uuid, uuid, numeric, date, text, text), public.xero_apply_invoice_void(uuid, uuid) TO service_role;

-- ── 5. Settings screen ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xero_sync_status(p_company_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.xero_connections%ROWTYPE; v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true))
     AND NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT * INTO c FROM public.xero_connections WHERE company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('connected', false); END IF;
  RETURN jsonb_build_object(
    'connected', coalesce(c.is_active, true), 'tenant_name', c.tenant_name,
    'can_sync_documents', coalesce(c.scopes, '') ILIKE '%accounting.invoices%' OR coalesce(c.scopes, '') ILIKE '%accounting.transactions%',
    'auto_sync', c.auto_sync, 'sync_from', c.sync_from,
    'sales_account_code', c.sales_account_code, 'purchases_account_code', c.purchases_account_code, 'bank_account_code', c.bank_account_code,
    'last_error', c.last_error, 'last_error_at', c.last_error_at,
    'pull_from_xero', c.pull_from_xero, 'pulled_at', c.pulled_at, 'pull_error', c.pull_error,
    'received_today', (SELECT count(*) FROM public.xero_doc_links l WHERE l.company_id = p_company_id
                         AND l.entity IN ('xero_payment', 'xero_supplier_payment') AND l.xero_status = 'AUTHORISED' AND l.last_synced_at >= v_day),
    'waiting', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status IN ('pending', 'working')),
    'failed', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'error'),
    'sent_today', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'done' AND q.done_at >= v_day));
END $$;

CREATE OR REPLACE FUNCTION public.xero_set_pull(p_company_id uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.xero_connections SET pull_from_xero = p_on, updated_at = now() WHERE company_id = p_company_id;
END $$;
REVOKE ALL ON FUNCTION public.xero_set_pull(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xero_set_pull(uuid, boolean) TO authenticated;

-- ── 6. Check Xero every 10 minutes ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xero_pull_kick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.xero_connections WHERE coalesce(is_active, true) AND auto_sync AND pull_from_xero) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'xero_sync_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/xero-pull',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-xero-sync-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION public.xero_pull_kick() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule('xero-pull') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'xero-pull');
SELECT cron.schedule('xero-pull', '*/10 * * * *', 'SELECT public.xero_pull_kick();');
