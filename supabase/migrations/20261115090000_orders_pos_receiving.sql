-- Piece 9a: Process order → purchase orders, safe goods receiving (part deliveries), PO edit / cancel,
-- and one supplier bill per delivery (approved in KaiSync, then sent to Xero).
--
-- Decided 15 Nov 2026:
--  • "Client accepted · Process order" on the quote creates one PO per chosen supplier (from the Buyout choices).
--    The POs are shown first; one "Send all" emails them (the screen does the emailing).
--  • Every delivery becomes its own draft supplier bill (pending approval). Once approved it goes to Xero through
--    the existing supplier-bill sync. The old "whole PO when fully received" Xero bill stops (it could double-bill).
--
-- Rollback:
--   DROP FUNCTION public.quote_process_order(uuid);
--   DROP FUNCTION public.po_receive_goods(uuid, text, jsonb, text);
--   DROP FUNCTION public.goods_received_cancel(uuid, text);
--   DROP FUNCTION public.goods_received_update(uuid, text, text);
--   DROP FUNCTION public.po_update_lines(uuid, jsonb);
--   DROP FUNCTION public.po_cancel(uuid, text);
--   CREATE TRIGGER trg_xero_po_received AFTER UPDATE OF quantity_received ON public.purchase_order_lines
--     FOR EACH ROW EXECUTE FUNCTION public._trg_xero_po_received();   -- (definition kept in _fn_backup)
--   ALTER TABLE public.supplier_invoices DROP COLUMN grn_id;

-- ── Keep the old Xero trigger's definition, then stop it ──────────────────────
DO $b$
DECLARE d text; t text;
BEGIN
  SELECT pg_get_functiondef('public._trg_xero_po_received'::regproc) INTO d;
  SELECT pg_get_triggerdef(oid) INTO t FROM pg_trigger WHERE tgname = 'trg_xero_po_received';
  INSERT INTO public._fn_backup (name, def) VALUES ('_trg_xero_po_received before 9a', d)
    ON CONFLICT (name) DO NOTHING;
  IF t IS NOT NULL THEN
    INSERT INTO public._fn_backup (name, def) VALUES ('trg_xero_po_received trigger before 9a', t)
      ON CONFLICT (name) DO NOTHING;
  END IF;
END $b$;
DROP TRIGGER IF EXISTS trg_xero_po_received ON public.purchase_order_lines;

