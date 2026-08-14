-- ============================================================
-- KaiSync — Quote Builder: RFQ Tables
-- 2026-08-12
--
-- Adds the RFQ (Request for Quote) layer to the commercial
-- quote flow.
--
-- An RFQ is one communication to one supplier/contractor
-- covering multiple items. A single quote can have many RFQs
-- (one per supplier contacted).
--
-- New tables:
--   quote_rfqs       — one RFQ per supplier per quote
--   quote_rfq_lines  — items inside an RFQ
--
-- Extends:
--   commercial_quote_lines — adds source tracking fields
--
-- Phase 2 (not in this migration):
--   - Outbound email sending (needs email service integration)
--   - Inbound email parsing (needs webhook / mailbox integration)
--   - PDF/Excel response auto-parse
-- ============================================================


-- ============================================================
-- STEP 0: READ EXISTING TABLE BEFORE APPLYING
-- Claude Code: run the following first to check what already
-- exists on commercial_quote_lines before adding columns.
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'commercial_quote_lines'
-- ORDER BY ordinal_position;
--
-- Also confirm the quotes table name:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name ILIKE '%quote%';
-- ============================================================


-- ============================================================
-- 1. QUOTE_RFQS
--    One row = one RFQ sent to one supplier/contractor.
--    A quote can have many RFQs (one per supplier contacted).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quote_rfqs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- The quote this RFQ belongs to
  -- Using text reference to avoid hard FK until we confirm the quotes table name.
  -- Claude Code: replace 'commercial_quotes' with the actual quotes table name if different.
  quote_id      uuid        NOT NULL,

  -- supplier_id references contractors WHERE partner_kind IN ('supplier','contractor')
  supplier_id   uuid        NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,

  -- Human-readable reference number, e.g. RFQ-2026-0041-01
  rfq_number    text        NOT NULL,

  status        text        NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',               -- created, not yet sent
      'sent',                -- sent to supplier (manually confirmed or auto-sent)
      'partially_responded', -- some lines have responses, not all
      'responded',           -- all lines have supplier prices
      'expired',             -- no response received, marked expired
      'cancelled'
    )),

  -- Phase 2: email tracking
  -- sent_via: 'manual' (user contacted supplier outside system) | 'email' (system sent)
  sent_via      text        DEFAULT 'manual'
    CHECK (sent_via IN ('manual','email')),

  sent_at       timestamptz,
  responded_at  timestamptz,  -- when last line was filled in
  notes         text,

  -- Attachment: supplier's response document (PDF/Excel)
  response_document_path  text,   -- storage path, populated when user uploads
  response_document_name  text,

  created_by    uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate rfq_number: RFQ-{YYYY}-{quote_seq}-{rfq_seq}
-- Claude Code: implement this in the application layer (RPC or client) using
-- a sequence or count query, not a DB sequence, to keep it human-readable.

CREATE INDEX IF NOT EXISTS idx_rfq_quote
  ON public.quote_rfqs (quote_id);

CREATE INDEX IF NOT EXISTS idx_rfq_supplier
  ON public.quote_rfqs (supplier_id);

CREATE INDEX IF NOT EXISTS idx_rfq_company_status
  ON public.quote_rfqs (company_id, status);

ALTER TABLE public.quote_rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage_quote_rfqs" ON public.quote_rfqs
  FOR ALL USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));


