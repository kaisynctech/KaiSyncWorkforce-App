-- ============================================================
-- KaiSync — Stock Adjustment Log
-- 2026-08-12
--
-- Tracks every change to qty_on_hand with a reason and audit trail.
-- The RPC record_stock_adjustment is the single point of entry —
-- all stock changes (manual, GRN, quote fulfilment) go through it.
-- ============================================================


-- ============================================================
-- 1. STOCK_ADJUSTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  catalogue_item_id   uuid          NOT NULL REFERENCES public.quote_catalogue_items(id) ON DELETE CASCADE,
  adjusted_by         uuid          REFERENCES public.employees(id) ON DELETE SET NULL,

  -- What kind of adjustment
  adjustment_type     text          NOT NULL
    CHECK (adjustment_type IN (
      'received',           -- stock arrived (purchase / delivery)
      'returned_by_customer', -- customer returned goods
      'count_correction',   -- physical stock count reconciliation
      'damaged',            -- write-off damaged / unusable stock
      'internal_use',       -- consumed internally (not sold)
      'transferred_in',     -- received from another branch / location
      'transferred_out',    -- sent to another branch / location
      'sold',               -- fulfilled against a quote/invoice
      'other'               -- anything else — requires notes
    )),

  -- Signed quantity: positive = stock increases, negative = stock decreases
  qty_change          numeric(12,3) NOT NULL CHECK (qty_change != 0),

  -- Snapshots at time of adjustment (immutable audit record)
  qty_before          numeric(12,3) NOT NULL,
  qty_after           numeric(12,3) NOT NULL,

  -- Optional link to the source document
  reference_type      text          CHECK (reference_type IN ('po','grn','quote','invoice','manual','transfer')),
  reference_id        uuid,

  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now()
);

-- Prevent any UPDATE or DELETE — this is an immutable audit log
CREATE RULE stock_adjustments_no_update AS ON UPDATE TO public.stock_adjustments DO INSTEAD NOTHING;
CREATE RULE stock_adjustments_no_delete AS ON DELETE TO public.stock_adjustments DO INSTEAD NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_adj_item
  ON public.stock_adjustments (catalogue_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_adj_company
  ON public.stock_adjustments (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_adj_employee
  ON public.stock_adjustments (adjusted_by)
  WHERE adjusted_by IS NOT NULL;

-- RLS
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_stock_adjustments" ON public.stock_adjustments
  FOR SELECT USING (company_id = ANY(public.user_company_ids()));

-- INSERT only via RPC (no direct client INSERT policy needed)
-- The RPC runs as SECURITY DEFINER


-- ============================================================
-- 2. RPC: record_stock_adjustment
--    Single point of entry for all stock changes.
--    Atomically: reads current qty → inserts adjustment → updates item.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
  p_company_id        uuid,
  p_catalogue_item_id uuid,
  p_adjusted_by       uuid,       -- employee id (nullable for system adjustments)
  p_adjustment_type   text,
  p_qty_change        numeric,    -- signed: positive = add, negative = remove
  p_notes             text        DEFAULT NULL,
  p_reference_type    text        DEFAULT NULL,
  p_reference_id      uuid        DEFAULT NULL,
  p_allow_negative    boolean     DEFAULT false  -- set true only for system/GRN adjustments
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty_before    numeric(12,3);
  v_qty_after     numeric(12,3);
  v_is_stockable  boolean;
  v_adj_id        uuid;
BEGIN
  -- Lock the item row to prevent race conditions
  SELECT qty_on_hand, is_stockable
  INTO v_qty_before, v_is_stockable
  FROM public.quote_catalogue_items
  WHERE id = p_catalogue_item_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF NOT v_is_stockable THEN
    RAISE EXCEPTION 'Item is not stockable';
  END IF;

  v_qty_after := v_qty_before + p_qty_change;

  -- Guard against negative stock (unless explicitly allowed)
  IF v_qty_after < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'Stock would go negative (current: %, change: %)',
      v_qty_before, p_qty_change;
  END IF;

  -- Insert the adjustment record
  INSERT INTO public.stock_adjustments (
    company_id, catalogue_item_id, adjusted_by,
    adjustment_type, qty_change, qty_before, qty_after,
    reference_type, reference_id, notes
  ) VALUES (
    p_company_id, p_catalogue_item_id, p_adjusted_by,
    p_adjustment_type, p_qty_change, v_qty_before, v_qty_after,
    p_reference_type, p_reference_id, p_notes
  )
  RETURNING id INTO v_adj_id;

  -- Update the item's running total
  UPDATE public.quote_catalogue_items
  SET qty_on_hand = v_qty_after
  WHERE id = p_catalogue_item_id;

  RETURN jsonb_build_object(
    'adjustment_id', v_adj_id,
    'qty_before',    v_qty_before,
    'qty_after',     v_qty_after,
    'qty_change',    p_qty_change
  );
END;
$$;


-- ============================================================
-- 3. VIEW: stock_adjustment_history
--    Enriched view for display in the UI
-- ============================================================
CREATE OR REPLACE VIEW public.stock_adjustment_history AS
SELECT
  sa.id,
  sa.company_id,
  sa.catalogue_item_id,
  qi.name                                         AS item_name,
  qi.sku,
  sa.adjusted_by,
  e.name || ' ' || e.surname                      AS adjusted_by_name,
  sa.adjustment_type,
  sa.qty_change,
  sa.qty_before,
  sa.qty_after,
  sa.reference_type,
  sa.reference_id,
  sa.notes,
  sa.created_at
FROM public.stock_adjustments sa
JOIN public.quote_catalogue_items qi ON qi.id = sa.catalogue_item_id
LEFT JOIN public.employees e ON e.id = sa.adjusted_by;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
