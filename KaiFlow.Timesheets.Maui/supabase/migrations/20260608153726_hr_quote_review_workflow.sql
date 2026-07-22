-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: hr_quote_review_workflow  (Phase 2D.3)
--
-- Adds HR quote review actions: approve, reject, request-revision.
-- Adds contractor resubmit after revision.
-- New statuses: under_review, revision_requested.
-- New columns:  revision_comments (visible to contractor), hr_notes (HR only).
-- Updates contractor_portal_list_quotes + contractor_portal_get_quote to
--   expose new fields.
-- Updates contractor_portal_save_quote_draft to allow editing revision_requested.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Schema changes ────────────────────────────────────────────────────────

ALTER TABLE public.contractor_quotes
    ADD COLUMN IF NOT EXISTS revision_comments text,
    ADD COLUMN IF NOT EXISTS hr_notes          text;

-- Drop existing status CHECK (was: draft,submitted,approved,rejected,expired,converted)
ALTER TABLE public.contractor_quotes
    DROP CONSTRAINT IF EXISTS contractor_quotes_status_check;

ALTER TABLE public.contractor_quotes
    ADD CONSTRAINT contractor_quotes_status_check
    CHECK (status IN (
        'draft','submitted','under_review','revision_requested',
        'approved','rejected','expired','converted'
    ));

-- ── 2. HR: start review  (submitted → under_review) ─────────────────────────

CREATE OR REPLACE FUNCTION public.hr_start_quote_review(
    p_company_id  uuid,
    p_hr_user_id  uuid,
    p_quote_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.contractor_quotes
    SET    status = 'under_review', updated_at = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status     = 'submitted';
    -- Silently no-op if already under_review or in another state
    -- (HR may open the same quote twice – idempotent)

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_start_review', 'info',
            jsonb_build_object('quote_id', p_quote_id));
END;
$$;

-- ── 3. HR: approve ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_quote(
    p_company_id  uuid,
    p_hr_user_id  uuid,
    p_quote_id    uuid,
    p_hr_notes    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor_id uuid;
    v_quote_number  text;
    v_total         numeric;
BEGIN
    UPDATE public.contractor_quotes
    SET    status      = 'approved',
           reviewed_by = p_hr_user_id,
           reviewed_at = now(),
           hr_notes    = p_hr_notes,
           updated_at  = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status IN ('submitted','under_review')
    RETURNING contractor_id, quote_number, total_amount
    INTO v_contractor_id, v_quote_number, v_total;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in a reviewable state';
    END IF;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_approve_quote', 'info',
            jsonb_build_object(
                'quote_id',      p_quote_id,
                'contractor_id', v_contractor_id,
                'quote_number',  v_quote_number,
                'total_amount',  v_total));

    -- Notify contractor
    INSERT INTO public.app_notifications (
        company_id, audience, type, title, body,
        ref_type, ref_id, dedupe_key, data
    ) VALUES (
        p_company_id, 'contractor',
        'contractor_quote_approved',
        'Quote Approved',
        'Your quote ' || coalesce(v_quote_number,'') || ' has been approved.',
        'contractor_quote', p_quote_id::text,
        'quote_approved_' || p_quote_id::text,
        jsonb_build_object('quote_id', p_quote_id, 'contractor_id', v_contractor_id)
    );
END;
$$;

-- ── 4. HR: reject ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_quote(
    p_company_id       uuid,
    p_hr_user_id       uuid,
    p_quote_id         uuid,
    p_rejection_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor_id uuid;
    v_quote_number  text;
BEGIN
    UPDATE public.contractor_quotes
    SET    status           = 'rejected',
           reviewed_by      = p_hr_user_id,
           reviewed_at      = now(),
           rejection_reason = p_rejection_reason,
           updated_at       = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status IN ('submitted','under_review')
    RETURNING contractor_id, quote_number
    INTO v_contractor_id, v_quote_number;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in a reviewable state';
    END IF;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_reject_quote', 'info',
            jsonb_build_object(
                'quote_id',         p_quote_id,
                'contractor_id',    v_contractor_id,
                'rejection_reason', p_rejection_reason));

    INSERT INTO public.app_notifications (
        company_id, audience, type, title, body,
        ref_type, ref_id, dedupe_key, data
    ) VALUES (
        p_company_id, 'contractor',
        'contractor_quote_rejected',
        'Quote Not Approved',
        'Your quote ' || coalesce(v_quote_number,'') ||
            ' was not approved. Reason: ' || coalesce(p_rejection_reason,'No reason provided'),
        'contractor_quote', p_quote_id::text,
        'quote_rejected_' || p_quote_id::text,
        jsonb_build_object(
            'quote_id',         p_quote_id,
            'contractor_id',    v_contractor_id,
            'rejection_reason', p_rejection_reason)
    );
END;
$$;

