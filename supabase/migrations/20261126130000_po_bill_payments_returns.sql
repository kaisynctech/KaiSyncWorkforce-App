-- Purchase orders and goods received, the way the business works:
--  * One supplier bill per purchase order, made when the PO is sent (or when you first pay it). It follows the PO
--    when the supplier changes a price. Goods received no longer make bills (old POs that already have delivery
--    bills keep working the old way).
--  * Pay the supplier from the PO: full, deposit, part payments. Each payment goes to Xero on its own
--    (before: only once the bill was fully paid).
--  * Receiving records what arrived and what was sent back (damaged, wrong item ...). Sent back is not received,
--    is not stocked, and stays "still to come".
--  * A cancelled PO's bill: cancelled (and voided in Xero) when nothing was paid; otherwise kept, "to be refunded",
--    until the refund is recorded.

ALTER TABLE public.goods_received_lines
  ADD COLUMN IF NOT EXISTS quantity_rejected numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.supplier_invoices
  ADD COLUMN IF NOT EXISTS amount_refunded numeric NOT NULL DEFAULT 0;

-- The PO's own bill (not a delivery bill), if it has one.
CREATE OR REPLACE FUNCTION public._po_bill_of(p_po_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.supplier_invoices
   WHERE po_id = p_po_id AND grn_id IS NULL AND status <> 'cancelled'
   ORDER BY created_at LIMIT 1
$$;

-- Makes (p_create) or refreshes the PO's bill from its lines. NULL for a PO on the old flow (delivery bills).
CREATE OR REPLACE FUNCTION public._po_sync_bill(p_po_id uuid, p_create boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE; v_bill uuid; v_sub numeric; v_vat numeric; v_paid numeric; v_n int := 0; pl record;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND OR po.status = 'cancelled' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.supplier_invoices WHERE po_id = po.id AND grn_id IS NOT NULL AND status <> 'cancelled') THEN
    RETURN NULL;   -- old flow: each delivery has its own bill
  END IF;
  SELECT coalesce(sum(round(quantity_ordered * unit_price, 2)), 0),
         coalesce(sum(round(quantity_ordered * unit_price * coalesce(vat_rate, 0), 2)), 0)
    INTO v_sub, v_vat FROM public.purchase_order_lines WHERE po_id = po.id;
  v_bill := public._po_bill_of(po.id);

  IF v_bill IS NULL THEN
    IF NOT p_create THEN RETURN NULL; END IF;
    INSERT INTO public.supplier_invoices (company_id, supplier_id, po_id, project_id, subtotal, vat_rate, vat_amount,
      total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, status, approval_status, approved_at, approved_by,
      currency, exchange_rate, rate_source, due_date, notes, created_by)
    VALUES (po.company_id, po.supplier_id, po.id, po.deal_id, v_sub, CASE WHEN v_sub > 0 THEN round(v_vat / v_sub, 4) ELSE 0 END,
      v_vat, v_sub + v_vat, 0, v_sub + v_vat, false, 'standard', 'approved', 'approved', now(), public._my_employee_id(po.company_id),
      po.currency, po.exchange_rate, po.rate_source, po.required_delivery_date,
      'Purchase order ' || coalesce(po.po_number, ''), public._my_employee_id(po.company_id))
    RETURNING id INTO v_bill;
  ELSE
    SELECT coalesce(amount_paid, 0) INTO v_paid FROM public.supplier_invoices WHERE id = v_bill;
    UPDATE public.supplier_invoices SET subtotal = v_sub, vat_amount = v_vat, total_amount = v_sub + v_vat,
      vat_rate = CASE WHEN v_sub > 0 THEN round(v_vat / v_sub, 4) ELSE vat_rate END,
      balance_due = greatest(round(v_sub + v_vat - v_paid, 2), 0),
      status = CASE WHEN v_paid >= round(v_sub + v_vat, 2) - 0.005 AND v_paid > 0 THEN 'paid' WHEN v_paid > 0 THEN 'partially_paid' ELSE 'approved' END,
      updated_at = now()
     WHERE id = v_bill;
    DELETE FROM public.supplier_invoice_lines WHERE invoice_id = v_bill;
  END IF;

  FOR pl IN SELECT * FROM public.purchase_order_lines WHERE po_id = po.id ORDER BY sort_order LOOP
    v_n := v_n + 1;
    INSERT INTO public.supplier_invoice_lines (company_id, invoice_id, line_no, inventory_item_id, description, quantity,
      unit_price, discount_amount, discount_percent, subtotal, vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type)
    VALUES (po.company_id, v_bill, v_n, pl.inventory_item_id, pl.description, pl.quantity_ordered, pl.unit_price, 0, 0,
      round(pl.quantity_ordered * pl.unit_price, 2), coalesce(pl.vat_rate, 0), round(pl.quantity_ordered * pl.unit_price * coalesce(pl.vat_rate, 0), 2),
      round(pl.quantity_ordered * pl.unit_price * (1 + coalesce(pl.vat_rate, 0)), 2), false, 'standard');
  END LOOP;
  RETURN v_bill;
END $$;
REVOKE ALL ON FUNCTION public._po_sync_bill(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._po_bill_of(uuid) FROM PUBLIC, anon;

-- Sent to the supplier → the bill is made. Cancelled → its bill is cancelled if nothing was paid.
CREATE OR REPLACE FUNCTION public._trg_po_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill uuid;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.supplier_invoices SET status = 'cancelled', updated_at = now()
     WHERE po_id = NEW.id AND grn_id IS NULL AND status <> 'cancelled' AND coalesce(amount_paid, 0) = 0;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('sent', 'partially_received', 'received') AND public._po_bill_of(NEW.id) IS NULL THEN
    v_bill := public._po_sync_bill(NEW.id, true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_bill ON public.purchase_orders;
CREATE TRIGGER trg_po_bill AFTER UPDATE OF status, sent_at ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public._trg_po_bill();

-- The versions being replaced are kept (renamed) so the undo script can put them back exactly.
ALTER FUNCTION public.po_update_lines(uuid, jsonb) RENAME TO po_update_lines_before_20261126;
ALTER FUNCTION public.po_receive_goods(uuid, text, jsonb, text) RENAME TO po_receive_goods_before_20261126;
ALTER FUNCTION public._trg_xero_supplier_invoice() RENAME TO _trg_xero_supplier_invoice_before_20261126;
REVOKE ALL ON FUNCTION public.po_update_lines_before_20261126(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.po_receive_goods_before_20261126(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- Price / qty change: the PO's bill follows.
CREATE FUNCTION public.po_update_lines(p_po_id uuid, p_lines jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE po public.purchase_orders%ROWTYPE; x jsonb; pl public.purchase_order_lines%ROWTYPE; v_q numeric; v_p numeric; v_bill uuid;
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
      subtotal = round(v_q * v_p, 2), vat_amount = round(v_q * v_p * coalesce(vat_rate, 0), 2),
      line_total = round(v_q * v_p * (1 + coalesce(vat_rate, 0)), 2)
     WHERE id = pl.id;
  END LOOP;
  UPDATE public.purchase_orders p SET subtotal = t.s, vat_amount = t.v, total_amount = t.s + t.v,
    status = CASE WHEN t.all_in AND p.status IN ('partially_received') THEN 'received' ELSE p.status END,
    updated_at = now()
    FROM (SELECT coalesce(sum(subtotal), 0) s, coalesce(sum(vat_amount), 0) v,
                 bool_and(coalesce(quantity_received, 0) >= quantity_ordered) all_in
            FROM public.purchase_order_lines WHERE po_id = po.id) t
   WHERE p.id = po.id;
  v_bill := public._po_sync_bill(po.id, false);
END $function$;
GRANT EXECUTE ON FUNCTION public.po_update_lines(uuid, jsonb) TO authenticated;

-- Pay the supplier for a PO: full, deposit or part. Adds the supplier's own invoice number when given.
CREATE OR REPLACE FUNCTION public.po_pay_supplier(p_po_id uuid, p_amount numeric, p_date date, p_method text,
  p_reference text, p_supplier_invoice_no text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE po public.purchase_orders%ROWTYPE; v_bill uuid;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'payments.approve') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF po.status IN ('cancelled', 'draft', 'pending_approval', 'rejected') THEN RAISE EXCEPTION 'PO_NOT_OPEN'; END IF;
  v_bill := public._po_sync_bill(po.id, true);
  IF v_bill IS NULL THEN RAISE EXCEPTION 'OLD_DELIVERY_BILLS'; END IF;
  IF nullif(trim(coalesce(p_supplier_invoice_no, '')), '') IS NOT NULL THEN
    UPDATE public.supplier_invoices SET invoice_number = trim(p_supplier_invoice_no), updated_at = now() WHERE id = v_bill;
  END IF;
  RETURN public.record_supplier_payment(po.company_id, v_bill, p_amount, p_method, p_date, p_reference, NULL);
END $function$;
GRANT EXECUTE ON FUNCTION public.po_pay_supplier(uuid, numeric, date, text, text, text) TO authenticated;

-- A cancelled PO that was (partly) paid: record the supplier's refund.
CREATE OR REPLACE FUNCTION public.po_record_refund(p_po_id uuid, p_amount numeric, p_date date, p_reference text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE po public.purchase_orders%ROWTYPE; b public.supplier_invoices%ROWTYPE; v_amt numeric := round(coalesce(p_amount, 0), 2);
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'payments.approve') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT * INTO b FROM public.supplier_invoices WHERE po_id = po.id AND grn_id IS NULL AND status <> 'cancelled'
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTHING_TO_REFUND'; END IF;
  IF v_amt <= 0 OR v_amt > round(coalesce(b.amount_paid, 0) - coalesce(b.amount_refunded, 0), 2) + 0.005 THEN RAISE EXCEPTION 'BAD_AMOUNT'; END IF;
  UPDATE public.supplier_invoices SET amount_refunded = round(coalesce(amount_refunded, 0) + v_amt, 2), updated_at = now() WHERE id = b.id;
  INSERT INTO public.finance_transactions (company_id, transaction_type, direction, source_table, source_id,
    reference_number, amount, total_amount, transaction_date, payment_method, notes, created_by)
  VALUES (po.company_id, 'refund', 'incoming', 'supplier_invoices', b.id, nullif(trim(coalesce(p_reference, '')), ''),
    v_amt, v_amt, coalesce(p_date, (now() AT TIME ZONE 'Africa/Johannesburg')::date), 'refund',
    'Refund from supplier for cancelled ' || coalesce(po.po_number, 'PO'), public._my_employee_id(po.company_id));
END $function$;
GRANT EXECUTE ON FUNCTION public.po_record_refund(uuid, numeric, date, text) TO authenticated;

-- Receiving: what arrived, and what was sent back (not received, not stocked, still to come).
-- p_lines: [{ po_line_id, qty (arrived), rejected, reason }]
CREATE FUNCTION public.po_receive_goods(p_po_id uuid, p_delivery_note text, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  po public.purchase_orders%ROWTYPE;
  v_me uuid; v_grn uuid; v_no text; v_bill uuid := NULL;
  v_sub numeric := 0; v_vat numeric := 0; v_n int := 0; v_line int := 0;
  x jsonb; pl public.purchase_order_lines%ROWTYPE;
  v_qty numeric; v_rej numeric; v_keep numeric; v_all boolean; v_old boolean;
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND OR NOT (po.company_id = ANY (public.user_company_ids()))
     OR NOT public.user_has_permission(po.company_id, 'goods_received.edit') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF po.status IN ('cancelled', 'draft', 'pending_approval', 'rejected') THEN RAISE EXCEPTION 'PO_NOT_OPEN'; END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'NOTHING_RECEIVED'; END IF;
  v_old := EXISTS (SELECT 1 FROM public.supplier_invoices WHERE po_id = po.id AND grn_id IS NOT NULL AND status <> 'cancelled');
  v_me := public._my_employee_id(po.company_id);
  v_no := public.generate_grn_number(po.company_id);

  INSERT INTO public.goods_received_notes (company_id, grn_number, po_id, supplier_id, deal_id, status, received_date,
    received_by, delivery_note_number, notes, created_by)
  VALUES (po.company_id, v_no, po.id, po.supplier_id, po.deal_id, 'received', v_today, v_me,
    nullif(trim(coalesce(p_delivery_note, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), v_me)
  RETURNING id INTO v_grn;

  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := coalesce((x ->> 'qty')::numeric, 0);
    v_rej := coalesce((x ->> 'rejected')::numeric, 0);
    CONTINUE WHEN v_qty = 0 AND v_rej = 0;
    IF v_qty < 0 OR v_rej < 0 OR v_rej > v_qty THEN RAISE EXCEPTION 'BAD_QUANTITY'; END IF;
    v_keep := v_qty - v_rej;
    SELECT * INTO pl FROM public.purchase_order_lines WHERE id = (x ->> 'po_line_id')::uuid AND po_id = po.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LINE_NOT_ON_PO'; END IF;
    IF coalesce(pl.quantity_received, 0) + v_keep > pl.quantity_ordered THEN RAISE EXCEPTION 'MORE_THAN_ORDERED'; END IF;

    INSERT INTO public.goods_received_lines (company_id, grn_id, po_line_id, inventory_item_id, description, unit,
      quantity_expected, quantity_received, quantity_rejected, reject_reason, unit_cost, condition_notes)
    VALUES (po.company_id, v_grn, pl.id, pl.inventory_item_id, pl.description, pl.unit,
      pl.quantity_ordered - coalesce(pl.quantity_received, 0), v_keep, v_rej,
      CASE WHEN v_rej > 0 THEN nullif(trim(coalesce(x ->> 'reason', '')), '') END, pl.unit_price,
      nullif(trim(coalesce(x ->> 'notes', '')), ''));

    IF v_keep > 0 THEN
      UPDATE public.purchase_order_lines SET quantity_received = coalesce(quantity_received, 0) + v_keep WHERE id = pl.id;
      IF pl.inventory_item_id IS NOT NULL THEN
        PERFORM public.hr_inventory_stock_movement(po.company_id, pl.inventory_item_id, 'receive', v_keep, v_me, NULL,
          'Goods received ' || v_no || ' (' || coalesce(po.po_number, 'PO') || ')', pl.unit_price);
      END IF;
    END IF;
    v_sub := v_sub + round(v_keep * pl.unit_price, 2);
    v_vat := v_vat + round(v_keep * pl.unit_price * coalesce(pl.vat_rate, 0), 2);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'NOTHING_RECEIVED'; END IF;

  SELECT bool_and(coalesce(quantity_received, 0) >= quantity_ordered) INTO v_all FROM public.purchase_order_lines WHERE po_id = po.id;
  UPDATE public.purchase_orders SET
    status = CASE WHEN v_all THEN 'received' WHEN EXISTS (SELECT 1 FROM public.purchase_order_lines WHERE po_id = po.id AND coalesce(quantity_received, 0) > 0)
                  THEN 'partially_received' ELSE status END,
    actual_delivery_date = CASE WHEN v_all THEN v_today ELSE actual_delivery_date END,
    amount_received_value = (SELECT coalesce(sum(round(coalesce(quantity_received, 0) * unit_price, 2)), 0)
                               FROM public.purchase_order_lines WHERE po_id = po.id),
    updated_at = now()
  WHERE id = po.id;

  IF v_old AND v_sub > 0 THEN
    -- Old flow only (this PO already has delivery bills): this delivery's own bill, waiting for approval.
    INSERT INTO public.supplier_invoices (company_id, supplier_id, po_id, grn_id, subtotal, vat_rate, vat_amount,
      total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, status, approval_status, currency, notes, created_by)
    VALUES (po.company_id, po.supplier_id, po.id, v_grn, v_sub,
      CASE WHEN v_sub > 0 THEN round(v_vat / v_sub, 4) ELSE 0 END, v_vat, v_sub + v_vat, 0, v_sub + v_vat, false,
      'standard', 'received', 'pending', po.currency,
      'Delivery ' || v_no || ' on ' || coalesce(po.po_number, 'PO')
        || coalesce(' · delivery note ' || nullif(trim(coalesce(p_delivery_note, '')), ''), ''), v_me)
    RETURNING id INTO v_bill;
    FOR pl IN SELECT p.* FROM public.purchase_order_lines p JOIN public.goods_received_lines g ON g.po_line_id = p.id
               WHERE g.grn_id = v_grn AND g.quantity_received > 0 ORDER BY p.sort_order LOOP
      v_line := v_line + 1;
      SELECT quantity_received INTO v_qty FROM public.goods_received_lines WHERE grn_id = v_grn AND po_line_id = pl.id;
      INSERT INTO public.supplier_invoice_lines (company_id, invoice_id, line_no, inventory_item_id, description, quantity,
        unit_price, discount_amount, discount_percent, subtotal, vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type)
      VALUES (po.company_id, v_bill, v_line, pl.inventory_item_id, pl.description, v_qty, pl.unit_price, 0, 0,
        round(v_qty * pl.unit_price, 2), coalesce(pl.vat_rate, 0), round(v_qty * pl.unit_price * coalesce(pl.vat_rate, 0), 2),
        round(v_qty * pl.unit_price * (1 + coalesce(pl.vat_rate, 0)), 2), false, 'standard');
    END LOOP;
  ELSIF NOT v_old THEN
    v_bill := public._po_sync_bill(po.id, true);   -- a PO received before it was marked sent still gets its bill
  END IF;

  RETURN jsonb_build_object('grn_id', v_grn, 'grn_number', v_no, 'bill_id', v_bill, 'fully_received', v_all);
END $function$;
GRANT EXECUTE ON FUNCTION public.po_receive_goods(uuid, text, jsonb, text) TO authenticated;

-- Xero: each supplier payment goes on its own; a cancelled bill is voided there.
CREATE FUNCTION public._trg_xero_supplier_invoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_label text := 'Supplier invoice ' || coalesce(NEW.invoice_number, NEW.bill_number, '');
BEGIN
  IF NEW.approval_status = 'approved' AND (TG_OP = 'INSERT' OR OLD.approval_status IS DISTINCT FROM 'approved'
       OR NEW.total_amount IS DISTINCT FROM OLD.total_amount) AND NEW.status <> 'cancelled' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_bill', NEW.id, v_label, coalesce(NEW.approved_at::date, NEW.created_at::date));
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND EXISTS (SELECT 1 FROM public.xero_doc_links WHERE company_id = NEW.company_id AND entity = 'supplier_bill' AND record_id = NEW.id) THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_bill', NEW.id, v_label || ' (void)', NULL);
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_xero_supplier_invoice ON public.supplier_invoices;
CREATE TRIGGER trg_xero_supplier_invoice AFTER INSERT OR UPDATE OF approval_status, status, total_amount ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_supplier_invoice();

CREATE OR REPLACE FUNCTION public._trg_xero_supplier_payment_tx() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.transaction_type = 'supplier_payment' AND NEW.direction = 'outgoing' AND NEW.source_table = 'supplier_invoices' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_payment', NEW.id,
      'Supplier payment ' || coalesce(NEW.reference_number, ''), NEW.transaction_date);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_xero_supplier_payment_tx ON public.finance_transactions;
CREATE TRIGGER trg_xero_supplier_payment_tx AFTER INSERT ON public.finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_supplier_payment_tx();
