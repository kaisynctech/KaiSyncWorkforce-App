-- ============================================================
-- KaiSync Commercial Engine — Phase 2: Procurement
-- 2026-08-11
--
-- Adds: RFQs, supplier responses, supplier comparison,
--       purchase orders, goods received notes, three-way matching
--
-- Key fact: suppliers ARE the contractors table with partner_kind = 'supplier'
-- No separate suppliers table — use contractors WHERE partner_kind = 'supplier'
-- ============================================================


-- ============================================================
-- 1. NEW PERMISSION KEYS
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
    VALUES
      -- RFQs
      (r.id, 'owner',    'rfq.view',                 true),
      (r.id, 'owner',    'rfq.edit',                 true),
      (r.id, 'owner',    'rfq.approve',              true),
      (r.id, 'hr',       'rfq.view',                 true),
      (r.id, 'hr',       'rfq.edit',                 true),
      (r.id, 'hr',       'rfq.approve',              false),
      (r.id, 'manager',  'rfq.view',                 true),
      (r.id, 'manager',  'rfq.edit',                 true),
      (r.id, 'manager',  'rfq.approve',              false),
      (r.id, 'employee', 'rfq.view',                 false),
      (r.id, 'employee', 'rfq.edit',                 false),
      (r.id, 'employee', 'rfq.approve',              false),
      -- Purchase Orders
      (r.id, 'owner',    'purchase_orders.view',     true),
      (r.id, 'owner',    'purchase_orders.edit',     true),
      (r.id, 'owner',    'purchase_orders.approve',  true),
      (r.id, 'hr',       'purchase_orders.view',     true),
      (r.id, 'hr',       'purchase_orders.edit',     true),
      (r.id, 'hr',       'purchase_orders.approve',  false),
      (r.id, 'manager',  'purchase_orders.view',     true),
      (r.id, 'manager',  'purchase_orders.edit',     false),
      (r.id, 'manager',  'purchase_orders.approve',  false),
      (r.id, 'employee', 'purchase_orders.view',     false),
      (r.id, 'employee', 'purchase_orders.edit',     false),
      (r.id, 'employee', 'purchase_orders.approve',  false),
      -- Goods Received
      (r.id, 'owner',    'goods_received.view',      true),
      (r.id, 'owner',    'goods_received.edit',      true),
      (r.id, 'hr',       'goods_received.view',      true),
      (r.id, 'hr',       'goods_received.edit',      true),
      (r.id, 'manager',  'goods_received.view',      true),
      (r.id, 'manager',  'goods_received.edit',      true),
      (r.id, 'employee', 'goods_received.view',      false),
      (r.id, 'employee', 'goods_received.edit',      false)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;


-- ============================================================
-- 2. EXTEND EXISTING TABLES
-- ============================================================

-- supplier_invoices: link to purchase order for three-way matching
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
  -- NOTE: purchase_orders doesn't exist yet — this FK is deferred below
  -- Re-run after purchase_orders is created (see bottom of file for the FK add)

-- inventory_items: link to preferred supplier and catalogue
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS preferred_supplier_id  uuid,  -- soft ref to contractors
  ADD COLUMN IF NOT EXISTS catalogue_item_id      uuid;  -- soft ref to quote_catalogue_items

