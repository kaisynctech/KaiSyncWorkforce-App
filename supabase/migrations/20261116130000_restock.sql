-- Piece 9c: Restock from low stock (board H).
--  • restock_list: stock items at or under their reorder point (counting what's already on open purchase orders),
--    a suggested order quantity, and the best known price from the supplier price book: every supplier price on the
--    item, every Buyout / RFQ reply, every PO and every bill. A price older than 90 days is flagged "old: ask".
--    Runs as the signed-in person (row-level security applies).
--  • restock_create_pos: "Order at best known price" — one PO per supplier, ready to send (VAT as fractions, 0.15).
-- Rollback: DROP FUNCTION public.restock_list(uuid); DROP FUNCTION public.restock_create_pos(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.restock_list(p_company_id uuid)
RETURNS TABLE (
  catalogue_item_id uuid, inventory_item_id uuid, name text, sku text, unit text,
  on_hand numeric, on_order numeric, reorder_point numeric, suggested_qty numeric,
  best_supplier_id uuid, best_supplier_name text, best_price numeric, price_at timestamptz, price_old boolean
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH items AS (
    SELECT c.id AS cat_id, i.id AS inv_id, c.name, coalesce(c.sku, c.code) AS sku,
           coalesce(nullif(c.unit_of_measure, ''), c.unit, 'each') AS unit,
           coalesce(i.quantity_on_hand::numeric, c.qty_on_hand, 0) AS on_hand,
           coalesce(nullif(c.reorder_point, 0), i.reorder_level::numeric, 0) AS reorder,
           coalesce(c.reorder_qty, 0) AS reorder_qty
      FROM public.quote_catalogue_items c
      JOIN public.inventory_items i ON i.catalogue_item_id = c.id AND i.company_id = c.company_id
     WHERE c.company_id = p_company_id AND coalesce(c.is_active, true) AND coalesce(c.is_stockable, false)
       AND coalesce(i.is_active, true)
  ),
  open_po AS (
    SELECT pl.inventory_item_id AS inv_id,
           sum(greatest(pl.quantity_ordered - coalesce(pl.quantity_received, 0), 0)) AS qty
      FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
     WHERE po.company_id = p_company_id AND pl.inventory_item_id IS NOT NULL
       AND po.status NOT IN ('cancelled', 'received', 'rejected', 'draft')
     GROUP BY 1
  ),
  prices AS (
    -- The supplier price list on the item
    SELECT it.inv_id, s.supplier_id, s.unit_cost AS price, coalesce(s.last_price_updated_at, s.created_at) AS at
      FROM items it JOIN public.catalogue_item_suppliers s ON s.catalogue_item_id = it.cat_id
     WHERE s.unit_cost > 0
    UNION ALL
    -- Supplier replies (Buyout and RFQs), excl. VAT
    SELECT l.inventory_item_id, r.supplier_id,
           CASE WHEN r.prices_include_vat = 'incl' THEN rl.unit_price / 1.15 ELSE rl.unit_price END, rl.created_at
      FROM public.rfq_response_lines rl
      JOIN public.rfq_lines l ON l.id = rl.rfq_line_id
      JOIN public.rfq_recipients r ON r.id = rl.recipient_id
     WHERE l.company_id = p_company_id AND l.inventory_item_id IS NOT NULL AND rl.unit_price > 0
    UNION ALL
    -- Purchase orders (excl. VAT)
    SELECT pl.inventory_item_id, po.supplier_id, pl.unit_price, po.created_at
      FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
     WHERE po.company_id = p_company_id AND pl.inventory_item_id IS NOT NULL AND po.status <> 'cancelled' AND pl.unit_price > 0
    UNION ALL
    -- Supplier bills (excl. VAT)
    SELECT sl.inventory_item_id, si.supplier_id,
           CASE WHEN coalesce(sl.is_vat_inclusive, false)
                THEN sl.unit_price / (1 + CASE WHEN coalesce(sl.vat_rate, 0) > 1 THEN sl.vat_rate / 100 ELSE coalesce(sl.vat_rate, 0) END)
                ELSE sl.unit_price END,
           si.created_at
      FROM public.supplier_invoice_lines sl JOIN public.supplier_invoices si ON si.id = sl.invoice_id
     WHERE si.company_id = p_company_id AND sl.inventory_item_id IS NOT NULL AND si.status <> 'cancelled' AND sl.unit_price > 0
  ),
  latest AS (   -- each supplier's latest price for the item
    SELECT DISTINCT ON (inv_id, supplier_id) inv_id, supplier_id, round(price, 2) AS price, at
      FROM prices WHERE supplier_id IS NOT NULL
     ORDER BY inv_id, supplier_id, at DESC
  ),
  best AS (     -- cheapest of the recent ones; if none is recent, the latest one
    SELECT DISTINCT ON (inv_id) inv_id, supplier_id, price, at, (at < now() - interval '90 days') AS old
      FROM latest
     ORDER BY inv_id, (at < now() - interval '90 days'), price, at DESC
  )
  SELECT it.cat_id, it.inv_id, it.name, it.sku, it.unit, it.on_hand, coalesce(op.qty, 0), it.reorder,
         CASE WHEN it.reorder_qty > 0 THEN it.reorder_qty
              ELSE greatest(ceil(it.reorder * 2 - it.on_hand - coalesce(op.qty, 0)), 1) END,
         b.supplier_id, c.name, b.price, b.at, coalesce(b.old, false)
    FROM items it
    LEFT JOIN open_po op ON op.inv_id = it.inv_id
    LEFT JOIN best b ON b.inv_id = it.inv_id
    LEFT JOIN public.contractors c ON c.id = b.supplier_id
   WHERE it.reorder > 0 AND it.on_hand + coalesce(op.qty, 0) <= it.reorder
   ORDER BY (it.on_hand + coalesce(op.qty, 0)) / nullif(it.reorder, 0), it.name;
$$;

-- p_lines: [{ "inventory_item_id": uuid, "supplier_id": uuid, "qty": number, "unit_price": number (excl. VAT) }]
CREATE OR REPLACE FUNCTION public.restock_create_pos(p_company_id uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid; v_sup uuid; v_po uuid; v_no text; v_rate numeric; v_made jsonb := '[]'::jsonb; v_sort int; x jsonb;
  it public.inventory_items%ROWTYPE; v_q numeric; v_p numeric; v_last record;
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(p_company_id, 'purchase_orders.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RAISE EXCEPTION 'NOTHING_TO_ORDER'; END IF;
  v_me := public._my_employee_id(p_company_id);

  FOR v_sup IN SELECT DISTINCT (e ->> 'supplier_id')::uuid FROM jsonb_array_elements(p_lines) e LOOP
    IF v_sup IS NULL OR NOT EXISTS (SELECT 1 FROM public.contractors WHERE id = v_sup AND company_id = p_company_id) THEN
      RAISE EXCEPTION 'SUPPLIER_REQUIRED';
    END IF;
    -- VAT: as on this supplier's last bill; no bill yet: VAT is added.
    SELECT vat_amount, subtotal INTO v_last FROM public.supplier_invoices
     WHERE company_id = p_company_id AND supplier_id = v_sup AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1;
    v_rate := CASE WHEN v_last IS NULL OR coalesce(v_last.subtotal, 0) = 0 OR coalesce(v_last.vat_amount, 0) > 0 THEN 0.15 ELSE 0 END;

    v_no := public.generate_po_number(p_company_id);
    INSERT INTO public.purchase_orders (company_id, po_number, supplier_id, status, approval_status, currency,
      subtotal, vat_amount, total_amount, notes, approved_by, approved_at, created_by)
    VALUES (p_company_id, v_no, v_sup, 'approved', 'approved', 'ZAR', 0, 0, 0, 'Restock', v_me, now(), v_me)
    RETURNING id INTO v_po;

    v_sort := 0;
    FOR x IN SELECT e FROM jsonb_array_elements(p_lines) e WHERE (e ->> 'supplier_id')::uuid = v_sup LOOP
      v_q := coalesce((x ->> 'qty')::numeric, 0);
      v_p := coalesce((x ->> 'unit_price')::numeric, -1);
      IF v_q <= 0 OR v_p < 0 THEN RAISE EXCEPTION 'BAD_QUANTITY'; END IF;
      SELECT * INTO it FROM public.inventory_items WHERE id = (x ->> 'inventory_item_id')::uuid AND company_id = p_company_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'ITEM_NOT_FOUND'; END IF;
      v_sort := v_sort + 1;
      INSERT INTO public.purchase_order_lines (company_id, po_id, sort_order, inventory_item_id, description, unit,
        quantity_ordered, unit_price, subtotal, vat_rate, vat_amount, line_total, quantity_received, quantity_invoiced)
      VALUES (p_company_id, v_po, v_sort, it.id, it.name, coalesce(nullif(it.unit_of_measure, ''), 'each'), v_q, round(v_p, 2),
        round(v_q * v_p, 2), v_rate, round(v_q * v_p * v_rate, 2), round(v_q * v_p * (1 + v_rate), 2), 0, 0);
    END LOOP;

    UPDATE public.purchase_orders po SET subtotal = t.s, vat_amount = t.v, total_amount = t.s + t.v, updated_at = now()
      FROM (SELECT coalesce(sum(subtotal), 0) s, coalesce(sum(vat_amount), 0) v FROM public.purchase_order_lines WHERE po_id = v_po) t
     WHERE po.id = v_po;
    v_made := v_made || jsonb_build_object('id', v_po, 'po_number', v_no, 'supplier_id', v_sup);
  END LOOP;
  RETURN jsonb_build_object('created', v_made);
END $$;

REVOKE ALL ON FUNCTION public.restock_list(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restock_create_pos(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restock_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restock_create_pos(uuid, jsonb) TO authenticated;
