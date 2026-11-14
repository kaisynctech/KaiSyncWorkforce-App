-- One item list (piece 6b). Products & stock (quote_catalogue_items) is the one list people see and edit;
-- inventory_items stays the stock count that purchase orders, deliveries, jobs, farms and invoices already move.
-- Every stock item is linked to exactly one product (inventory_items.catalogue_item_id, which already existed but
-- was never filled). Anything missing on either side is created (decided 13 Nov 2026), now and from now on.

-- 1. The link: one stock record per product, cleared if the product is deleted.
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_catalogue_item_id_fkey;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_catalogue_item_id_fkey
  FOREIGN KEY (catalogue_item_id) REFERENCES public.quote_catalogue_items(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_one_per_catalogue_item
  ON public.inventory_items (catalogue_item_id) WHERE catalogue_item_id IS NOT NULL;

-- 2. How a business uses a stocked item (board M). Empty for services, labour and fees.
ALTER TABLE public.quote_catalogue_items ADD COLUMN IF NOT EXISTS item_use text;
ALTER TABLE public.quote_catalogue_items DROP CONSTRAINT IF EXISTS quote_catalogue_items_item_use_check;
ALTER TABLE public.quote_catalogue_items ADD CONSTRAINT quote_catalogue_items_item_use_check
  CHECK (item_use IS NULL OR item_use IN ('sell', 'use_up', 'hire', 'make'));

-- 3. A product that is stocked gets its stock record (created if missing). Returns the stock item id.
CREATE OR REPLACE FUNCTION public._catalogue_stock_item(p_catalogue_item_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.quote_catalogue_items%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO q FROM public.quote_catalogue_items WHERE id = p_catalogue_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.inventory_items WHERE catalogue_item_id = q.id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.inventory_items (company_id, name, sku, description, unit_of_measure, unit_cost, selling_price,
    quantity_on_hand, reorder_level, is_active, catalogue_item_id)
  VALUES (q.company_id, q.name, q.sku, q.description, coalesce(nullif(q.unit_of_measure, ''), 'each'),
    coalesce(q.cost_price, 0), coalesce(q.sell_price, 0), greatest(coalesce(q.qty_on_hand, 0), 0),
    coalesce(q.reorder_point, 0), q.is_active, q.id)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._catalogue_stock_item(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Products → stock: a stocked product always has its stock record, and its details follow the product.
CREATE OR REPLACE FUNCTION public._trg_catalogue_to_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;  -- the change came from the stock side
  IF NEW.is_stockable THEN
    PERFORM public._catalogue_stock_item(NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.inventory_items SET name = NEW.name, sku = NEW.sku, description = NEW.description,
      unit_of_measure = coalesce(nullif(NEW.unit_of_measure, ''), 'each'), unit_cost = coalesce(NEW.cost_price, 0),
      selling_price = coalesce(NEW.sell_price, 0), reorder_level = coalesce(NEW.reorder_point, 0), is_active = NEW.is_active
    WHERE catalogue_item_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_catalogue_to_stock ON public.quote_catalogue_items;
CREATE TRIGGER trg_catalogue_to_stock AFTER INSERT OR UPDATE ON public.quote_catalogue_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_catalogue_to_stock();

-- 5. Products keep the stock count the stock record has (the stock record is the count everything moves).
--    A direct change to a linked product's count is ignored; counts change through Adjust stock / deliveries / jobs.
CREATE OR REPLACE FUNCTION public._trg_catalogue_keep_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.qty_on_hand IS DISTINCT FROM OLD.qty_on_hand
     AND coalesce(current_setting('kaisync.mirror_stock', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.inventory_items WHERE catalogue_item_id = NEW.id) THEN
    NEW.qty_on_hand := OLD.qty_on_hand;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_catalogue_keep_count ON public.quote_catalogue_items;
CREATE TRIGGER trg_catalogue_keep_count BEFORE UPDATE OF qty_on_hand ON public.quote_catalogue_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_catalogue_keep_count();

-- 6. Stock → products: a stock item made anywhere (supplier page, farm, older screens) gets its product;
--    count and details changes show on the product.
CREATE OR REPLACE FUNCTION public._trg_stock_to_catalogue()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cat uuid;
BEGIN
  IF pg_trigger_depth() > 1 AND TG_OP = 'UPDATE' AND NEW.quantity_on_hand IS NOT DISTINCT FROM OLD.quantity_on_hand THEN
    RETURN NULL;  -- details came from the product side
  END IF;
  IF NEW.catalogue_item_id IS NULL THEN
    INSERT INTO public.quote_catalogue_items (company_id, name, sku, description, unit, unit_of_measure, item_type,
      cost_price, sell_price, is_active, is_stockable, item_use, qty_on_hand, reorder_point)
    VALUES (NEW.company_id, NEW.name, NEW.sku, NEW.description, coalesce(nullif(NEW.unit_of_measure, ''), 'each'),
      coalesce(nullif(NEW.unit_of_measure, ''), 'each'), 'part', coalesce(NEW.unit_cost, 0), coalesce(NEW.selling_price, 0),
      NEW.is_active, true, 'sell', coalesce(NEW.quantity_on_hand, 0), nullif(NEW.reorder_level, 0))
    RETURNING id INTO v_cat;
    UPDATE public.inventory_items SET catalogue_item_id = v_cat WHERE id = NEW.id;
    RETURN NULL;
  END IF;
  PERFORM set_config('kaisync.mirror_stock', 'on', true);
  IF pg_trigger_depth() > 1 THEN
    UPDATE public.quote_catalogue_items SET qty_on_hand = coalesce(NEW.quantity_on_hand, 0)
    WHERE id = NEW.catalogue_item_id;
  ELSE
    UPDATE public.quote_catalogue_items SET qty_on_hand = coalesce(NEW.quantity_on_hand, 0), name = NEW.name,
      sku = NEW.sku, description = NEW.description, cost_price = coalesce(NEW.unit_cost, 0),
      sell_price = coalesce(NEW.selling_price, 0), is_active = NEW.is_active, is_stockable = true, updated_at = now()
    WHERE id = NEW.catalogue_item_id;
  END IF;
  PERFORM set_config('kaisync.mirror_stock', 'off', true);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_stock_to_catalogue ON public.inventory_items;
CREATE TRIGGER trg_stock_to_catalogue AFTER INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_stock_to_catalogue();

-- 7. "Adjust stock" on Products & stock now moves the one stock count (with its history) for linked products.
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(p_company_id uuid, p_catalogue_item_id uuid, p_adjusted_by uuid,
  p_adjustment_type text, p_qty_change numeric, p_notes text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_qty_before    numeric(12,3);
  v_qty_after     numeric(12,3);
  v_is_stockable  boolean;
  v_adj_id        uuid;
  v_stock         uuid;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'catalogue.edit');

  IF p_adjusted_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_adjusted_by AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'ADJUSTED_BY_NOT_IN_COMPANY';
  END IF;

  SELECT qty_on_hand, is_stockable INTO v_qty_before, v_is_stockable
  FROM public.quote_catalogue_items WHERE id = p_catalogue_item_id AND company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF NOT v_is_stockable THEN RAISE EXCEPTION 'Item is not stockable'; END IF;

  v_qty_after := v_qty_before + p_qty_change;
  IF v_qty_after < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'Stock would go negative (current: %, change: %)', v_qty_before, p_qty_change;
  END IF;

  INSERT INTO public.stock_adjustments (company_id, catalogue_item_id, adjusted_by, adjustment_type, qty_change,
    qty_before, qty_after, reference_type, reference_id, notes)
  VALUES (p_company_id, p_catalogue_item_id, p_adjusted_by, p_adjustment_type, p_qty_change, v_qty_before, v_qty_after,
    p_reference_type, p_reference_id, p_notes)
  RETURNING id INTO v_adj_id;

  v_stock := public._catalogue_stock_item(p_catalogue_item_id);
  IF v_stock IS NOT NULL AND p_qty_change <> 0 THEN
    -- The stock count moves (and writes its own history); the product follows through the trigger.
    PERFORM public.hr_inventory_stock_movement(p_company_id, v_stock, 'adjust', p_qty_change, p_adjusted_by, NULL,
      coalesce(nullif(trim(p_notes), ''), 'Stock adjusted on Products & stock'), NULL);
  ELSE
    PERFORM set_config('kaisync.mirror_stock', 'on', true);
    UPDATE public.quote_catalogue_items SET qty_on_hand = v_qty_after WHERE id = p_catalogue_item_id;
    PERFORM set_config('kaisync.mirror_stock', 'off', true);
  END IF;

  RETURN jsonb_build_object('adjustment_id', v_adj_id, 'qty_before', v_qty_before, 'qty_after', v_qty_after,
    'qty_change', p_qty_change);
END $function$;

-- 8. Create what's missing today (live check 13 Nov 2026: only Ironvale and the test company have items).
--    Stocked products without a stock record get one, starting at the product's count; stock items without a
--    product get one, with the stock count. Existing counts are kept.
UPDATE public.quote_catalogue_items SET item_use = 'sell'
  WHERE is_stockable AND item_use IS NULL;
SELECT public._catalogue_stock_item(q.id)
  FROM public.quote_catalogue_items q
  WHERE q.is_stockable AND NOT EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.catalogue_item_id = q.id);
UPDATE public.inventory_items SET is_active = is_active   -- fires step 6 for stock items with no product yet
  WHERE catalogue_item_id IS NULL;

-- Check: every stocked product linked, every stock item linked, counts equal.
SELECT
  (SELECT count(*) FROM public.quote_catalogue_items q WHERE q.is_stockable
     AND NOT EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.catalogue_item_id = q.id)) AS products_without_stock,
  (SELECT count(*) FROM public.inventory_items WHERE catalogue_item_id IS NULL) AS stock_without_product,
  (SELECT count(*) FROM public.inventory_items i JOIN public.quote_catalogue_items q ON q.id = i.catalogue_item_id
     WHERE q.qty_on_hand <> i.quantity_on_hand) AS counts_different;
