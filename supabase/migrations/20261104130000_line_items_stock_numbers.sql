-- Quotes and invoices: where each line came from, stock out on sent invoices, short document numbers.
--
-- 1. Lines remember their source: a job service, a catalogue item, an inventory item, or the user's own line.
-- 2. Inventory lines leave stock when the invoice is issued (sent), and go back if it is voided or cancelled.
--    Drafts and quotes never touch stock. Each line records how much it took (stock_taken), so nothing is
--    taken or returned twice.
-- 3. New invoice and quote numbers are short and keep counting: INV0118, QU0043. Numbers already issued
--    never change.

-- 1. Line sources ---------------------------------------------------------------------------------------
ALTER TABLE public.finance_invoice_lines
  ADD COLUMN IF NOT EXISTS item_type text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS stock_taken numeric;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_invoice_lines_item_type_check') THEN
    ALTER TABLE public.finance_invoice_lines ADD CONSTRAINT finance_invoice_lines_item_type_check
      CHECK (item_type IS NULL OR item_type IN ('service', 'catalogue', 'inventory', 'custom'));
  END IF;
END $$;

ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS job_service_id uuid REFERENCES public.job_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

-- 2. Stock -----------------------------------------------------------------------------------------------
-- Take stock for every inventory line of an issued invoice that has not taken it yet.
CREATE OR REPLACE FUNCTION public._invoice_take_stock(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; l record; v_before numeric; v_after numeric; v_cost numeric;
BEGIN
  SELECT id, company_id, status, invoice_number INTO inv FROM public.finance_invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL OR inv.status IN ('draft', 'cancelled', 'voided') THEN RETURN; END IF;
  PERFORM set_config('kaisync.allow_stock_update', 'on', true);
  FOR l IN
    SELECT id, source_id, quantity FROM public.finance_invoice_lines
     WHERE invoice_id = inv.id AND company_id = inv.company_id AND item_type = 'inventory'
       AND source_id IS NOT NULL AND stock_taken IS NULL AND coalesce(quantity, 0) > 0
     FOR UPDATE
  LOOP
    UPDATE public.inventory_items SET quantity_on_hand = coalesce(quantity_on_hand, 0) - l.quantity
     WHERE id = l.source_id AND company_id = inv.company_id
     RETURNING quantity_on_hand + l.quantity, quantity_on_hand, unit_cost INTO v_before, v_after, v_cost;
    IF FOUND THEN
      INSERT INTO public.inventory_stock_movements (company_id, item_id, movement_type, quantity, quantity_before, quantity_after, note, unit_cost)
      VALUES (inv.company_id, l.source_id, 'adjust', -l.quantity, v_before, v_after,
              'Invoice ' || coalesce(inv.invoice_number, ''), v_cost);
    END IF;
    UPDATE public.finance_invoice_lines SET stock_taken = l.quantity WHERE id = l.id;
  END LOOP;
END $$;

-- Put stock back for an invoice that was voided or cancelled after it was issued.
CREATE OR REPLACE FUNCTION public._invoice_return_stock(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; l record; v_before numeric; v_after numeric; v_cost numeric;
BEGIN
  SELECT id, company_id, invoice_number INTO inv FROM public.finance_invoices WHERE id = p_invoice_id;
  IF inv.id IS NULL THEN RETURN; END IF;
  PERFORM set_config('kaisync.allow_stock_update', 'on', true);
  FOR l IN
    SELECT id, source_id, stock_taken FROM public.finance_invoice_lines
     WHERE invoice_id = inv.id AND company_id = inv.company_id AND coalesce(stock_taken, 0) > 0 AND source_id IS NOT NULL
     FOR UPDATE
  LOOP
    UPDATE public.inventory_items SET quantity_on_hand = coalesce(quantity_on_hand, 0) + l.stock_taken
     WHERE id = l.source_id AND company_id = inv.company_id
     RETURNING quantity_on_hand - l.stock_taken, quantity_on_hand, unit_cost INTO v_before, v_after, v_cost;
    IF FOUND THEN
      INSERT INTO public.inventory_stock_movements (company_id, item_id, movement_type, quantity, quantity_before, quantity_after, note, unit_cost)
      VALUES (inv.company_id, l.source_id, 'return', l.stock_taken, v_before, v_after,
              'Invoice ' || coalesce(inv.invoice_number, '') || ' voided', v_cost);
    END IF;
    UPDATE public.finance_invoice_lines SET stock_taken = 0 WHERE id = l.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._trg_invoice_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'voided') THEN
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('cancelled', 'voided') THEN
      PERFORM public._invoice_return_stock(NEW.id);
    END IF;
  ELSIF NEW.status <> 'draft' THEN
    PERFORM public._invoice_take_stock(NEW.id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER invoice_stock
AFTER INSERT OR UPDATE OF status ON public.finance_invoices
FOR EACH ROW EXECUTE FUNCTION public._trg_invoice_stock();

-- Lines added to an invoice that is already issued (the app saves the invoice, then its lines).
CREATE OR REPLACE FUNCTION public._trg_invoice_line_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.item_type = 'inventory' AND NEW.stock_taken IS NULL THEN
    PERFORM public._invoice_take_stock(NEW.invoice_id);
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER invoice_line_stock
AFTER INSERT ON public.finance_invoice_lines
FOR EACH ROW EXECUTE FUNCTION public._trg_invoice_line_stock();

REVOKE ALL ON FUNCTION public._invoice_take_stock(uuid), public._invoice_return_stock(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Short numbers -----------------------------------------------------------------------------------------
-- Highest number already used, old style (INV-2026-0116, QT-2026-0042) or new (INV0118, QU0043).
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
  SELECT upper(coalesce(nullif(trim(c.code), ''), 'JOB')) INTO v_prefix FROM public.companies c WHERE c.id = p_company_id;
  RETURN coalesce(v_prefix, 'JOB') || '-J' || lpad(v_n::text, 4, '0');
END $$;
