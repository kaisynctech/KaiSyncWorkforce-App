-- ============================================================
-- KaiSync — Inventory & Services Unified Catalogue
-- 2026-08-12
--
-- Extends quote_catalogue_items into a unified item master:
-- parts, services, materials, labour — all in one place.
--
-- New tables:
--   catalogue_conditions      — fixed + custom condition list
--   catalogue_item_aliases    — alternative part numbers / names
--   catalogue_item_suppliers  — multiple suppliers per item
-- ============================================================

-- ============================================================
-- STEP 0: Read existing quote_catalogue_items columns first
-- (Claude Code: run SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'quote_catalogue_items' before applying
--  to avoid adding duplicate columns)
-- ============================================================


-- ============================================================
-- 1. CATALOGUE_CONDITIONS
--    Pre-seeded standard conditions (company_id IS NULL = global)
--    Companies can add their own (company_id = their id)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.catalogue_conditions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  is_standard  boolean     NOT NULL DEFAULT false,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_condition_per_company UNIQUE (company_id, name)
);

-- Global/standard conditions have company_id IS NULL
-- Allow only one NULL company per name for standards
CREATE UNIQUE INDEX IF NOT EXISTS uq_standard_condition_name
  ON public.catalogue_conditions (lower(name))
  WHERE company_id IS NULL;

-- RLS
ALTER TABLE public.catalogue_conditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_conditions" ON public.catalogue_conditions
  FOR SELECT USING (
    company_id IS NULL                              -- global standards
    OR company_id = ANY(public.user_company_ids())  -- own custom conditions
  );

CREATE POLICY "manage_conditions" ON public.catalogue_conditions
  FOR ALL USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));

-- Seed standard conditions (global — company_id IS NULL)
INSERT INTO public.catalogue_conditions (company_id, name, is_standard, sort_order) VALUES
  (NULL, 'New',                     true,  1),
  (NULL, 'Used – Good',             true,  2),
  (NULL, 'Used – Fair',             true,  3),
  (NULL, 'Refurbished',             true,  4),
  (NULL, 'Reconditioned',           true,  5),
  (NULL, 'Remanufactured',          true,  6),
  (NULL, 'Aftermarket (Non-OEM)',   true,  7),
  (NULL, 'OEM (Original)',          true,  8),
  (NULL, 'Exchange / Core',         true,  9),
  (NULL, 'New Old Stock (NOS)',      true, 10),
  (NULL, 'Surplus',                 true, 11),
  (NULL, 'Damaged – For Parts Only',true, 12)
ON CONFLICT DO NOTHING;


-- ============================================================
-- 2. EXTEND quote_catalogue_items
--    Add all new columns with IF NOT EXISTS guards
-- ============================================================

-- Item classification
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS item_type      text        NOT NULL DEFAULT 'service'
    CHECK (item_type IN ('part','service','material','labour'));

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS sku            text;          -- primary part number / service code

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS brand          text;          -- normalized, stored via RPC

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS condition_id   uuid
    REFERENCES public.catalogue_conditions(id) ON DELETE SET NULL;

-- Variant grouping — links related brand/condition variants of same base item
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS variant_group_id uuid;        -- shared uuid groups variants together

-- Unit of measure (comprehensive fixed list enforced in UI)
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS unit_of_measure text NOT NULL DEFAULT 'each';

-- Stock tracking (populated for parts and materials only)
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS is_stockable   boolean     NOT NULL DEFAULT false;

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS qty_on_hand    numeric(12,3) NOT NULL DEFAULT 0;

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS qty_on_order   numeric(12,3) NOT NULL DEFAULT 0;

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS qty_reserved   numeric(12,3) NOT NULL DEFAULT 0;

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS reorder_point  numeric(12,3);

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS reorder_qty    numeric(12,3);

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS bin_location   text;

-- Branch (nullable = company-wide; future branches phase will wire this up)
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS branch_id      uuid;          -- no FK yet; branches table TBD

-- Lifecycle
ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS is_active      boolean     NOT NULL DEFAULT true;

ALTER TABLE public.quote_catalogue_items
  ADD COLUMN IF NOT EXISTS internal_notes text;


-- ============================================================
-- 3. BRAND FUZZY SEARCH INDEX (pg_trgm already enabled)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_catalogue_brand_trgm
  ON public.quote_catalogue_items
  USING gin (brand public.gin_trgm_ops)
  WHERE brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalogue_item_type
  ON public.quote_catalogue_items (company_id, item_type)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_catalogue_sku
  ON public.quote_catalogue_items (company_id, sku)
  WHERE sku IS NOT NULL;


