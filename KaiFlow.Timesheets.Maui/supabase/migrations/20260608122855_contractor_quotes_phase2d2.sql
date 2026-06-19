-- Migration: 20260608122855_contractor_quotes_phase2d2
-- Contractor quote submission, retrieval and draft saving functions (phase 2d2)
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_submit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_ct    public.contractors%ROWTYPE;
    v_quote public.contractor_quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    SELECT * INTO v_quote
    FROM   public.contractor_quotes
    WHERE  id = p_quote_id AND contractor_id = p_contractor_id
      AND  company_id = p_company_id AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;

    IF v_quote.total_amount <= 0 AND NOT EXISTS (
        SELECT 1 FROM public.contractor_quote_items WHERE quote_id = p_quote_id
    ) THEN RAISE EXCEPTION 'Quote must have at least one line item or a total amount'; END IF;

    -- Capture branding snapshot at submission time
    UPDATE public.contractor_quotes
    SET
        status            = 'submitted',
        submitted_at      = now(),
        updated_at        = now(),
        -- Auto-generate quote number if not set
        quote_number      = coalesce(quote_number,
                              public.generate_contractor_quote_number(p_company_id, p_contractor_id)),
        -- Branding snapshot
        sender_name       = v_ct.name,
        sender_reg_number = v_ct.registration_number,
        sender_vat_number = v_ct.vat_number
    WHERE id = p_quote_id;

    -- Activity log
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal', 'contractor_quote_submitted', 'info',
        jsonb_build_object(
            'contractor_id', p_contractor_id,
            'quote_id',      p_quote_id,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount
        ),
        now()
    );

    -- HR notifications
    PERFORM public.notify_hr_contractor_quote(
        p_company_id, p_contractor_id, v_ct.name,
        coalesce(v_quote.quote_number, p_quote_id::text),
        v_quote.total_amount
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_submit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_submit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_get_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_quote       record;
    v_items       json;
    v_attachments json;
BEGIN
    SELECT * INTO v_quote
    FROM   public.contractor_quotes
    WHERE  id            = p_quote_id
      AND  contractor_id = p_contractor_id
      AND  company_id    = p_company_id;

    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT coalesce(json_agg(row_to_json(i) ORDER BY i.sort_order, i.line_no), '[]'::json)
    INTO   v_items
    FROM   public.contractor_quote_items i
    WHERE  i.quote_id = p_quote_id;

    SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.is_primary DESC, a.created_at), '[]'::json)
    INTO   v_attachments
    FROM   public.contractor_quote_attachments a
    WHERE  a.quote_id = p_quote_id;

    RETURN json_build_object(
        'id',                   v_quote.id,
        'quote_number',         v_quote.quote_number,
        'title',                v_quote.title,
        'description',          v_quote.description,
        'source_mode',          v_quote.source_mode,
        'currency',             v_quote.currency,
        'subtotal',             v_quote.subtotal,
        'discount_amount',      v_quote.discount_amount,
        'freight_amount',       v_quote.freight_amount,
        'duty_amount',          v_quote.duty_amount,
        'levies_amount',        v_quote.levies_amount,
        'other_charges_amount', v_quote.other_charges_amount,
        'taxable_amount',       v_quote.taxable_amount,
        'vat_mode',             v_quote.vat_mode,
        'vat_rate',             v_quote.vat_rate,
        'vat_amount',           v_quote.vat_amount,
        'total_amount',         v_quote.total_amount,
        'is_vat_inclusive',     v_quote.is_vat_inclusive,
        'quote_date',           v_quote.quote_date,
        'valid_until',          v_quote.valid_until,
        'status',               CASE
                                    WHEN v_quote.status IN ('submitted','under_review',
                                                            'revision_requested','approved')
                                         AND v_quote.valid_until IS NOT NULL
                                         AND v_quote.valid_until < CURRENT_DATE
                                    THEN 'expired' ELSE v_quote.status END,
        'terms',                v_quote.terms,
        'contractor_notes',     v_quote.contractor_notes,
        'revision_comments',    v_quote.revision_comments,
        'rejection_reason',     v_quote.rejection_reason,
        'converted_to_job_id',  v_quote.converted_to_job_id,
        'converted_at',         v_quote.converted_at,
        'submitted_at',         v_quote.submitted_at,
        'reviewed_at',          v_quote.reviewed_at,
        'created_at',           v_quote.created_at,
        'updated_at',           v_quote.updated_at,
        'items',                v_items,
        'attachments',          v_attachments
    );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_quote(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_list_quotes(p_contractor_id uuid, p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true
    ) THEN RETURN '[]'::json; END IF;

    RETURN coalesce((
        SELECT json_agg(row_to_json(q) ORDER BY q.sort_order, q.created_at DESC)
        FROM (
            SELECT
                id, quote_number, title, description, source_mode, currency,
                subtotal, discount_amount,
                freight_amount, duty_amount, levies_amount, other_charges_amount,
                taxable_amount, vat_mode, vat_rate, vat_amount, total_amount,
                is_vat_inclusive,
                quote_date, valid_until,
                CASE
                    WHEN status IN ('submitted','under_review','revision_requested','approved')
                         AND valid_until IS NOT NULL
                         AND valid_until < CURRENT_DATE
                    THEN 'expired'
                    ELSE status
                END AS status,
                contractor_notes, revision_comments, rejection_reason,
                converted_to_job_id, converted_at,
                submitted_at, reviewed_at, created_at, updated_at,
                CASE status
                    WHEN 'revision_requested' THEN 0
                    WHEN 'draft'              THEN 1
                    WHEN 'submitted'          THEN 2
                    WHEN 'under_review'       THEN 3
                    ELSE 4
                END AS sort_order
            FROM public.contractor_quotes
            WHERE contractor_id = p_contractor_id
              AND company_id    = p_company_id
        ) q
    ), '[]'::json);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_list_quotes(p_contractor_id uuid, p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_list_quotes(p_contractor_id uuid, p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_quotes(p_contractor_id uuid, p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_quotes(p_contractor_id uuid, p_company_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_save_quote_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid, p_title text, p_description text, p_quote_number text, p_valid_until date, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_terms text, p_contractor_notes text, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Defensive guard: p_items must arrive as a JSON array
    IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
        RAISE EXCEPTION 'Quote items must be a JSON array (got jsonb type: %)', jsonb_typeof(p_items);
    END IF;

    -- Sum line item subtotals
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
        -- Phase 2D.3: also allow editing revision_requested quotes
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
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_save_quote_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid, p_title text, p_description text, p_quote_number text, p_valid_until date, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_terms text, p_contractor_notes text, p_items jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_save_quote_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid, p_title text, p_description text, p_quote_number text, p_valid_until date, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_terms text, p_contractor_notes text, p_items jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_save_quote_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid, p_title text, p_description text, p_quote_number text, p_valid_until date, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_terms text, p_contractor_notes text, p_items jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_save_quote_draft(p_contractor_id uuid, p_company_id uuid, p_quote_id uuid, p_title text, p_description text, p_quote_number text, p_valid_until date, p_vat_mode text, p_vat_rate numeric, p_discount numeric, p_freight numeric, p_duty numeric, p_levies numeric, p_other_charges numeric, p_terms text, p_contractor_notes text, p_items jsonb) TO service_role;

