-- Xero sync v2 (approved by Nyarie, 6 Nov 2026).
-- What goes to Xero automatically (once a company switches auto-sync on):
--   clients / suppliers            on create and edit (no duplicates: linked, or matched by name/email in Xero)
--   invoices                       when they leave Draft, as AUTHORISED with the same number; void → void in Xero
--   credit notes                   when approved, allocated to their invoice
--   payments received              each payment on an invoice (customer ledger 'payment' entries)
--   purchase orders                when fully received → one Xero bill (ACCPAY) per PO
--   supplier invoices              when approved → update that PO's bill, or a new bill if there is no PO
--   supplier payments              when a supplier invoice is marked paid
-- Only documents dated on/after the company's sync_from date (go-live) are sent. Nothing old is touched.
-- Everything goes through xero_sync_queue; the xero-sync-run function works the queue every minute,
-- retries with back-off and keeps Xero's own error message for the Settings screen.
-- Additive only. Rollback: see the end.

-- ── 1. Connection settings ──────────────────────────────────────────────────
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT false;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS sync_from date;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS purchases_account_code text;   -- bills (e.g. 300 Purchases / 310 Cost of sales)
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS bank_account_code text;        -- payments received and paid
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS scopes text;                   -- what the company granted at connect time
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.xero_connections ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

-- ── 2. Links between KaiSync documents and Xero ────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_doc_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('invoice', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment')),
  record_id uuid NOT NULL,
  xero_id text NOT NULL,
  xero_number text,
  xero_status text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, entity, record_id)
);
ALTER TABLE public.xero_doc_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xero_doc_links_read ON public.xero_doc_links;
CREATE POLICY xero_doc_links_read ON public.xero_doc_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = xero_doc_links.company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true)));

-- ── 3. The queue ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.xero_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('client', 'supplier', 'invoice', 'invoice_void', 'credit_note', 'payment',
                                          'po_bill', 'supplier_bill', 'supplier_payment')),
  record_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'working', 'done', 'error', 'skipped')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  label text,                                   -- e.g. "Invoice INV-0042" for the Settings list
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
-- One open job per record: a second change while it is waiting just re-uses it.
CREATE UNIQUE INDEX IF NOT EXISTS xero_sync_queue_open_key ON public.xero_sync_queue (company_id, entity, record_id)
  WHERE status IN ('pending', 'working', 'error');
CREATE INDEX IF NOT EXISTS xero_sync_queue_due_idx ON public.xero_sync_queue (next_attempt_at) WHERE status IN ('pending', 'error');
ALTER TABLE public.xero_sync_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS xero_sync_queue_read ON public.xero_sync_queue;
CREATE POLICY xero_sync_queue_read ON public.xero_sync_queue FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = xero_sync_queue.company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true)));

