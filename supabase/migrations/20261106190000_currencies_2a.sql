-- Currencies, part 2A (approved by Nyarie, 6 Nov 2026).
-- * Every client and supplier/contractor can have a currency (blank = the company's own currency).
-- * New quotes, invoices, credit notes, purchase orders and supplier invoices take that currency automatically,
--   however they are created (screens, quote → invoice, recurring, imports).
-- * Foreign-currency documents carry an exchange rate: 1 unit of the document's currency = exchange_rate in the
--   company's currency. rate_source 'xero' = the rate Xero used (filled in after sending); 'manual' = typed in by
--   the owner (and then sent to Xero).
-- * Statements and balances stay in the client's currency; company totals in rand come in part 2B.
-- Additive only. Rollback: drop trigger trg_doc_currency on each table; the new columns can stay.

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');
ALTER TABLE public.supplier_invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ZAR';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_invoices', 'credit_notes', 'purchase_orders', 'supplier_invoices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,8) CHECK (exchange_rate IS NULL OR exchange_rate > 0)', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS rate_source text CHECK (rate_source IN (''xero'', ''manual''))', t);
  END LOOP;
END $$;

-- The company's own currency (Settings → General), ZAR when not set.
CREATE OR REPLACE FUNCTION public.company_home_currency(p_company_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT nullif(upper(trim(cs.currency)), '') FROM public.company_settings cs WHERE cs.company_id = p_company_id LIMIT 1), 'ZAR')
$$;

-- New documents take their client's / supplier's currency when they were left on the company currency.
CREATE OR REPLACE FUNCTION public._trg_doc_currency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_party text; v_home text;
BEGIN
  IF TG_TABLE_NAME IN ('finance_invoices', 'credit_notes', 'commercial_quotes') THEN
    IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
    SELECT c.currency INTO v_party FROM public.clients c WHERE c.id = NEW.client_id;
  ELSE
    IF NEW.supplier_id IS NULL THEN RETURN NEW; END IF;
    SELECT c.currency INTO v_party FROM public.contractors c WHERE c.id = NEW.supplier_id;
  END IF;
  v_home := public.company_home_currency(NEW.company_id);
  IF v_party IS NOT NULL AND (NEW.currency IS NULL OR upper(NEW.currency) = v_home) THEN
    NEW.currency := v_party;
  END IF;
  NEW.currency := upper(coalesce(NEW.currency, v_home));
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_invoices', 'credit_notes', 'commercial_quotes', 'purchase_orders', 'supplier_invoices'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_doc_currency ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_doc_currency BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public._trg_doc_currency()', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public._trg_doc_currency() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.company_home_currency(uuid) TO authenticated;
