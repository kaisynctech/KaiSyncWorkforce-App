-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: contractor_quotes_defensive_jsonb_guard
--
-- Adds a jsonb_typeof() guard before both jsonb_array_elements() calls inside
-- contractor_portal_save_quote_draft.
--
-- Root cause that prompted this:
--   The C# service was passing p_items as a pre-serialised JSON *string* rather
--   than a native JArray/List object.  The Supabase SDK then double-encoded it,
--   so PostgreSQL received p_items as a JSONB scalar (type = "string").
--   jsonb_array_elements(scalar) → ERROR 22023 "cannot extract elements from a scalar".
--
-- The primary fix is in the C# service (pass List directly, not SerializeObject).
-- This migration adds a server-side safety net that produces a clear error message
-- if the same serialisation mistake is reintroduced in future.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_save_quote_draft(
    p_contractor_id  uuid,
    p_company_id     uuid,
    p_quote_id       uuid,
    p_title          text,
    p_description    text,
    p_quote_number   text,
    p_valid_until    date,
    p_vat_mode       text,
    p_vat_rate       numeric,
    p_discount       numeric,
    p_freight        numeric,
    p_duty           numeric,
    p_levies         numeric,
    p_other_charges  numeric,
    p_terms          text,
    p_contractor_notes text,
    p_items          jsonb
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

    -- ── Defensive guard ────────────────────────────────────────────────────
    -- p_items must be a JSON array.  If the C# layer accidentally passes a
    -- pre-serialised string (double-encoding), jsonb_typeof returns 'string'
    -- and we get ERROR 22023 deep inside the loop with a confusing message.
    -- Raise a clear exception here instead.
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'Quote items must be a JSON array (got jsonb type: %)', jsonb_typeof(p_items);
    END IF;

    -- Sum line item subtotals (VAT is quote-level, not per-item)
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
            quote_number=nullif(trim(coalesce(p_quote_number,'')), ''),
            title=trim(p_title), description=nullif(trim(coalesce(p_description,'')), ''),
            vat_mode=coalesce(p_vat_mode,'exclusive'), vat_rate=coalesce(p_vat_rate,0.15),
            is_vat_inclusive=v_incl,
            subtotal=v_subtotal, discount_amount=coalesce(p_discount,0),
            freight_amount=coalesce(p_freight,0), duty_amount=coalesce(p_duty,0),
            levies_amount=coalesce(p_levies,0), other_charges_amount=coalesce(p_other_charges,0),
            taxable_amount=v_taxable, vat_amount=v_vat, total_amount=v_total,
            valid_until=p_valid_until,
            terms=nullif(trim(coalesce(p_terms,'')), ''),
            contractor_notes=nullif(trim(coalesce(p_contractor_notes,'')), ''),
            updated_at=now()
        WHERE id=v_quote_id AND contractor_id=p_contractor_id
          AND company_id=p_company_id AND status='draft';
        IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or not editable'; END IF;
        DELETE FROM public.contractor_quote_items WHERE quote_id=v_quote_id;
    END IF;

    -- ── Insert line items ──────────────────────────────────────────────────
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
$$;;
