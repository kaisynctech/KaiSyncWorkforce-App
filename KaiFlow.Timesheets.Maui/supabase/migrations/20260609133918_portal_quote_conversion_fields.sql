-- Add converted_at and converted_to_job_id to contractor_portal_get_quote
-- and contractor_portal_list_quotes outputs so the portal shows the conversion status.

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
$$;

-- Also update list_quotes to include conversion fields
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
$$;;