-- ── A delivery's bill ────────────────────────────────────────────────────────
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES public.goods_received_notes(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_grn_once ON public.supplier_invoices (grn_id) WHERE grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_order_lines_quote_line_idx ON public.purchase_order_lines (quote_line_id) WHERE quote_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS goods_received_notes_po_idx ON public.goods_received_notes (po_id);

-- ── Process order: one PO per chosen supplier ────────────────────────────────
CREATE OR REPLACE FUNCTION public.quote_process_order(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.commercial_quotes%ROWTYPE;
  v_me uuid;
  v_sup record;
  v_po uuid;
  v_no text;
  v_vat boolean;
  v_rate numeric;
  v_lead int;
  v_addr text;
  v_made jsonb := '[]'::jsonb;
  v_to_source int;
  v_sort int;
  l record;
BEGIN
  SELECT * INTO q FROM public.commercial_quotes WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR NOT (q.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(q.company_id, 'purchase_orders.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF q.status <> 'accepted' THEN RAISE EXCEPTION 'QUOTE_NOT_ACCEPTED'; END IF;
  v_me := public._my_employee_id(q.company_id);
  v_addr := nullif(trim(coalesce(q.header_values ->> 'site_address', '')), '');
  IF v_addr IS NULL AND q.job_id IS NOT NULL THEN
    SELECT nullif(trim(coalesce(j.address, s.address, '')), '') INTO v_addr
      FROM public.jobs j LEFT JOIN public.sites s ON s.id = j.site_id WHERE j.id = q.job_id;
  END IF;

  -- Bought-in lines with a chosen supplier that are not on a live PO yet.
  FOR v_sup IN
    SELECT ql.supplier_id
      FROM public.commercial_quote_lines ql
     WHERE ql.quote_id = q.id AND NOT coalesce(ql.is_excluded, false)
       AND ql.supply_mode = 'outsource' AND ql.supplier_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
                        WHERE pl.quote_line_id = ql.id AND po.status <> 'cancelled')
     GROUP BY ql.supplier_id
  LOOP
    -- Does this supplier add VAT? What they said on the Buyout first, then their supplier record.
    SELECT r.charges_vat INTO v_vat
      FROM public.rfq_recipients r JOIN public.rfqs f ON f.id = r.rfq_id
     WHERE f.quote_id = q.id AND f.is_buyout AND r.supplier_id = v_sup.supplier_id AND r.charges_vat IS NOT NULL
     ORDER BY r.updated_at DESC NULLS LAST LIMIT 1;
    IF v_vat IS NULL THEN
      SELECT coalesce(c.is_vat_registered, true) INTO v_vat FROM public.contractors c WHERE c.id = v_sup.supplier_id;
    END IF;
    v_rate := CASE WHEN coalesce(v_vat, true) THEN 15 ELSE 0 END;

    SELECT max(rl.lead_time_days) INTO v_lead
      FROM public.commercial_quote_lines ql JOIN public.rfq_response_lines rl ON rl.id = ql.chosen_response_line_id
     WHERE ql.quote_id = q.id AND ql.supplier_id = v_sup.supplier_id;

    v_no := public.generate_po_number(q.company_id);
    INSERT INTO public.purchase_orders (company_id, po_number, supplier_id, deal_id, quote_id, status, approval_status,
      currency, subtotal, vat_amount, total_amount, delivery_address, required_delivery_date, notes,
      approved_by, approved_at, created_by)
    VALUES (q.company_id, v_no, v_sup.supplier_id, q.deal_id, q.id, 'approved', 'approved',
      coalesce(q.currency, 'ZAR'), 0, 0, 0, v_addr,
      CASE WHEN v_lead IS NOT NULL THEN ((now() AT TIME ZONE 'Africa/Johannesburg')::date + v_lead) END,
      'For quote ' || coalesce(q.quote_number, ''), v_me, now(), v_me)
    RETURNING id INTO v_po;

    v_sort := 0;
    FOR l IN
      SELECT ql.*, rl.rfq_line_id AS r_line
        FROM public.commercial_quote_lines ql
        LEFT JOIN public.rfq_response_lines rl ON rl.id = ql.chosen_response_line_id
       WHERE ql.quote_id = q.id AND NOT coalesce(ql.is_excluded, false)
         AND ql.supply_mode = 'outsource' AND ql.supplier_id = v_sup.supplier_id
         AND NOT EXISTS (SELECT 1 FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.po_id
                          WHERE pl.quote_line_id = ql.id AND po.status <> 'cancelled')
       ORDER BY ql.sort_order
    LOOP
      v_sort := v_sort + 1;
      INSERT INTO public.purchase_order_lines (company_id, po_id, sort_order, rfq_line_id, rfq_response_line_id,
        inventory_item_id, quote_line_id, description, unit, quantity_ordered, unit_price, subtotal, vat_rate,
        vat_amount, line_total, quantity_received, quantity_invoiced)
      VALUES (q.company_id, v_po, v_sort, l.r_line, l.chosen_response_line_id, l.inventory_item_id, l.id,
        l.description, coalesce(l.unit, 'each'), l.quantity, round(coalesce(l.cost_price, 0), 2),
        round(l.quantity * coalesce(l.cost_price, 0), 2), v_rate,
        round(l.quantity * coalesce(l.cost_price, 0) * v_rate / 100, 2),
        round(l.quantity * coalesce(l.cost_price, 0) * (1 + v_rate / 100), 2), 0, 0);
    END LOOP;

    UPDATE public.purchase_orders po SET
      subtotal = t.s, vat_amount = t.v, total_amount = t.s + t.v, updated_at = now()
      FROM (SELECT coalesce(sum(subtotal), 0) s, coalesce(sum(vat_amount), 0) v FROM public.purchase_order_lines WHERE po_id = v_po) t
     WHERE po.id = v_po;

    v_made := v_made || jsonb_build_object('id', v_po, 'po_number', v_no, 'supplier_id', v_sup.supplier_id);
  END LOOP;

  SELECT count(*) INTO v_to_source FROM public.commercial_quote_lines ql
   WHERE ql.quote_id = q.id AND NOT coalesce(ql.is_excluded, false)
     AND ql.supply_mode = 'outsource' AND ql.supplier_id IS NULL;

  RETURN jsonb_build_object('created', v_made, 'to_source', v_to_source);
END $$;

-- ── Receive goods: one safe step ─────────────────────────────────────────────
-- p_lines: [{ "po_line_id": uuid, "qty": number, "notes": text? }]  (only lines with qty > 0 count)
CREATE OR REPLACE FUNCTION public.po_receive_goods(p_po_id uuid, p_delivery_note text, p_lines jsonb, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  v_me uuid;
  v_grn uuid;
  v_no text;
  v_bill uuid;
  v_sub numeric := 0;
  v_vat numeric := 0;
  v_n int := 0;
  v_line int := 0;
  x jsonb;
  pl public.purchase_order_lines%ROWTYPE;
  v_qty numeric;
  v_all boolean;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'goods_received.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF po.status IN ('cancelled', 'draft', 'pending_approval', 'rejected') THEN RAISE EXCEPTION 'PO_NOT_OPEN'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'NOTHING_RECEIVED'; END IF;
  v_me := public._my_employee_id(po.company_id);
  v_no := public.generate_grn_number(po.company_id);

  INSERT INTO public.goods_received_notes (company_id, grn_number, po_id, supplier_id, deal_id, status, received_date,
    received_by, delivery_note_number, notes, created_by)
  VALUES (po.company_id, v_no, po.id, po.supplier_id, po.deal_id, 'received', v_today, v_me,
    nullif(trim(coalesce(p_delivery_note, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), v_me)
  RETURNING id INTO v_grn;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := coalesce((x ->> 'qty')::numeric, 0);
    CONTINUE WHEN v_qty = 0;
    IF v_qty < 0 THEN RAISE EXCEPTION 'BAD_QUANTITY'; END IF;
    SELECT * INTO pl FROM public.purchase_order_lines WHERE id = (x ->> 'po_line_id')::uuid AND po_id = po.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LINE_NOT_ON_PO'; END IF;
    IF coalesce(pl.quantity_received, 0) + v_qty > pl.quantity_ordered THEN RAISE EXCEPTION 'MORE_THAN_ORDERED'; END IF;

    INSERT INTO public.goods_received_lines (company_id, grn_id, po_line_id, inventory_item_id, description, unit,
      quantity_expected, quantity_received, unit_cost, condition_notes)
    VALUES (po.company_id, v_grn, pl.id, pl.inventory_item_id, pl.description, pl.unit,
      pl.quantity_ordered - coalesce(pl.quantity_received, 0), v_qty, pl.unit_price, nullif(trim(coalesce(x ->> 'notes', '')), ''));

    UPDATE public.purchase_order_lines SET quantity_received = coalesce(quantity_received, 0) + v_qty WHERE id = pl.id;

    IF pl.inventory_item_id IS NOT NULL THEN
      PERFORM public.hr_inventory_stock_movement(po.company_id, pl.inventory_item_id, 'receive', v_qty, v_me, NULL,
        'Goods received ' || v_no || ' (' || coalesce(po.po_number, 'PO') || ')', pl.unit_price);
    END IF;

    v_sub := v_sub + round(v_qty * pl.unit_price, 2);
    v_vat := v_vat + round(v_qty * pl.unit_price * coalesce(pl.vat_rate, 0) / 100, 2);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOTHING_RECEIVED'; END IF;

  SELECT bool_and(coalesce(quantity_received, 0) >= quantity_ordered) INTO v_all FROM public.purchase_order_lines WHERE po_id = po.id;
  UPDATE public.purchase_orders SET
    status = CASE WHEN v_all THEN 'received' ELSE 'partially_received' END,
    actual_delivery_date = CASE WHEN v_all THEN v_today ELSE actual_delivery_date END,
    amount_received_value = (SELECT coalesce(sum(round(coalesce(quantity_received, 0) * unit_price, 2)), 0)
                               FROM public.purchase_order_lines WHERE po_id = po.id),
    updated_at = now()
  WHERE id = po.id;

  -- The delivery's own bill, waiting for approval (approval sends it to Xero).
  INSERT INTO public.supplier_invoices (company_id, supplier_id, po_id, grn_id, subtotal, vat_rate, vat_amount,
    total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, status, approval_status, currency, notes, created_by)
  VALUES (po.company_id, po.supplier_id, po.id, v_grn, v_sub,
    CASE WHEN v_sub > 0 THEN round(v_vat / v_sub * 100, 2) ELSE 0 END, v_vat, v_sub + v_vat, 0, v_sub + v_vat, false,
    'standard', 'received', 'pending', po.currency,
    'Delivery ' || v_no || ' on ' || coalesce(po.po_number, 'PO')
      || coalesce(' · delivery note ' || nullif(trim(coalesce(p_delivery_note, '')), ''), ''), v_me)
  RETURNING id INTO v_bill;

  FOR pl IN SELECT p.* FROM public.purchase_order_lines p JOIN public.goods_received_lines g ON g.po_line_id = p.id
             WHERE g.grn_id = v_grn ORDER BY p.sort_order LOOP
    v_line := v_line + 1;
    SELECT quantity_received INTO v_qty FROM public.goods_received_lines WHERE grn_id = v_grn AND po_line_id = pl.id;
    INSERT INTO public.supplier_invoice_lines (company_id, invoice_id, line_no, inventory_item_id, description, quantity,
      unit_price, discount_amount, discount_percent, subtotal, vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type)
    VALUES (po.company_id, v_bill, v_line, pl.inventory_item_id, pl.description, v_qty, pl.unit_price, 0, 0,
      round(v_qty * pl.unit_price, 2), coalesce(pl.vat_rate, 0), round(v_qty * pl.unit_price * coalesce(pl.vat_rate, 0) / 100, 2),
      round(v_qty * pl.unit_price * (1 + coalesce(pl.vat_rate, 0) / 100), 2), false, 'standard');
  END LOOP;

  RETURN jsonb_build_object('grn_id', v_grn, 'grn_number', v_no, 'bill_id', v_bill, 'fully_received', v_all);
END $$;

-- ── Fix a delivery's paperwork (delivery note / notes). Quantities: cancel it and receive again. ──
CREATE OR REPLACE FUNCTION public.goods_received_update(p_grn_id uuid, p_delivery_note text, p_notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.goods_received_notes%ROWTYPE;
BEGIN
  SELECT * INTO g FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND OR NOT (g.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(g.company_id, 'goods_received.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF g.status = 'cancelled' THEN RAISE EXCEPTION 'GRN_CANCELLED'; END IF;
  UPDATE public.goods_received_notes SET delivery_note_number = nullif(trim(coalesce(p_delivery_note, '')), ''),
    notes = nullif(trim(coalesce(p_notes, '')), '') WHERE id = g.id;
  UPDATE public.supplier_invoices SET notes = regexp_replace(coalesce(notes, ''), ' · delivery note .*$', '')
      || coalesce(' · delivery note ' || nullif(trim(coalesce(p_delivery_note, '')), ''), ''), updated_at = now()
   WHERE grn_id = g.id AND approval_status <> 'approved';
END $$;

-- ── Cancel a delivery: back off "received", stock out again, bill cancelled ──
CREATE OR REPLACE FUNCTION public.goods_received_cancel(p_grn_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g public.goods_received_notes%ROWTYPE;
  b public.supplier_invoices%ROWTYPE;
  r record;
  v_me uuid;
  v_any boolean;
BEGIN
  SELECT * INTO g FROM public.goods_received_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND OR NOT (g.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(g.company_id, 'goods_received.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF g.status = 'cancelled' THEN RETURN; END IF;
  SELECT * INTO b FROM public.supplier_invoices WHERE grn_id = g.id FOR UPDATE;
  IF FOUND AND (b.approval_status = 'approved' OR coalesce(b.amount_paid, 0) > 0) THEN
    RAISE EXCEPTION 'BILL_ALREADY_APPROVED';
  END IF;
  v_me := public._my_employee_id(g.company_id);
  IF g.po_id IS NOT NULL THEN PERFORM 1 FROM public.purchase_orders WHERE id = g.po_id FOR UPDATE; END IF;

  FOR r IN SELECT * FROM public.goods_received_lines WHERE grn_id = g.id LOOP
    IF r.po_line_id IS NOT NULL THEN
      UPDATE public.purchase_order_lines SET quantity_received = greatest(0, coalesce(quantity_received, 0) - r.quantity_received)
       WHERE id = r.po_line_id;
    END IF;
    IF r.inventory_item_id IS NOT NULL AND r.quantity_received > 0 THEN
      -- Fails with INSUFFICIENT_STOCK if the stock has been used since: the person is told.
      PERFORM public.hr_inventory_stock_movement(g.company_id, r.inventory_item_id, 'adjust', -r.quantity_received, v_me, NULL,
        'Delivery ' || coalesce(g.grn_number, '') || ' cancelled', r.unit_cost);
    END IF;
  END LOOP;

  UPDATE public.goods_received_notes SET status = 'cancelled',
    notes = concat_ws(' · ', notes, 'Cancelled' || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), '')) WHERE id = g.id;
  UPDATE public.supplier_invoices SET status = 'cancelled', updated_at = now() WHERE grn_id = g.id;

  IF g.po_id IS NOT NULL THEN
    SELECT bool_or(coalesce(quantity_received, 0) > 0) INTO v_any FROM public.purchase_order_lines WHERE po_id = g.po_id;
    UPDATE public.purchase_orders SET
      status = CASE WHEN status = 'cancelled' THEN status WHEN coalesce(v_any, false) THEN 'partially_received' ELSE 'sent' END,
      actual_delivery_date = NULL,
      amount_received_value = (SELECT coalesce(sum(round(coalesce(quantity_received, 0) * unit_price, 2)), 0)
                                 FROM public.purchase_order_lines WHERE po_id = g.po_id),
      updated_at = now()
    WHERE id = g.po_id;
  END IF;
END $$;

-- ── Edit a PO's quantities / prices until it is fully received ───────────────
-- p_lines: [{ "id": uuid, "quantity": number, "unit_price": number }]
CREATE OR REPLACE FUNCTION public.po_update_lines(p_po_id uuid, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE; x jsonb; pl public.purchase_order_lines%ROWTYPE; v_q numeric; v_p numeric;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'purchase_orders.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF po.status IN ('cancelled', 'received') THEN RAISE EXCEPTION 'PO_CLOSED'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO pl FROM public.purchase_order_lines WHERE id = (x ->> 'id')::uuid AND po_id = po.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LINE_NOT_ON_PO'; END IF;
    v_q := coalesce((x ->> 'quantity')::numeric, pl.quantity_ordered);
    v_p := coalesce((x ->> 'unit_price')::numeric, pl.unit_price);
    IF v_q <= 0 OR v_p < 0 THEN RAISE EXCEPTION 'BAD_QUANTITY'; END IF;
    IF v_q < coalesce(pl.quantity_received, 0) THEN RAISE EXCEPTION 'LESS_THAN_RECEIVED'; END IF;
    UPDATE public.purchase_order_lines SET quantity_ordered = v_q, unit_price = round(v_p, 2),
      subtotal = round(v_q * v_p, 2), vat_amount = round(v_q * v_p * coalesce(vat_rate, 0) / 100, 2),
      line_total = round(v_q * v_p * (1 + coalesce(vat_rate, 0) / 100), 2)
     WHERE id = pl.id;
  END LOOP;
  UPDATE public.purchase_orders p SET subtotal = t.s, vat_amount = t.v, total_amount = t.s + t.v,
    status = CASE WHEN t.all_in AND p.status IN ('partially_received') THEN 'received' ELSE p.status END,
    updated_at = now()
    FROM (SELECT coalesce(sum(subtotal), 0) s, coalesce(sum(vat_amount), 0) v,
                 bool_and(coalesce(quantity_received, 0) >= quantity_ordered) all_in
            FROM public.purchase_order_lines WHERE po_id = po.id) t
   WHERE p.id = po.id;
END $$;

-- ── Cancel a PO (nothing received yet): its items go back to "To source" ─────
CREATE OR REPLACE FUNCTION public.po_cancel(p_po_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'purchase_orders.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF po.status = 'cancelled' THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE po_id = po.id AND coalesce(quantity_received, 0) > 0) THEN
    RAISE EXCEPTION 'PO_HAS_DELIVERIES';
  END IF;
  UPDATE public.purchase_orders SET status = 'cancelled', updated_at = now(),
    internal_notes = concat_ws(E'\n', internal_notes, 'Cancelled ' || to_char(now() AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY')
      || coalesce(': ' || nullif(trim(coalesce(p_reason, '')), ''), ''))
   WHERE id = po.id;
END $$;

REVOKE ALL ON FUNCTION public.quote_process_order(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.po_receive_goods(uuid, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.goods_received_update(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.goods_received_cancel(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.po_update_lines(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.po_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_process_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.po_receive_goods(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.goods_received_update(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.goods_received_cancel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.po_update_lines(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.po_cancel(uuid, text) TO authenticated;
