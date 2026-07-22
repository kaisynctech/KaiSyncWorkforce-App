-- Phase 2D.2 polish: VAT modes, charges/discounts, server-side calculation.

-- ── 1. New columns ────────────────────────────────────────────────────────────

ALTER TABLE public.contractor_quotes
  ADD COLUMN IF NOT EXISTS vat_mode             text    NOT NULL DEFAULT 'exclusive'
    CHECK (vat_mode IN ('none', 'exclusive', 'inclusive')),
  ADD COLUMN IF NOT EXISTS freight_amount       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duty_amount          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS levies_amount        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount       numeric NOT NULL DEFAULT 0;


-- ── 2. Server-side totals helper ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._cq_compute_totals(
    p_subtotal numeric, p_discount numeric,
    p_freight  numeric, p_duty    numeric,
    p_levies   numeric, p_other   numeric,
    p_vat_mode text,    p_vat_rate numeric,
    OUT o_taxable          numeric,
    OUT o_vat              numeric,
    OUT o_total            numeric,
    OUT o_is_vat_inclusive boolean
)
LANGUAGE plpgsql AS $$
BEGIN
    o_taxable := round(
        coalesce(p_subtotal,0) - coalesce(p_discount,0)
        + coalesce(p_freight,0) + coalesce(p_duty,0)
        + coalesce(p_levies,0)  + coalesce(p_other,0),
    4);

    CASE coalesce(p_vat_mode,'exclusive')
        WHEN 'none' THEN
            o_vat := 0; o_total := o_taxable; o_is_vat_inclusive := false;
        WHEN 'inclusive' THEN
            o_vat := round(o_taxable * p_vat_rate / (1 + p_vat_rate), 4);
            o_total := o_taxable; o_is_vat_inclusive := true;
        ELSE  -- exclusive
            o_vat := round(o_taxable * p_vat_rate, 4);
            o_total := o_taxable + o_vat; o_is_vat_inclusive := false;
    END CASE;

    o_vat := round(o_vat, 2); o_total := round(o_total, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION public._cq_compute_totals TO anon, authenticated;


-- ── 3. New contractor_portal_save_quote_draft ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_save_quote_draft(
    p_contractor_id    uuid,
    p_company_id       uuid,
    p_quote_id         uuid,
    p_title            text,
    p_description      text,
    p_quote_number     text,
    p_valid_until      date,
    p_vat_mode         text,
    p_vat_rate         numeric,
    p_discount         numeric,
    p_freight          numeric,
    p_duty             numeric,
    p_levies           numeric,
    p_other_charges    numeric,
    p_terms            text,
    p_contractor_notes text,
    p_items            jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.contractor_portal_save_quote_draft TO anon, authenticated;


-- ── 4. New contractor_portal_upload_quote ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_upload_quote(
    p_contractor_id    uuid,
    p_company_id       uuid,
    p_title            text,
    p_description      text,
    p_quote_number     text,
    p_amount           numeric,
    p_vat_mode         text,
    p_vat_rate         numeric,
    p_discount         numeric,
    p_freight          numeric,
    p_duty             numeric,
    p_levies           numeric,
    p_other_charges    numeric,
    p_valid_until      date,
    p_contractor_notes text,
    p_file_url         text,
    p_file_name        text,
    p_storage_path     text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ct        public.contractors%ROWTYPE;
    v_quote_id  uuid;
    v_qnum      text;
    v_taxable   numeric; v_vat numeric; v_total numeric; v_incl boolean;
BEGIN
    SELECT * INTO v_ct FROM public.contractors
    WHERE id=p_contractor_id AND company_id=p_company_id AND is_active=true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;
    IF trim(coalesce(p_title,''))=''    THEN RAISE EXCEPTION 'Title is required'; END IF;
    IF trim(coalesce(p_file_url,''))='' THEN RAISE EXCEPTION 'File URL is required'; END IF;

    v_qnum := coalesce(nullif(trim(coalesce(p_quote_number,'')), ''),
              public.generate_contractor_quote_number(p_company_id, p_contractor_id));

    SELECT o_taxable, o_vat, o_total, o_is_vat_inclusive
    INTO   v_taxable, v_vat, v_total, v_incl
    FROM   public._cq_compute_totals(
        coalesce(p_amount,0), coalesce(p_discount,0), coalesce(p_freight,0),
        coalesce(p_duty,0), coalesce(p_levies,0), coalesce(p_other_charges,0),
        coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15));

    INSERT INTO public.contractor_quotes (
        company_id, contractor_id, quote_number, title, description,
        source_mode, vat_mode, vat_rate, is_vat_inclusive,
        subtotal, discount_amount, freight_amount, duty_amount,
        levies_amount, other_charges_amount, taxable_amount, vat_amount, total_amount,
        valid_until, contractor_notes, status, submitted_at,
        sender_name, sender_reg_number, sender_vat_number, created_at, updated_at
    ) VALUES (
        p_company_id, p_contractor_id, v_qnum, trim(p_title),
        nullif(trim(coalesce(p_description,'')), ''),
        'upload', coalesce(p_vat_mode,'exclusive'), coalesce(p_vat_rate,0.15), v_incl,
        coalesce(p_amount,0), coalesce(p_discount,0), coalesce(p_freight,0),
        coalesce(p_duty,0), coalesce(p_levies,0), coalesce(p_other_charges,0),
        v_taxable, v_vat, v_total,
        p_valid_until, nullif(trim(coalesce(p_contractor_notes,'')), ''),
        'submitted', now(),
        v_ct.name, v_ct.registration_number, v_ct.vat_number, now(), now()
    ) RETURNING id INTO v_quote_id;

    INSERT INTO public.contractor_quote_attachments (
        quote_id, company_id, contractor_id, file_name, file_url, storage_path, is_primary, uploaded_by
    ) VALUES (v_quote_id, p_company_id, p_contractor_id, p_file_name, p_file_url, p_storage_path, true, 'contractor_portal');

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (p_company_id, NULL, 'ContractorPortal', 'contractor_quote_submitted', 'info',
        jsonb_build_object('contractor_id',p_contractor_id,'quote_id',v_quote_id,
            'quote_number',v_qnum,'total_amount',v_total,'source_mode','upload'), now());

    PERFORM public.notify_hr_contractor_quote(p_company_id, p_contractor_id, v_ct.name, v_qnum, v_total);

    RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_upload_quote TO anon, authenticated;;