-- ============================================================
-- 4. CATALOGUE_ITEM_ALIASES
--    Alternative part numbers, OEM numbers, barcodes, names
-- ============================================================
CREATE TABLE IF NOT EXISTS public.catalogue_item_aliases (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalogue_item_id   uuid        NOT NULL REFERENCES public.quote_catalogue_items(id) ON DELETE CASCADE,
  alias_type          text        NOT NULL
    CHECK (alias_type IN ('part_number','oem_number','manufacturer_code','barcode','name','superseded_number')),
  alias_value         text        NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aliases_item
  ON public.catalogue_item_aliases (catalogue_item_id);

CREATE INDEX IF NOT EXISTS idx_aliases_value_trgm
  ON public.catalogue_item_aliases
  USING gin (alias_value public.gin_trgm_ops);

ALTER TABLE public.catalogue_item_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage_aliases" ON public.catalogue_item_aliases
  FOR ALL USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));


-- ============================================================
-- 5. CATALOGUE_ITEM_SUPPLIERS
--    Multiple suppliers per item, each with their own pricing
-- ============================================================
CREATE TABLE IF NOT EXISTS public.catalogue_item_suppliers (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalogue_item_id     uuid        NOT NULL REFERENCES public.quote_catalogue_items(id) ON DELETE CASCADE,
  -- supplier_id references contractors WHERE partner_kind = 'supplier'
  supplier_id           uuid        NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  supplier_sku          text,           -- their part number for this item
  unit_cost             numeric(12,2),  -- their price to us
  lead_time_days        integer,
  min_order_qty         numeric(12,3),
  is_preferred          boolean     NOT NULL DEFAULT false,
  notes                 text,
  last_price_updated_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_item_supplier UNIQUE (catalogue_item_id, supplier_id)
);

-- Only one preferred supplier allowed per item
CREATE UNIQUE INDEX IF NOT EXISTS uq_preferred_supplier_per_item
  ON public.catalogue_item_suppliers (catalogue_item_id)
  WHERE is_preferred = true;

CREATE INDEX IF NOT EXISTS idx_item_suppliers_item
  ON public.catalogue_item_suppliers (catalogue_item_id);

CREATE INDEX IF NOT EXISTS idx_item_suppliers_supplier
  ON public.catalogue_item_suppliers (supplier_id);

ALTER TABLE public.catalogue_item_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage_item_suppliers" ON public.catalogue_item_suppliers
  FOR ALL USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));


-- ============================================================
-- 6. RPC: get_brand_suggestions
--    Returns distinct brands matching a query (fuzzy, pg_trgm)
--    Used for brand autocomplete in the item form
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_brand_suggestions(
  p_company_id uuid,
  p_query      text,
  p_limit      int DEFAULT 10
)
RETURNS TABLE (brand text, item_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.brand,
    COUNT(*) AS item_count
  FROM public.quote_catalogue_items q
  WHERE q.company_id = p_company_id
    AND q.brand IS NOT NULL
    AND q.is_active = true
    AND (
      p_query IS NULL
      OR p_query = ''
      OR q.brand ILIKE '%' || p_query || '%'
      OR public.similarity(q.brand, p_query) > 0.2
    )
  GROUP BY q.brand
  ORDER BY
    CASE WHEN p_query IS NOT NULL AND p_query != ''
      THEN public.similarity(q.brand, p_query)
      ELSE 0
    END DESC,
    item_count DESC
  LIMIT p_limit;
$$;


-- ============================================================
-- 7. RPC: normalize_brand
--    Trims and title-cases a brand name before storing
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_brand(p_brand text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT initcap(trim(regexp_replace(p_brand, '\s+', ' ', 'g')));
$$;


-- ============================================================
-- 8. RPC: get_inventory_stock_status
--    Returns stock status for a list of item IDs
--    Used by quote builder to show in-stock / gap / source
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_inventory_stock_status(
  p_company_id uuid,
  p_item_ids   uuid[]
)
RETURNS TABLE (
  catalogue_item_id uuid,
  qty_on_hand       numeric,
  qty_on_order      numeric,
  qty_available     numeric,
  is_stockable      boolean,
  reorder_point     numeric,
  preferred_supplier_id uuid,
  preferred_supplier_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.id                                        AS catalogue_item_id,
    q.qty_on_hand,
    q.qty_on_order,
    GREATEST(q.qty_on_hand - q.qty_reserved, 0) AS qty_available,
    q.is_stockable,
    q.reorder_point,
    cs.supplier_id                              AS preferred_supplier_id,
    c.name                                      AS preferred_supplier_name
  FROM public.quote_catalogue_items q
  LEFT JOIN public.catalogue_item_suppliers cs
    ON cs.catalogue_item_id = q.id AND cs.is_preferred = true
  LEFT JOIN public.contractors c
    ON c.id = cs.supplier_id
  WHERE q.company_id = p_company_id
    AND q.id = ANY(p_item_ids);
$$;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