-- Drop the FK added above (purchase_orders doesn't exist yet at this point)
-- We'll add it at the end of the migration after purchase_orders is created
ALTER TABLE public.supplier_invoices DROP COLUMN IF EXISTS po_id;


-- ============================================================
-- 3. RFQs (Requests for Quotation)
--    One RFQ = one set of items sent to one or more suppliers.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rfqs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  rfq_number           text,                    -- RFQ-YYYY-NNNN
  title                text        NOT NULL,
  deal_id              uuid        REFERENCES public.client_deals(id) ON DELETE SET NULL,
  quote_id             uuid        REFERENCES public.commercial_quotes(id) ON DELETE SET NULL,
  status               text        NOT NULL DEFAULT 'draft',
    -- draft | sent | responses_received | closed | cancelled
  description          text,
  delivery_address     text,
  required_by_date     date,
  response_deadline    date,
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfq_select" ON public.rfqs FOR SELECT
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.view'));
CREATE POLICY "rfq_insert" ON public.rfqs FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.edit'));
CREATE POLICY "rfq_update" ON public.rfqs FOR UPDATE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.edit'));
CREATE POLICY "rfq_delete" ON public.rfqs FOR DELETE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.edit'));


-- ============================================================
-- 4. RFQ LINE ITEMS
--    What is being requested. Same items sent to all recipients.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rfq_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  rfq_id               uuid        NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  sort_order           integer     NOT NULL DEFAULT 0,
  quote_line_id        uuid        REFERENCES public.commercial_quote_lines(id) ON DELETE SET NULL,
  inventory_item_id    uuid        REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  description          text        NOT NULL,
  unit                 text        NOT NULL DEFAULT 'each',
  quantity             numeric     NOT NULL DEFAULT 1,
  specifications       text,                    -- technical specs the supplier must meet
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rfq_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rfq_lines_all" ON public.rfq_lines FOR ALL
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.view'));


-- ============================================================
-- 5. RFQ RECIPIENTS
--    Which suppliers receive this RFQ and their response metadata.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rfq_recipients (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  rfq_id               uuid        NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  supplier_id          uuid        NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
    -- contractors WHERE partner_kind = 'supplier'
  status               text        NOT NULL DEFAULT 'pending',
    -- pending | sent | viewed | responded | declined | selected | not_selected
  sent_at              timestamptz,
  viewed_at            timestamptz,
  responded_at         timestamptz,
  declined_at          timestamptz,
  decline_reason       text,
  -- Response summary (calculated from rfq_response_lines)
  response_subtotal    numeric     NOT NULL DEFAULT 0,
  response_vat_amount  numeric     NOT NULL DEFAULT 0,
  response_total       numeric     NOT NULL DEFAULT 0,
  response_delivery_days integer,
  response_valid_until date,
  response_notes       text,
  is_selected          boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rfq_id, supplier_id)
);

ALTER TABLE public.rfq_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rfq_recipients_all" ON public.rfq_recipients FOR ALL
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.view'));


-- ============================================================
-- 6. RFQ RESPONSE LINES
--    Each supplier's unit price for each RFQ line item.
--    This powers the side-by-side comparison engine.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rfq_response_lines (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  rfq_id               uuid        NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  recipient_id         uuid        NOT NULL REFERENCES public.rfq_recipients(id) ON DELETE CASCADE,
  rfq_line_id          uuid        NOT NULL REFERENCES public.rfq_lines(id) ON DELETE CASCADE,
  unit_price           numeric     NOT NULL DEFAULT 0,
  quantity             numeric     NOT NULL DEFAULT 1,
  subtotal             numeric     NOT NULL DEFAULT 0,
  vat_rate             numeric     NOT NULL DEFAULT 0.15,
  vat_amount           numeric     NOT NULL DEFAULT 0,
  line_total           numeric     NOT NULL DEFAULT 0,
  lead_time_days       integer,
  availability_notes   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, rfq_line_id)
);

ALTER TABLE public.rfq_response_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rfq_response_lines_all" ON public.rfq_response_lines FOR ALL
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'rfq.view'));


-- ============================================================
-- 7. PURCHASE ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  po_number             text,                    -- PO-YYYY-NNNN
  supplier_id           uuid        REFERENCES public.contractors(id) ON DELETE RESTRICT,
  deal_id               uuid        REFERENCES public.client_deals(id) ON DELETE SET NULL,
  quote_id              uuid        REFERENCES public.commercial_quotes(id) ON DELETE SET NULL,
  rfq_id                uuid        REFERENCES public.rfqs(id) ON DELETE SET NULL,
  status                text        NOT NULL DEFAULT 'draft',
    -- draft | pending_approval | approved | sent | partially_received | received | cancelled
  approval_status       text        NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected
  currency              text        NOT NULL DEFAULT 'ZAR',
  subtotal              numeric     NOT NULL DEFAULT 0,
  vat_amount            numeric     NOT NULL DEFAULT 0,
  total_amount          numeric     NOT NULL DEFAULT 0,
  amount_received_value numeric     NOT NULL DEFAULT 0,   -- value of goods received
  delivery_address      text,
  required_delivery_date date,
  actual_delivery_date  date,
  terms_and_conditions  text,
  notes                 text,
  internal_notes        text,
  approved_by           uuid,
  approved_at           timestamptz,
  rejected_by           uuid,
  rejected_at           timestamptz,
  rejection_reason      text,
  sent_at               timestamptz,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "po_select" ON public.purchase_orders FOR SELECT
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'purchase_orders.view'));
CREATE POLICY "po_insert" ON public.purchase_orders FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'purchase_orders.edit'));
CREATE POLICY "po_update" ON public.purchase_orders FOR UPDATE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'purchase_orders.edit'));
CREATE POLICY "po_delete" ON public.purchase_orders FOR DELETE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'purchase_orders.edit'));


