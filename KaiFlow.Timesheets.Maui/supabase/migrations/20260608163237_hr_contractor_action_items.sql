-- Migration: 20260608163237_hr_contractor_action_items
-- HR action items dashboard for pending contractor submissions
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.hr_get_contractor_action_items(p_company_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN coalesce((
        SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
        FROM (
            -- ── 1. Pending quotes ──────────────────────────────────────────────
            SELECT
                cq.id::text             AS ref_id,
                cq.contractor_id::text  AS contractor_id,
                c.name                  AS contractor_name,
                coalesce(c.contractor_code,'') AS contractor_code,
                'quote_pending'         AS action_type,
                coalesce('Quote' ||
                    CASE WHEN cq.quote_number IS NOT NULL
                         THEN ' #' || cq.quote_number ELSE '' END ||
                    ' awaiting review',
                    'Quote awaiting review') AS summary,
                cq.total_amount         AS amount,
                cq.status               AS status,
                cq.submitted_at         AS created_at,
                1                       AS priority
            FROM public.contractor_quotes cq
            JOIN public.contractors c ON c.id = cq.contractor_id
            WHERE cq.company_id = p_company_id
              AND cq.status IN ('submitted','under_review')
              AND c.is_active = true

            UNION ALL

            -- ── 2. Pending banking updates ─────────────────────────────────────
            SELECT
                bu.id::text             AS ref_id,
                bu.contractor_id::text  AS contractor_id,
                c.name                  AS contractor_name,
                coalesce(c.contractor_code,'') AS contractor_code,
                'banking_pending'       AS action_type,
                'Banking details update awaiting approval' AS summary,
                NULL::numeric           AS amount,
                bu.status               AS status,
                bu.submitted_at         AS created_at,
                2                       AS priority
            FROM public.contractor_banking_updates bu
            JOIN public.contractors c ON c.id = bu.contractor_id
            WHERE bu.company_id = p_company_id
              AND bu.status = 'pending'
              AND c.is_active = true

            UNION ALL

            -- ── 3. Pending documents (contractor-uploaded, awaiting HR approval)
            SELECT
                cd.id::text             AS ref_id,
                cd.contractor_id::text  AS contractor_id,
                c.name                  AS contractor_name,
                coalesce(c.contractor_code,'') AS contractor_code,
                'document_pending'      AS action_type,
                cd.document_type || ': ' || cd.document_name AS summary,
                NULL::numeric           AS amount,
                cd.approval_status      AS status,
                cd.created_at           AS created_at,
                3                       AS priority
            FROM public.contractor_documents cd
            JOIN public.contractors c ON c.id = cd.contractor_id
            WHERE cd.company_id = p_company_id
              AND cd.approval_status = 'pending'
              AND cd.uploaded_by_role = 'contractor'
              AND c.is_active = true

            UNION ALL

            -- ── 4. Documents expiring within 30 days ──────────────────────────
            SELECT
                cd.id::text             AS ref_id,
                cd.contractor_id::text  AS contractor_id,
                c.name                  AS contractor_name,
                coalesce(c.contractor_code,'') AS contractor_code,
                'document_expiring'     AS action_type,
                cd.document_type || ' expires ' ||
                    to_char(cd.expiry_date, 'DD Mon YYYY')  AS summary,
                NULL::numeric           AS amount,
                'expiring'              AS status,
                cd.created_at           AS created_at,
                4                       AS priority
            FROM public.contractor_documents cd
            JOIN public.contractors c ON c.id = cd.contractor_id
            WHERE cd.company_id = p_company_id
              AND cd.approval_status = 'approved'
              AND cd.expiry_date IS NOT NULL
              AND cd.expiry_date >= CURRENT_DATE
              AND cd.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
              AND c.is_active = true
        ) a
    ), '[]'::json);
END;
$function$


REVOKE ALL ON FUNCTION public.hr_get_contractor_action_items(p_company_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_get_contractor_action_items(p_company_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_action_items(p_company_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_contractor_action_items(p_company_id uuid) TO service_role;

