-- New contractor quote drafts omit p_quote_id. PostgREST returns 404 when a
-- required parameter is missing. Allow null so create + update share one RPC.

CREATE OR REPLACE FUNCTION public.contractor_portal_save_quote_draft(
    p_contractor_id    uuid,
    p_company_id       uuid,
    p_quote_id         uuid DEFAULT NULL,
    p_title            text DEFAULT NULL,
    p_description      text DEFAULT NULL,
    p_quote_number     text DEFAULT NULL,
    p_valid_until      date DEFAULT NULL,
    p_vat_mode         text DEFAULT NULL,
    p_vat_rate         numeric DEFAULT NULL,
    p_discount         numeric DEFAULT NULL,
    p_freight          numeric DEFAULT NULL,
    p_duty             numeric DEFAULT NULL,
    p_levies           numeric DEFAULT NULL,
    p_other_charges    numeric DEFAULT NULL,
    p_terms            text DEFAULT NULL,
    p_contractor_notes text DEFAULT NULL,
    p_items            jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ct        public.contractors%ROWTYPE;
    v_quote_id  uuid := p_quote_id;
    v_subtotal  numeric := 0;
    v_taxable   numeric; v_vat numeric; v_total numeric; v_incl boolean;
    v_line_no   int := 1;
    item        jsonb;
    v_item_sub  numeric;
BEGIN
    SELECT * INTO v_ct FROM public.contractors
    WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;
    IF trim(coalesce(p_title,'')) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;

    IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'Quote items must be a JSON array (got jsonb type: %)', jsonb_typeof(p_items);
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
        v_item_sub := round(
            coalesce((item->>'quantity')::numeric, 1) * coalesce((item->>'unit_price')::numeric, 0)
            - coalesce((item->>'discount_amount')::numeric, 0), 4);
        v_subtotal := v_subtotal + v_item_sub;
    END LOOP;
    v_subtotal := round(v_subtotal, 2);

    SELECT o_taxable, o_vat, o_total, o_is_vat_inclusive
    INTO   v_taxable, v_vat, v_total, v_incl
    FROM   public._cq_compute_totals(
        v_subtotal, coalesce(p_discount,0), coalesce(p_freight,0),
        coalesce(p_duty,0), coalesce(p_levies,0), coalesce(p_other_charges,0),
        coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15));

    IF v_quote_id IS NULL THEN
        INSERT INTO public.contractor_quotes (
            company_id, contractor_id, quote_number, title, description,
            source_mode, vat_mode, vat_rate, is_vat_inclusive,
            subtotal, discount_amount, freight_amount, duty_amount,
            levies_amount, other_charges_amount, taxable_amount, vat_amount, total_amount,
            valid_until, terms, contractor_notes, status, created_at, updated_at
        ) VALUES (
            p_company_id, p_contractor_id,
            nullif(trim(coalesce(p_quote_number,'')), ''),
            trim(p_title), nullif(trim(coalesce(p_description,'')), ''),
            'manual', coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15), v_incl,
            v_subtotal, coalesce(p_discount,0), coalesce(p_freight,0), coalesce(p_duty,0),
            coalesce(p_levies,0), coalesce(p_other_charges,0), v_taxable, v_vat, v_total,
            p_valid_until,
            nullif(trim(coalesce(p_terms,'')), ''),
            nullif(trim(coalesce(p_contractor_notes,'')), ''),
            'draft', now(), now()
        ) RETURNING id INTO v_quote_id;
    ELSE
        UPDATE public.contractor_quotes SET
            quote_number         = nullif(trim(coalesce(p_quote_number,'')), ''),
            title                = trim(p_title),
            description          = nullif(trim(coalesce(p_description,'')), ''),
            vat_mode             = coalesce(p_vat_mode,'exclusive'),
            vat_rate             = coalesce(p_vat_rate,0.15),
            is_vat_inclusive     = v_incl,
            subtotal             = v_subtotal,
            discount_amount      = coalesce(p_discount,0),
            freight_amount       = coalesce(p_freight,0),
            duty_amount          = coalesce(p_duty,0),
            levies_amount        = coalesce(p_levies,0),
            other_charges_amount = coalesce(p_other_charges,0),
            taxable_amount       = v_taxable,
            vat_amount           = v_vat,
            total_amount         = v_total,
            valid_until          = p_valid_until,
            terms                = nullif(trim(coalesce(p_terms,'')), ''),
            contractor_notes     = nullif(trim(coalesce(p_contractor_notes,'')), ''),
            updated_at           = now()
        WHERE id            = v_quote_id
          AND contractor_id = p_contractor_id
          AND company_id    = p_company_id
          AND status IN ('draft', 'revision_requested');
        IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found or not in an editable state'; END IF;
        DELETE FROM public.contractor_quote_items WHERE quote_id = v_quote_id;
    END IF;

    v_line_no := 1;
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
        v_item_sub := round(
            coalesce((item->>'quantity')::numeric,1) * coalesce((item->>'unit_price')::numeric,0)
            - coalesce((item->>'discount_amount')::numeric,0), 4);
        INSERT INTO public.contractor_quote_items (
            quote_id, company_id, line_no, description,
            quantity, unit_price, discount_amount,
            subtotal, vat_rate, vat_amount, line_total,
            is_vat_inclusive, sort_order
        ) VALUES (
            v_quote_id, p_company_id, v_line_no,
            coalesce(item->>'description',''),
            coalesce((item->>'quantity')::numeric,1),
            coalesce((item->>'unit_price')::numeric,0),
            coalesce((item->>'discount_amount')::numeric,0),
            v_item_sub, 0, 0, v_item_sub, false, v_line_no
        );
        v_line_no := v_line_no + 1;
    END LOOP;

    RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_save_quote_draft(
  uuid, uuid, uuid, text, text, text, date, text, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb
) TO anon, authenticated;