-- ============================================================
-- 8. PURCHASE ORDER LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  po_id                 uuid        NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sort_order            integer     NOT NULL DEFAULT 0,
  rfq_line_id           uuid        REFERENCES public.rfq_lines(id) ON DELETE SET NULL,
  rfq_response_line_id  uuid        REFERENCES public.rfq_response_lines(id) ON DELETE SET NULL,
  inventory_item_id     uuid        REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quote_line_id         uuid        REFERENCES public.commercial_quote_lines(id) ON DELETE SET NULL,
  description           text        NOT NULL,
  unit                  text        NOT NULL DEFAULT 'each',
  quantity_ordered      numeric     NOT NULL DEFAULT 1,
  unit_price            numeric     NOT NULL DEFAULT 0,
  subtotal              numeric     NOT NULL DEFAULT 0,
  vat_rate              numeric     NOT NULL DEFAULT 0.15,
  vat_amount            numeric     NOT NULL DEFAULT 0,
  line_total            numeric     NOT NULL DEFAULT 0,
  -- Updated as goods arrive and supplier invoices are matched
  quantity_received     numeric     NOT NULL DEFAULT 0,
  quantity_invoiced     numeric     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_lines_all" ON public.purchase_order_lines FOR ALL
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'purchase_orders.view'));


-- ============================================================
-- 9. GOODS RECEIVED NOTES (GRN)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.goods_received_notes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  grn_number            text,                    -- GRN-YYYY-NNNN
  po_id                 uuid        REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  supplier_id           uuid        REFERENCES public.contractors(id) ON DELETE SET NULL,
  deal_id               uuid        REFERENCES public.client_deals(id) ON DELETE SET NULL,
  status                text        NOT NULL DEFAULT 'draft',
    -- draft | received | partial
  received_date         date        NOT NULL DEFAULT CURRENT_DATE,
  received_by           uuid,                    -- employee_id (soft ref)
  delivery_note_number  text,                    -- supplier's delivery note ref
  notes                 text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_received_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grn_select" ON public.goods_received_notes FOR SELECT
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'goods_received.view'));
CREATE POLICY "grn_insert" ON public.goods_received_notes FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'goods_received.edit'));
CREATE POLICY "grn_update" ON public.goods_received_notes FOR UPDATE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'goods_received.edit'));
CREATE POLICY "grn_delete" ON public.goods_received_notes FOR DELETE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'goods_received.edit'));


-- ============================================================
-- 10. GOODS RECEIVED LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.goods_received_lines (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL,
  grn_id                uuid        NOT NULL REFERENCES public.goods_received_notes(id) ON DELETE CASCADE,
  po_line_id            uuid        REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  inventory_item_id     uuid        REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  description           text        NOT NULL,
  unit                  text        NOT NULL DEFAULT 'each',
  quantity_expected     numeric     NOT NULL DEFAULT 0,   -- from PO line
  quantity_received     numeric     NOT NULL DEFAULT 0,   -- actual received
  unit_cost             numeric     NOT NULL DEFAULT 0,
  condition_notes       text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goods_received_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "grn_lines_all" ON public.goods_received_lines FOR ALL
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'goods_received.view'));


-- ============================================================
-- 11. NOW SAFE TO ADD po_id FK TO supplier_invoices
--     (purchase_orders table exists now)
-- ============================================================
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


-- ============================================================
-- 12. THREE-WAY MATCH VIEW
--     PO (ordered) vs GRN (received) vs supplier_invoice (billed)
--     Used for discrepancy detection on the PO detail page.
-- ============================================================
CREATE OR REPLACE VIEW public.po_three_way_match AS
SELECT
  pol.id                                                  AS po_line_id,
  pol.po_id,
  po.po_number,
  po.supplier_id,
  pol.description,
  pol.unit,
  pol.unit_price,
  pol.quantity_ordered,
  pol.quantity_received,
  pol.quantity_invoiced,
  pol.unit_price * pol.quantity_ordered                   AS value_ordered,
  pol.unit_price * pol.quantity_received                  AS value_received,
  pol.unit_price * pol.quantity_invoiced                  AS value_invoiced,
  pol.quantity_received - pol.quantity_ordered            AS receipt_variance,
  pol.quantity_invoiced - pol.quantity_received           AS invoice_variance,
  CASE
    WHEN pol.quantity_ordered = 0                         THEN 'NO_ORDER'
    WHEN pol.quantity_invoiced > pol.quantity_received    THEN 'OVER_INVOICED'
    WHEN pol.quantity_received < pol.quantity_ordered
     AND pol.quantity_invoiced = pol.quantity_received    THEN 'SHORT_DELIVERY'
    WHEN pol.quantity_invoiced = pol.quantity_received
     AND pol.quantity_received = pol.quantity_ordered     THEN 'MATCHED'
    ELSE 'PARTIAL'
  END                                                     AS match_status,
  po.company_id
