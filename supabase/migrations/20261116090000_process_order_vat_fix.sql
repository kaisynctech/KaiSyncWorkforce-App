-- Piece 9a fix (16 Nov 2026): Process order used the supplier record's VAT flag when the Buyout switch was left
-- alone, so POs came out without VAT while the Buyout tab showed "Yes 15%". It now uses exactly the Buyout tab's rule.
-- Rollback: run the quote_process_order definition from 20261115090000_orders_pos_receiving.sql again.

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
    -- Does this supplier add VAT? The same rule as the Buyout tab's "Purchase orders to be created": the office's
    -- switch, else what the supplier said about their prices ("not VAT registered" = no). The supplier record's
    -- VAT flag is not used (it defaults to "no"). No Buyout row at all: VAT is added.
    v_vat := NULL;
    SELECT coalesce(r.charges_vat, coalesce(r.prices_include_vat, 'excl') <> 'none') INTO v_vat
      FROM public.rfq_recipients r JOIN public.rfqs f ON f.id = r.rfq_id
     WHERE f.quote_id = q.id AND f.is_buyout AND r.supplier_id = v_sup.supplier_id
     ORDER BY (r.charges_vat IS NOT NULL) DESC, r.updated_at DESC NULLS LAST LIMIT 1;
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