-- Add (or refresh) a job. Does nothing unless the company has Xero connected with auto-sync on.
CREATE OR REPLACE FUNCTION public.xero_enqueue(p_company_id uuid, p_entity text, p_record_id uuid, p_label text DEFAULT NULL, p_doc_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.xero_connections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.xero_connections WHERE company_id = p_company_id;
  IF NOT FOUND OR NOT coalesce(c.is_active, true) OR NOT c.auto_sync THEN RETURN; END IF;
  IF p_doc_date IS NOT NULL AND c.sync_from IS NOT NULL AND p_doc_date < c.sync_from THEN RETURN; END IF;
  INSERT INTO public.xero_sync_queue (company_id, entity, record_id, label)
  VALUES (p_company_id, p_entity, p_record_id, p_label)
  ON CONFLICT (company_id, entity, record_id) WHERE status IN ('pending', 'working', 'error')
  DO UPDATE SET status = CASE WHEN xero_sync_queue.status = 'working' THEN 'working' ELSE 'pending' END,
                next_attempt_at = now(), label = coalesce(EXCLUDED.label, xero_sync_queue.label);
END $$;

-- ── 4. What puts jobs on the queue ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_xero_client() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone AND NEW.address IS NOT DISTINCT FROM OLD.address THEN RETURN NEW; END IF;
  PERFORM public.xero_enqueue(NEW.company_id, 'client', NEW.id, 'Client ' || coalesce(NEW.name, ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_client ON public.clients;
CREATE TRIGGER trg_xero_client AFTER INSERT OR UPDATE OF name, email, phone, address ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_client();

CREATE OR REPLACE FUNCTION public._trg_xero_supplier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT coalesce(NEW.is_active, true) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone AND NEW.address IS NOT DISTINCT FROM OLD.address
     AND NEW.vat_number IS NOT DISTINCT FROM OLD.vat_number AND coalesce(OLD.is_active, true) THEN RETURN NEW; END IF;
  PERFORM public.xero_enqueue(NEW.company_id, 'supplier', NEW.id, 'Supplier ' || coalesce(NEW.name, ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_supplier ON public.contractors;
CREATE TRIGGER trg_xero_supplier AFTER INSERT OR UPDATE OF name, email, phone, address, vat_number, is_active ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_supplier();

CREATE OR REPLACE FUNCTION public._trg_xero_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_issued boolean := NEW.status NOT IN ('draft', 'cancelled', 'voided');
        v_was boolean := TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft', 'cancelled', 'voided');
        v_label text := 'Invoice ' || coalesce(NEW.invoice_number, '');
BEGIN
  IF v_issued AND (NOT v_was OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'invoice', NEW.id, v_label, coalesce(NEW.issue_date, NEW.created_at::date));
  ELSIF NEW.status IN ('cancelled', 'voided') AND TG_OP = 'UPDATE' AND OLD.status NOT IN ('cancelled', 'voided')
        AND EXISTS (SELECT 1 FROM public.xero_doc_links l WHERE l.company_id = NEW.company_id AND l.entity = 'invoice' AND l.record_id = NEW.id) THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'invoice_void', NEW.id, v_label || ' (void)');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_invoice ON public.finance_invoices;
CREATE TRIGGER trg_xero_invoice AFTER INSERT OR UPDATE OF status, total_amount, due_date ON public.finance_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_invoice();

CREATE OR REPLACE FUNCTION public._trg_xero_credit_note() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'credit_note', NEW.id, 'Credit note ' || coalesce(NEW.credit_note_number, ''),
      coalesce(NEW.issue_date, NEW.created_at::date));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_credit_note ON public.credit_notes;
CREATE TRIGGER trg_xero_credit_note AFTER INSERT OR UPDATE OF status ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_credit_note();

CREATE OR REPLACE FUNCTION public._trg_xero_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.entry_type = 'payment' AND NEW.source_table = 'finance_invoices' AND coalesce(NEW.credit, 0) > 0 THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'payment', NEW.id, 'Payment on ' || coalesce(NEW.reference_number, 'invoice'), NEW.entry_date);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_payment ON public.customer_ledger_entries;
CREATE TRIGGER trg_xero_payment AFTER INSERT ON public.customer_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_payment();

-- PO fully received (every line received in full) → one bill.
CREATE OR REPLACE FUNCTION public._trg_xero_po_received() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  IF coalesce(NEW.quantity_received, 0) < coalesce(NEW.quantity_ordered, 0) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_lines l WHERE l.po_id = NEW.po_id
              AND coalesce(l.quantity_received, 0) < coalesce(l.quantity_ordered, 0)) THEN RETURN NEW; END IF;
  SELECT * INTO po FROM public.purchase_orders WHERE id = NEW.po_id;
  IF po.status IN ('cancelled', 'draft') THEN RETURN NEW; END IF;
  PERFORM public.xero_enqueue(po.company_id, 'po_bill', po.id, 'Purchase order ' || coalesce(po.po_number, ''),
    coalesce(po.actual_delivery_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_po_received ON public.purchase_order_lines;
CREATE TRIGGER trg_xero_po_received AFTER UPDATE OF quantity_received ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_po_received();

CREATE OR REPLACE FUNCTION public._trg_xero_supplier_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_label text := 'Supplier invoice ' || coalesce(NEW.invoice_number, NEW.bill_number, '');
BEGIN
  IF NEW.approval_status = 'approved' AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved'
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount) AND NEW.status <> 'cancelled' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_bill', NEW.id, v_label, coalesce(NEW.approved_at::date, NEW.created_at::date));
  END IF;
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_payment', NEW.id, v_label || ' (paid)', coalesce(NEW.paid_at::date, NEW.created_at::date));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_supplier_invoice ON public.supplier_invoices;
CREATE TRIGGER trg_xero_supplier_invoice AFTER INSERT OR UPDATE OF approval_status, status, total_amount ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_supplier_invoice();

-- ── 5. Settings screen helpers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.xero_can_manage(p_company_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.platform_is_admin() OR EXISTS (SELECT 1 FROM public.employees e
    WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true)
      AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin', 'finance'))
$$;

-- Status for Settings: connection, settings, whether the connection has invoice rights, queue counts.
CREATE OR REPLACE FUNCTION public.xero_sync_status(p_company_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.xero_connections%ROWTYPE;
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
    'waiting', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status IN ('pending', 'working')),
    'failed', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'error'),
    'sent_today', (SELECT count(*) FROM public.xero_sync_queue q WHERE q.company_id = p_company_id AND q.status = 'done'
                    AND q.done_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg'));
END $$;

CREATE OR REPLACE FUNCTION public.xero_save_settings(p_company_id uuid, p_auto_sync boolean, p_sync_from date,
  p_sales_account text, p_purchases_account text, p_bank_account text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_auto_sync AND (nullif(trim(p_sales_account), '') IS NULL OR nullif(trim(p_purchases_account), '') IS NULL OR nullif(trim(p_bank_account), '') IS NULL) THEN
    RAISE EXCEPTION 'XERO_ACCOUNTS_REQUIRED';
  END IF;
  UPDATE public.xero_connections SET auto_sync = p_auto_sync,
    sync_from = coalesce(p_sync_from, sync_from, (now() AT TIME ZONE 'Africa/Johannesburg')::date),
    sales_account_code = nullif(trim(p_sales_account), ''), purchases_account_code = nullif(trim(p_purchases_account), ''),
    bank_account_code = nullif(trim(p_bank_account), ''), updated_at = now()
   WHERE company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'XERO_NOT_CONNECTED'; END IF;
END $$;

-- Try failed jobs again now (one, or all for the company).
CREATE OR REPLACE FUNCTION public.xero_retry(p_company_id uuid, p_job_id uuid DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.xero_sync_queue SET status = 'pending', next_attempt_at = now(), attempts = 0
   WHERE company_id = p_company_id AND status = 'error' AND (p_job_id IS NULL OR id = p_job_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Send a document now (the per-document "Send to Xero" button), whatever its date.
CREATE OR REPLACE FUNCTION public.xero_send_now(p_company_id uuid, p_entity text, p_record_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.xero_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF p_entity NOT IN ('client', 'supplier', 'invoice', 'credit_note', 'po_bill', 'supplier_bill') THEN RAISE EXCEPTION 'BAD_ENTITY'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.xero_connections WHERE company_id = p_company_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'XERO_NOT_CONNECTED'; END IF;
  INSERT INTO public.xero_sync_queue (company_id, entity, record_id, label)
  VALUES (p_company_id, p_entity, p_record_id, initcap(replace(p_entity, '_', ' ')))
  ON CONFLICT (company_id, entity, record_id) WHERE status IN ('pending', 'working', 'error')
  DO UPDATE SET status = 'pending', next_attempt_at = now(), attempts = 0;
END $$;

-- ── 6. The worker: called every minute; the function checks this secret ────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'xero_sync_secret') THEN
    PERFORM vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'xero_sync_secret', 'Xero sync worker');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.xero_sync_secret_ok(p_secret text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'xero_sync_secret' AND decrypted_secret = p_secret)
$$;

CREATE OR REPLACE FUNCTION public.xero_sync_kick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.xero_sync_queue WHERE status IN ('pending', 'error') AND next_attempt_at <= now()) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'xero_sync_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/xero-sync-run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-xero-sync-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;

-- Jobs stuck in 'working' (worker crashed) go back to pending after 10 minutes.
CREATE OR REPLACE FUNCTION public.xero_sync_unstick() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.xero_sync_queue SET status = 'pending', next_attempt_at = now()
   WHERE status = 'working' AND next_attempt_at < now() - interval '10 minutes';
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'xero-sync';
SELECT cron.schedule('xero-sync', '* * * * *', 'SELECT public.xero_sync_unstick(); SELECT public.xero_sync_kick();');

-- ── 7. Access ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.xero_enqueue(uuid, text, uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_sync_secret_ok(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_sync_kick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.xero_sync_unstick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.xero_sync_secret_ok(text) TO service_role;
REVOKE ALL ON FUNCTION public.xero_sync_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.xero_save_settings(uuid, boolean, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.xero_retry(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.xero_send_now(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xero_sync_status(uuid), public.xero_save_settings(uuid, boolean, date, text, text, text),
  public.xero_retry(uuid, uuid), public.xero_send_now(uuid, text, uuid) TO authenticated;

-- ── Rollback ────────────────────────────────────────────────────────────────
-- SELECT cron.unschedule('xero-sync');
-- DROP TRIGGER trg_xero_client ON clients; DROP TRIGGER trg_xero_supplier ON contractors;
-- DROP TRIGGER trg_xero_invoice ON finance_invoices; DROP TRIGGER trg_xero_credit_note ON credit_notes;
-- DROP TRIGGER trg_xero_payment ON customer_ledger_entries; DROP TRIGGER trg_xero_po_received ON purchase_order_lines;
-- DROP TRIGGER trg_xero_supplier_invoice ON supplier_invoices;
-- (or simply: UPDATE xero_connections SET auto_sync = false — nothing is queued while it is off)
-- The new tables, columns and functions can stay; nothing else reads them.