FROM public.purchase_order_lines pol
JOIN public.purchase_orders po ON po.id = pol.po_id;


-- ============================================================
-- 13. AUTO-NUMBER RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_rfq_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(rfq_number, '-', 3) AS int)), 0) + 1
  INTO v_seq
  FROM public.rfqs
  WHERE company_id = p_company_id AND rfq_number LIKE 'RFQ-' || v_year || '-%';
  RETURN 'RFQ-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_po_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(po_number, '-', 3) AS int)), 0) + 1
  INTO v_seq
  FROM public.purchase_orders
  WHERE company_id = p_company_id AND po_number LIKE 'PO-' || v_year || '-%';
  RETURN 'PO-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_grn_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(grn_number, '-', 3) AS int)), 0) + 1
  INTO v_seq
  FROM public.goods_received_notes
  WHERE company_id = p_company_id AND grn_number LIKE 'GRN-' || v_year || '-%';
  RETURN 'GRN-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;


-- ============================================================
-- 14. SUPPLIER COMPARISON RPC
--     Returns all supplier prices for all RFQ lines side-by-side.
--     Used to power the comparison table UI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_rfq_comparison(p_rfq_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id uuid;
  v_result     jsonb;
BEGIN
  SELECT company_id INTO v_company_id FROM public.rfqs WHERE id = p_rfq_id;
  PERFORM public.require_user_permission(v_company_id, 'rfq.view');

  SELECT jsonb_build_object(
    'rfq_id',    p_rfq_id,
    'lines',     (
      SELECT jsonb_agg(
        jsonb_build_object(
          'rfq_line_id',  rl.id,
          'sort_order',   rl.sort_order,
          'description',  rl.description,
          'unit',         rl.unit,
          'quantity',     rl.quantity,
          'responses',    (
            SELECT jsonb_agg(
              jsonb_build_object(
                'recipient_id',  rr.id,
                'supplier_id',   rr.supplier_id,
                'supplier_name', c.name,
                'unit_price',    COALESCE(rrl.unit_price, 0),
                'line_total',    COALESCE(rrl.line_total, 0),
                'lead_time_days',COALESCE(rrl.lead_time_days, 0),
                'responded',     (rrl.id IS NOT NULL)
              ) ORDER BY rrl.unit_price ASC NULLS LAST
            )
            FROM public.rfq_recipients rr
            JOIN public.contractors c ON c.id = rr.supplier_id
            LEFT JOIN public.rfq_response_lines rrl
              ON rrl.recipient_id = rr.id AND rrl.rfq_line_id = rl.id
            WHERE rr.rfq_id = p_rfq_id
          )
        ) ORDER BY rl.sort_order
      )
      FROM public.rfq_lines rl
      WHERE rl.rfq_id = p_rfq_id
    ),
    'recipients', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'recipient_id',     rr.id,
          'supplier_id',      rr.supplier_id,
          'supplier_name',    c.name,
          'status',           rr.status,
          'response_total',   rr.response_total,
          'delivery_days',    rr.response_delivery_days,
          'is_selected',      rr.is_selected
        ) ORDER BY rr.response_total ASC NULLS LAST
      )
      FROM public.rfq_recipients rr
      JOIN public.contractors c ON c.id = rr.supplier_id
      WHERE rr.rfq_id = p_rfq_id
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 15. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_rfqs_company        ON public.rfqs(company_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_deal           ON public.rfqs(deal_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status         ON public.rfqs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_rfq_lines_rfq       ON public.rfq_lines(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_recipients_rfq  ON public.rfq_recipients(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_resp_recipient  ON public.rfq_response_lines(recipient_id);
CREATE INDEX IF NOT EXISTS idx_rfq_resp_line       ON public.rfq_response_lines(rfq_line_id);
CREATE INDEX IF NOT EXISTS idx_po_company          ON public.purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier         ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_deal             ON public.purchase_orders(deal_id);
CREATE INDEX IF NOT EXISTS idx_po_status           ON public.purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_po_lines_po         ON public.purchase_order_lines(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_company         ON public.goods_received_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_grn_po              ON public.goods_received_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_grn       ON public.goods_received_lines(grn_id);
CREATE INDEX IF NOT EXISTS idx_supplier_inv_po     ON public.supplier_invoices(po_id);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
