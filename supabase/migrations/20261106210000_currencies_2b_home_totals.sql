-- Release 2B: company totals in the company's own currency (rand).
-- Every non-rand document carries exchange_rate = rand per 1 unit of its currency. Order of preference:
--   the owner's typed rate ('manual') → Xero's rate ('xero') → the European Central Bank daily rate for the
--   document's date ('daily', loaded by the fx-rates-daily function). Payments use their invoice's rate.
-- Totals multiply by coalesce(exchange_rate, 1) (rand documents have no rate).
-- Rollback: SELECT public.fx_restore_functions();  (puts back the 2A versions of the totals functions), then
--   DROP TRIGGER trg_doc_rate on the five tables. The new columns and the rates table can stay.

-- ── 1. Daily rates (ECB, euro-based) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fx_rates (
  day      date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  per_eur  numeric(20,10) NOT NULL CHECK (per_eur > 0),
  PRIMARY KEY (day, currency)
);
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_rates_read ON public.fx_rates;
CREATE POLICY fx_rates_read ON public.fx_rates FOR SELECT TO authenticated USING (true);

-- p_to units per 1 p_from on p_day (latest published day on or before it). Namibian dollar, loti and
-- lilangeni are pegged 1:1 to the rand. NULL when the ECB doesn't publish the currency.
CREATE OR REPLACE FUNCTION public.fx_rate(p_from text, p_to text, p_day date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE f text := upper(p_from); t text := upper(p_to); d date := coalesce(p_day, current_date); a numeric; b numeric;
BEGIN
  IF f IN ('NAD', 'LSL', 'SZL') THEN f := 'ZAR'; END IF;
  IF t IN ('NAD', 'LSL', 'SZL') THEN t := 'ZAR'; END IF;
  IF f IS NULL OR t IS NULL THEN RETURN NULL; END IF;
  IF f = t THEN RETURN 1; END IF;
  a := CASE WHEN f = 'EUR' THEN 1 ELSE coalesce(
         (SELECT per_eur FROM fx_rates WHERE currency = f AND day <= d ORDER BY day DESC LIMIT 1),
         (SELECT per_eur FROM fx_rates WHERE currency = f ORDER BY day LIMIT 1)) END;
  b := CASE WHEN t = 'EUR' THEN 1 ELSE coalesce(
         (SELECT per_eur FROM fx_rates WHERE currency = t AND day <= d ORDER BY day DESC LIMIT 1),
         (SELECT per_eur FROM fx_rates WHERE currency = t ORDER BY day LIMIT 1)) END;
  IF a IS NULL OR b IS NULL THEN RETURN NULL; END IF;
  RETURN round(b / a, 8);
END $$;
GRANT EXECUTE ON FUNCTION public.fx_rate(text, text, date) TO authenticated;

-- ── 2. Rate on quotes too; 'daily' allowed as a source ───────────────────────
ALTER TABLE public.commercial_quotes ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8);
ALTER TABLE public.commercial_quotes ADD COLUMN IF NOT EXISTS rate_source text;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_invoices', 'credit_notes', 'purchase_orders', 'supplier_invoices', 'commercial_quotes'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_rate_source_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (rate_source IN (''xero'', ''manual'', ''daily''))', t, t || '_rate_source_check');
  END LOOP;
END $$;

-- ── 3. Fill the rate when a document is saved ────────────────────────────────
-- Runs after trg_doc_currency (triggers fire in name order), so the currency is already set.
CREATE OR REPLACE FUNCTION public._trg_doc_rate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_home text; v_day date; j jsonb;
BEGIN
  v_home := public.company_home_currency(NEW.company_id);
  IF NEW.currency IS NULL OR upper(NEW.currency) = v_home THEN
    NEW.exchange_rate := NULL; NEW.rate_source := NULL; RETURN NEW;
  END IF;
  -- Currency changed without a new rate: the old rate no longer applies.
  IF TG_OP = 'UPDATE' AND NEW.currency IS DISTINCT FROM OLD.currency AND NEW.exchange_rate IS NOT DISTINCT FROM OLD.exchange_rate THEN
    NEW.rate_source := NULL;
  END IF;
  IF NEW.rate_source IN ('manual', 'xero', 'daily') AND NEW.exchange_rate > 0 THEN RETURN NEW; END IF;
  j := to_jsonb(NEW);
  v_day := coalesce((j ->> 'issue_date')::date, (j ->> 'order_date')::date, (j ->> 'invoice_date')::date,
                    (j ->> 'created_at')::date, current_date);
  NEW.exchange_rate := public.fx_rate(NEW.currency, v_home, v_day);
  NEW.rate_source := CASE WHEN NEW.exchange_rate IS NULL THEN NULL ELSE 'daily' END;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_invoices', 'credit_notes', 'purchase_orders', 'supplier_invoices', 'commercial_quotes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_doc_rate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_doc_rate BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_doc_rate()', t);
  END LOOP;
