-- ============================================================
-- KaiSync — Item Variants
-- 2026-08-12
--
-- Allows one part (same name + SKU) to exist in multiple
-- brand / condition combinations, each with its own stock.
--
-- Design:
--   Each variant = its own row in quote_catalogue_items.
--   All variants in a group share the same variant_group_id.
--   One row per group is flagged is_variant_primary = true
--   (the original/master row — used as display anchor).
--
-- Nothing breaks for non-variant items:
--   variant_group_id IS NULL  →  standalone item, no variants
--   is_variant_primary = true (default) for all existing rows
-- ============================================================


-- ============================================================
-- 1. ADD is_variant_primary TO quote_catalogue_items
-- ============================================================
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS is_variant_primary boolean NOT NULL DEFAULT true;


-- ============================================================
-- 2. INDEXES
-- ============================================================

-- Fast lookup of all variants in a group
CREATE INDEX IF NOT EXISTS idx_catalogue_variant_group
  ON public.quote_catalogue_items (company_id, variant_group_id)
  WHERE variant_group_id IS NOT NULL;

-- Fast lookup of all rows sharing a SKU (used by quote builder)
-- (idx_catalogue_sku already exists from migration 000100 — no duplicate)


-- ============================================================
-- 3. RPC: get_variant_group
--    Returns all items in the same variant group as p_item_id.
--    If the item has no variant_group_id, returns just that item.
--    Used by the quote builder to show the variant picker.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_variant_group(
  p_company_id uuid,
  p_item_id    uuid
)
RETURNS TABLE (
  id                uuid,
  name              text,
  sku               text,
  brand             text,
  condition_id      uuid,
  condition_name    text,
  item_type         text,
  unit_of_measure   text,
  sell_price        numeric,
  cost_price        numeric,
  qty_on_hand       numeric,
  qty_available     numeric,
  is_stockable      boolean,
  is_variant_primary boolean,
  variant_group_id  uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH source AS (
    SELECT variant_group_id
    FROM public.quote_catalogue_items
    WHERE id = p_item_id
      AND company_id = p_company_id
  )
  SELECT
    q.id,
    q.name,
    q.sku,
    q.brand,
    q.condition_id,
    cc.name           AS condition_name,
    q.item_type,
    q.unit_of_measure,
    q.sell_price,
    q.cost_price,
    q.qty_on_hand,
    GREATEST(q.qty_on_hand - q.qty_reserved, 0) AS qty_available,
    q.is_stockable,
    q.is_variant_primary,
    q.variant_group_id
  FROM public.quote_catalogue_items q
  LEFT JOIN public.catalogue_conditions cc ON cc.id = q.condition_id
  WHERE q.company_id = p_company_id
    AND q.is_active = true
    AND (
      -- either same variant group
      (q.variant_group_id IS NOT NULL
        AND q.variant_group_id = (SELECT variant_group_id FROM source))
      -- or the item itself when it has no group
      OR (q.id = p_item_id AND (SELECT variant_group_id FROM source) IS NULL)
    )
  ORDER BY q.is_variant_primary DESC, q.brand NULLS LAST, q.created_at;
$$;


-- ============================================================
-- 4. RPC: add_item_variant
--    Clones an existing item as a new variant with a different
--    brand / condition. Assigns variant_group_id (generating
--    one if the source item doesn't have one yet, and marking
--    the source as the primary).
--
--    Returns the new variant's id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_item_variant(
  p_company_id    uuid,
  p_source_id     uuid,   -- existing catalogue item to clone from
  p_brand         text    DEFAULT NULL,
  p_condition_id  uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source          public.quote_catalogue_items%ROWTYPE;
  v_group_id        uuid;
  v_new_id          uuid;
BEGIN
  -- Fetch and lock source
  SELECT * INTO v_source
  FROM public.quote_catalogue_items
  WHERE id = p_source_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source item not found';
  END IF;

  -- Resolve or create variant_group_id
  IF v_source.variant_group_id IS NOT NULL THEN
    v_group_id := v_source.variant_group_id;
  ELSE
    v_group_id := gen_random_uuid();
    -- Mark source as primary of this new group
    UPDATE public.quote_catalogue_items
    SET variant_group_id    = v_group_id,
        is_variant_primary  = true
    WHERE id = p_source_id;
  END IF;

  -- Ensure source is marked primary (idempotent)
  UPDATE public.quote_catalogue_items
  SET is_variant_primary = true
  WHERE id = p_source_id
    AND is_variant_primary = false;

  -- Clone source into new variant row
  INSERT INTO public.quote_catalogue_items (
    company_id,
    name,
    description,
    sku,
    item_type,
    unit_of_measure,
    brand,
    condition_id,
    sell_price,
    cost_price,
    is_stockable,
    qty_on_hand,
    qty_on_order,
    qty_reserved,
    reorder_point,
    reorder_qty,
    bin_location,
    branch_id,
    internal_notes,
    is_active,
    variant_group_id,
    is_variant_primary
  ) VALUES (
    p_company_id,
    v_source.name,
    v_source.description,
    v_source.sku,
    v_source.item_type,
    v_source.unit_of_measure,
    COALESCE(p_brand, v_source.brand),
    COALESCE(p_condition_id, v_source.condition_id),
    v_source.sell_price,
    v_source.cost_price,
    v_source.is_stockable,
    0,   -- new variant starts at zero stock
    0,
    0,
    v_source.reorder_point,
    v_source.reorder_qty,
    v_source.bin_location,
    v_source.branch_id,
    v_source.internal_notes,
    true,
    v_group_id,
    false   -- new variants are never primary
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