-- ── 5. HR: request revision ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_request_quote_revision(
    p_company_id        uuid,
    p_hr_user_id        uuid,
    p_quote_id          uuid,
    p_revision_comments text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor_id uuid;
    v_quote_number  text;
BEGIN
    UPDATE public.contractor_quotes
    SET    status             = 'revision_requested',
           reviewed_by        = p_hr_user_id,
           reviewed_at        = now(),
           revision_comments  = p_revision_comments,
           updated_at         = now()
    WHERE  id         = p_quote_id
      AND  company_id = p_company_id
      AND  status IN ('submitted','under_review')
    RETURNING contractor_id, quote_number
    INTO v_contractor_id, v_quote_number;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in a reviewable state';
    END IF;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_request_revision', 'info',
            jsonb_build_object(
                'quote_id',          p_quote_id,
                'contractor_id',     v_contractor_id,
                'revision_comments', p_revision_comments));

    INSERT INTO public.app_notifications (
        company_id, audience, type, title, body,
        ref_type, ref_id, dedupe_key, data
    ) VALUES (
        p_company_id, 'contractor',
        'contractor_quote_revision_requested',
        'Revision Requested',
        'HR has requested revisions on your quote ' ||
            coalesce(v_quote_number,'') || '. Please review the comments and resubmit.',
        'contractor_quote', p_quote_id::text,
        'quote_revision_' || p_quote_id::text,
        jsonb_build_object(
            'quote_id',          p_quote_id,
            'contractor_id',     v_contractor_id,
            'revision_comments', p_revision_comments)
    );
END;
$$;

-- ── 6. Portal: resubmit after revision ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_resubmit_quote(
    p_contractor_id uuid,
    p_company_id    uuid,
    p_quote_id      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name         text;
    v_quote_number text;
    v_total        numeric;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true
    ) THEN
        RAISE EXCEPTION 'Contractor not found or inactive';
    END IF;

    UPDATE public.contractor_quotes
    SET    status       = 'submitted',
           submitted_at = now(),
           updated_at   = now()
    WHERE  id             = p_quote_id
      AND  contractor_id  = p_contractor_id
      AND  company_id     = p_company_id
      AND  status         = 'revision_requested'
    RETURNING quote_number, total_amount
    INTO v_quote_number, v_total;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found or not in revision_requested state';
    END IF;

    SELECT name INTO v_name FROM public.contractors WHERE id = p_contractor_id;

    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (p_company_id, p_contractor_id, 'contractor_portal', 'resubmit_quote', 'info',
            jsonb_build_object('quote_id', p_quote_id, 'quote_number', v_quote_number));

    -- Notify HR (reuse notify_hr_contractor_quote using quote-specific dedupe key
    --   by inserting directly so the contractor-level dedupe doesn't suppress it)
    INSERT INTO public.app_notifications (
        company_id, audience, type, title, body,
        ref_type, ref_id, dedupe_key, data
    ) VALUES (
        p_company_id, 'hr',
        'contractor_quote_resubmitted',
        'Quote Resubmitted',
        coalesce(v_name,'Contractor') || ' has resubmitted quote ' || coalesce(v_quote_number,''),
        'contractor_quote', p_quote_id::text,
        'quote_resubmitted_' || p_quote_id::text,
        jsonb_build_object(
            'contractor_id', p_contractor_id, 'quote_number', v_quote_number)
    );
END;
$$;

-- ── 7. Update contractor_portal_save_quote_draft ─────────────────────────────
--    Allow editing revision_requested quotes (previously only 'draft' allowed).

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
$$;

-- ── 8. Update contractor_portal_get_quote ────────────────────────────────────
--    Add vat_mode, freight/duty/levies/other, taxable_amount, revision_comments.

CREATE OR REPLACE FUNCTION public.contractor_portal_get_quote(
    p_contractor_id uuid,
    p_company_id    uuid,
    p_quote_id      uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        'submitted_at',         v_quote.submitted_at,
        'reviewed_at',          v_quote.reviewed_at,
        'created_at',           v_quote.created_at,
        'updated_at',           v_quote.updated_at,
        'items',                v_items,
        'attachments',          v_attachments
    );
END;
$$;

-- ── 9. Update contractor_portal_list_quotes ──────────────────────────────────
--    Add vat_mode, charges, taxable_amount, revision_comments.
--    Update virtual-expiry to cover new statuses.
--    Update ORDER BY so revision_requested (needs action) sorts first.

CREATE OR REPLACE FUNCTION public.contractor_portal_list_quotes(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
                -- Virtual expiry: active quotes past valid_until → expired
                CASE
                    WHEN status IN ('submitted','under_review','revision_requested','approved')
                         AND valid_until IS NOT NULL
                         AND valid_until < CURRENT_DATE
                    THEN 'expired'
                    ELSE status
                END AS status,
                contractor_notes, revision_comments, rejection_reason,
                submitted_at, reviewed_at, created_at, updated_at,
                -- Sort: revision_requested first (needs contractor action), then drafts, submitted, etc.
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
$$;;