END $$;

-- Non-rand documents still without a rate get one (called after each daily rate load).
CREATE OR REPLACE FUNCTION public.fx_fill_missing() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t text; n int; total int := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_invoices', 'credit_notes', 'purchase_orders', 'supplier_invoices', 'commercial_quotes'] LOOP
    EXECUTE format('UPDATE public.%I SET rate_source = NULL WHERE exchange_rate IS NULL AND currency IS NOT NULL
                      AND upper(currency) <> public.company_home_currency(company_id)', t);
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
  END LOOP;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.fx_fill_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_fill_missing() TO service_role;

-- Test data: Ironvale's EUR invoice kept a rate against the Xero Demo Company's US dollar, not the rand.
UPDATE public.finance_invoices SET exchange_rate = NULL, rate_source = NULL
WHERE company_id = 'ac99a73d-3768-4191-b8c3-550802d1ae26' AND rate_source = 'xero';

-- ── 4. Totals in rand ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public._fx_function_backup (fn text PRIMARY KEY, def text NOT NULL, saved_at timestamptz DEFAULT now());
ALTER TABLE public._fx_function_backup ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fx_restore_functions() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT def FROM public._fx_function_backup LOOP EXECUTE r.def; END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fx_restore_functions() FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE
  f record; d text; i int;
  X  constant text := ' * coalesce(exchange_rate, 1)';
  NL constant text := chr(10);
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.money_overview(uuid,date,date)', ARRAY[
      'coalesce(sum(subtotal), 0) sub, coalesce(sum(vat_amount), 0) vat, count(*) n',
      'coalesce(sum(subtotal' || X || '), 0) sub, coalesce(sum(vat_amount' || X || '), 0) vat, count(*) n',
      'coalesce(sum(subtotal), 0) sub, coalesce(sum(vat_amount), 0) vat, coalesce(sum(refund_amount), 0) refunded',
      'coalesce(sum(subtotal' || X || '), 0) sub, coalesce(sum(vat_amount' || X || '), 0) vat, coalesce(sum(refund_amount' || X || '), 0) refunded',
      'SELECT s.*, coalesce(c.name, ''Unknown supplier'') sname',
      'SELECT s.supplier_id, s.status, s.approval_status, s.due_date, s.paid_at, s.created_at,'
        || ' s.balance_due * coalesce(s.exchange_rate, 1) balance_due, s.amount_paid * coalesce(s.exchange_rate, 1) amount_paid,'
        || ' s.subtotal * coalesce(s.exchange_rate, 1) subtotal, s.vat_amount * coalesce(s.exchange_rate, 1) vat_amount,'
        || ' coalesce(c.name, ''Unknown supplier'') sname',
      'SELECT i.client_id, i.balance_due bal,',
      'SELECT i.client_id, i.balance_due * coalesce(i.exchange_rate, 1) bal,',
      'SELECT i.client_id, t.transaction_date, t.total_amount' || NL,
      'SELECT i.client_id, t.transaction_date, t.total_amount * coalesce(i.exchange_rate, 1) total_amount' || NL,
      'SELECT * FROM public.commercial_quotes',
      'SELECT id, status, subtotal' || X || ' subtotal FROM public.commercial_quotes',
      'SELECT DISTINCT ON (i.quote_id) i.quote_id, i.subtotal, i.status',
      'SELECT DISTINCT ON (i.quote_id) i.quote_id, i.subtotal * coalesce(i.exchange_rate, 1) subtotal, i.status',
      '(SELECT sum(t.total_amount) FROM public.finance_transactions t WHERE',
      '(SELECT sum(t.total_amount * coalesce((SELECT fi.exchange_rate FROM public.finance_invoices fi WHERE fi.id = t.source_id AND t.source_table = ''finance_invoices''), 1)) FROM public.finance_transactions t WHERE',
      '(SELECT sum(amount_paid) FROM public.supplier_invoices WHERE',
      '(SELECT sum(amount_paid' || X || ') FROM public.supplier_invoices WHERE'
    ]),
    ('public._ins_money(uuid,date,date,boolean)', ARRAY[
      '''quotes_sent_value'', (SELECT coalesce(sum(total_amount), 0) FROM q',
      '''quotes_sent_value'', (SELECT coalesce(sum(total_amount' || X || '), 0) FROM q',
      '''quotes_won_value'', (SELECT coalesce(sum(total_amount), 0) FROM q',
      '''quotes_won_value'', (SELECT coalesce(sum(total_amount' || X || '), 0) FROM q',
      '''invoiced'', (SELECT coalesce(sum(total_amount), 0) FROM inv)',
      '''invoiced'', (SELECT coalesce(sum(total_amount' || X || '), 0) FROM inv)',
      '''collected'', (SELECT coalesce(sum(amount), 0) FROM finance_transactions WHERE',
      '''collected'', (SELECT coalesce(sum(amount * coalesce((SELECT fi.exchange_rate FROM finance_invoices fi WHERE fi.id = finance_transactions.source_id), 1)), 0) FROM finance_transactions WHERE',
      '::date m, total_amount i, 0 c, 0 w FROM finance_invoices',
      '::date m, total_amount' || X || ' i, 0 c, 0 w FROM finance_invoices',
      '0, amount, 0 FROM finance_transactions',
      '0, amount * coalesce((SELECT fi.exchange_rate FROM finance_invoices fi WHERE fi.id = finance_transactions.source_id), 1), 0 FROM finance_transactions',
      '0, 0, total_amount FROM commercial_quotes',
      '0, 0, total_amount' || X || ' FROM commercial_quotes',
      'round(sum(i.total_amount), 2) invoiced',
      'round(sum(i.total_amount * coalesce(i.exchange_rate, 1)), 2) invoiced',
      'round(sum(i.amount_paid), 2) paid',
      'round(sum(i.amount_paid * coalesce(i.exchange_rate, 1)), 2) paid',
      'round(sum(total_amount), 2) qv FROM commercial_quotes',
      'round(sum(total_amount' || X || '), 2) qv FROM commercial_quotes'
    ]),
    ('public.insights_money(uuid,date,date)', ARRAY[
      '''pipeline_now'', (SELECT coalesce(sum(total_amount), 0) FROM commercial_quotes',
      '''pipeline_now'', (SELECT coalesce(sum(total_amount' || X || '), 0) FROM commercial_quotes'
    ]),
    ('public._ins_ageing(uuid)', ARRAY[
      'i.balance_due b,',
      'i.balance_due * coalesce(i.exchange_rate, 1) b,'
    ]),
    ('public.hr_get_clients_snapshot(uuid,date,date)', ARRAY[
      'SELECT coalesce(SUM(balance_due), 0) FROM public.finance_invoices',
      'SELECT coalesce(SUM(balance_due' || X || '), 0) FROM public.finance_invoices',
      'SELECT SUM(fi.balance_due) FROM public.finance_invoices fi',
      'SELECT SUM(fi.balance_due * coalesce(fi.exchange_rate, 1)) FROM public.finance_invoices fi'
    ]),
    ('public.hr_get_projects_snapshot(uuid,date,date)', ARRAY[
      'SELECT coalesce(SUM(balance_due), 0) FROM public.finance_invoices',
      'SELECT coalesce(SUM(balance_due' || X || '), 0) FROM public.finance_invoices'
    ]),
    ('public.hr_get_financial_snapshot(uuid,date,date)', ARRAY[
      'SELECT COALESCE(SUM(total_amount), 0) INTO v_revenue',
      'SELECT COALESCE(SUM(total_amount' || X || '), 0) INTO v_revenue',
      'SELECT COALESCE(SUM(balance_due), 0) INTO v_outstanding',
      'SELECT COALESCE(SUM(balance_due' || X || '), 0) INTO v_outstanding',
      'SELECT COALESCE(SUM(balance_due), 0) INTO v_payables',
      'SELECT COALESCE(SUM(balance_due' || X || '), 0) INTO v_payables',
      'SELECT SUM(total_amount) FROM supplier_invoices',
      'SELECT SUM(total_amount' || X || ') FROM supplier_invoices',
      'SUM(total_amount) AS value,',
      'SUM(total_amount' || X || ') AS value,',
      ' || '' Exp'',' || NL || '               SUM(total_amount),',
      ' || '' Exp'',' || NL || '               SUM(total_amount' || X || '),'
    ]),
    ('public.sync_project_costs(uuid)', ARRAY[
      'COALESCE(SUM(total_amount), 0)',
      'COALESCE(SUM(total_amount' || X || '), 0)'
    ])
  ) v(fn, p) LOOP
    d := pg_get_functiondef(f.fn::regprocedure);
    INSERT INTO public._fx_function_backup (fn, def) VALUES (f.fn, d) ON CONFLICT (fn) DO NOTHING;
    FOR i IN 1 .. array_length(f.p, 1) BY 2 LOOP
      IF position(f.p[i] IN d) = 0 THEN RAISE EXCEPTION 'Totals update stopped: text not found in % — %', f.fn, f.p[i]; END IF;
      d := replace(d, f.p[i], f.p[i + 1]);
    END LOOP;
    EXECUTE d;
  END LOOP;
END $patch$;

-- ── 5. Daily rate load at 16:20 UTC (the ECB publishes around 16:00 CET) ─────
CREATE OR REPLACE FUNCTION public.fx_rates_kick() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'xero_sync_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/fx-rates-daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-xero-sync-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION public.fx_rates_kick() FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule('fx-rates-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fx-rates-daily');
SELECT cron.schedule('fx-rates-daily', '20 16 * * *', 'SELECT public.fx_rates_kick();');
-- First load straight away (history from 2024).
SELECT public.fx_rates_kick();