-- ============================================================
-- 2. QUOTE_RFQ_LINES
--    One row = one item inside an RFQ.
--    Tracks what was asked and what the supplier responded.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quote_rfq_lines (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rfq_id                  uuid          NOT NULL REFERENCES public.quote_rfqs(id) ON DELETE CASCADE,

  -- The catalogue item being sourced
  catalogue_item_id       uuid          NOT NULL REFERENCES public.quote_catalogue_items(id) ON DELETE RESTRICT,

  -- Optional: if the item has variants, which variant was requested
  variant_id              uuid,         -- FK to quote_catalogue_items (variant row)

  qty_requested           numeric(12,3) NOT NULL DEFAULT 1,

  -- Supplier's response (null until they respond)
  supplier_price          numeric(12,2),   -- their unit cost to us
  supplier_ref            text,            -- their reference number / quote number
  supplier_qty_available  numeric(12,3),
  lead_time_days          integer,
  supplier_notes          text,
  responded_at            timestamptz,     -- when this line was filled in

  -- Whether this RFQ line was chosen as the winning source
  -- for the corresponding quote line
  is_selected             boolean       NOT NULL DEFAULT false,

  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_lines_rfq
  ON public.quote_rfq_lines (rfq_id);

CREATE INDEX IF NOT EXISTS idx_rfq_lines_item
  ON public.quote_rfq_lines (catalogue_item_id);

-- Only one selected winner per (quote, catalogue_item)
-- Enforced at application level (not DB constraint) because the
-- quote_id is on the rfq, not the line — easier to enforce in code.

ALTER TABLE public.quote_rfq_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manage_rfq_lines" ON public.quote_rfq_lines
  FOR ALL USING (company_id = ANY(public.user_company_ids()))
  WITH CHECK (company_id = ANY(public.user_company_ids()));


-- ============================================================
-- 3. EXTEND commercial_quote_lines
--    Add source tracking: where did this line's cost come from?
-- ============================================================

-- Source type: inventory pull, RFQ winner, catalogue default, manual entry
ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS source_type text
    CHECK (source_type IN (
      'inventory',   -- pulled from own stock (specific catalogue_item_id / variant)
      'rfq',         -- cost from a winning RFQ line
      'catalogue',   -- cost from catalogue item's default cost_price (services we provide)
      'manual'       -- user typed the cost directly, no source
    ));

-- Link back to the winning RFQ line (nullable — only set when source_type = 'rfq')
ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS rfq_line_id uuid
    REFERENCES public.quote_rfq_lines(id) ON DELETE SET NULL;

-- For service lines: flag whether we provide or outsource
ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS service_delivery text
    CHECK (service_delivery IN ('self','outsourced'))
    -- NULL for non-service lines; 'self' or 'outsourced' for service/labour lines
  ;

-- Link to the catalogue item / variant being sourced
-- (may already exist — check before applying)
ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS catalogue_item_id uuid
    REFERENCES public.quote_catalogue_items(id) ON DELETE SET NULL;

ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS variant_id uuid;  -- FK to variant row in quote_catalogue_items


-- ============================================================
-- 4. RPC: get_quote_sourcing_summary
--    Returns all requested lines for a quote with their
--    sourcing status: in stock, RFQ sent, responded, confirmed.
--    Used to drive the Tab 2 (Stock & Sourcing) table.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_quote_sourcing_summary(
  p_company_id uuid,
  p_quote_id   uuid
)
RETURNS TABLE (
  line_id             uuid,
  catalogue_item_id   uuid,
  item_name           text,
  item_sku            text,
  item_type           text,
  qty_requested       numeric,
  service_delivery    text,
  -- inventory status
  qty_in_stock        numeric,
  is_stockable        boolean,
  -- sourcing status
  source_type         text,
  rfq_count           bigint,   -- how many RFQs include this item
  rfq_responded_count bigint,   -- how many of those have a price back
  is_confirmed        boolean   -- source locked (is_selected = true on an rfq_line or source_type set)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ql.id                                         AS line_id,
    ql.catalogue_item_id,
    qi.name                                       AS item_name,
    qi.sku                                        AS item_sku,
    qi.item_type,
    ql.quantity                                   AS qty_requested,
    ql.service_delivery,
    qi.qty_on_hand                                AS qty_in_stock,
    qi.is_stockable,
    ql.source_type,
    COUNT(DISTINCT rfl.rfq_id)                    AS rfq_count,
    COUNT(DISTINCT rfl.rfq_id)
      FILTER (WHERE rfl.supplier_price IS NOT NULL) AS rfq_responded_count,
    (ql.source_type IS NOT NULL)                  AS is_confirmed
  FROM public.commercial_quote_lines ql
  LEFT JOIN public.quote_catalogue_items qi
    ON qi.id = ql.catalogue_item_id
  LEFT JOIN public.quote_rfq_lines rfl
    ON rfl.catalogue_item_id = ql.catalogue_item_id
   AND rfl.rfq_id IN (
     SELECT id FROM public.quote_rfqs
     WHERE quote_id = p_quote_id
       AND company_id = p_company_id
   )
  WHERE ql.company_id = p_company_id
    -- Claude Code: replace the quote FK column name if different
    AND ql.quote_id = p_quote_id
  GROUP BY
    ql.id, ql.catalogue_item_id, qi.name, qi.sku, qi.item_type,
    ql.quantity, ql.service_delivery, qi.qty_on_hand, qi.is_stockable, ql.source_type
  ORDER BY ql.sort_order NULLS LAST, ql.created_at;
$$;


-- ============================================================
-- 5. RPC: get_rfq_comparison
--    For a given catalogue_item + quote, returns all RFQ lines
--    (supplier quotes) so the user can compare and pick one.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rfq_comparison(
  p_company_id      uuid,
  p_quote_id        uuid,
  p_catalogue_item_id uuid
)
RETURNS TABLE (
  rfq_line_id         uuid,
  rfq_id              uuid,
  rfq_number          text,
  supplier_id         uuid,
  supplier_name       text,
  rfq_status          text,
  supplier_price      numeric,
  supplier_ref        text,
  supplier_qty        numeric,
  lead_time_days      integer,
  supplier_notes      text,
  responded_at        timestamptz,
  is_selected         boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rfl.id            AS rfq_line_id,
    r.id              AS rfq_id,
    r.rfq_number,
    r.supplier_id,
    c.name            AS supplier_name,
    r.status          AS rfq_status,
    rfl.supplier_price,
    rfl.supplier_ref,
    rfl.supplier_qty_available AS supplier_qty,
    rfl.lead_time_days,
    rfl.supplier_notes,
    rfl.responded_at,
    rfl.is_selected
  FROM public.quote_rfq_lines rfl
  JOIN public.quote_rfqs r ON r.id = rfl.rfq_id
  JOIN public.contractors c ON c.id = r.supplier_id
  WHERE r.company_id = p_company_id
    AND r.quote_id = p_quote_id
    AND rfl.catalogue_item_id = p_catalogue_item_id
  ORDER BY rfl.supplier_price NULLS LAST, c.name;
$$;


-- ============================================================
-- END OF MIGRATION
-- ============================================================
