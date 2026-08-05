-- ============================================================
-- Contractors: scope Action Centre + snapshot KPIs to contractor|both
-- (excludes pure supplier partner_kind rows from the Contractors module)
-- ============================================================

CREATE OR REPLACE FUNCTION public.hr_get_contractor_action_items(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.view');

  RETURN coalesce((
    SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
    FROM (
      SELECT
        cq.id::text AS ref_id,
        cq.contractor_id::text AS contractor_id,
        c.name AS contractor_name,
        coalesce(c.contractor_code, '') AS contractor_code,
        'quote_pending' AS action_type,
        coalesce(
          'Quote' || CASE WHEN cq.quote_number IS NOT NULL THEN ' #' || cq.quote_number ELSE '' END || ' awaiting review',
          'Quote awaiting review'
        ) AS summary,
        cq.total_amount AS amount,
        cq.status AS status,
        cq.submitted_at AS created_at,
        1 AS priority
      FROM public.contractor_quotes cq
      JOIN public.contractors c ON c.id = cq.contractor_id
      WHERE cq.company_id = p_company_id
        AND cq.status IN ('submitted', 'under_review')
        AND c.is_active = true
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')

      UNION ALL

      SELECT
        bu.id::text, bu.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'banking_pending', 'Banking details update awaiting approval',
        NULL::numeric, bu.status, bu.submitted_at, 2
      FROM public.contractor_banking_updates bu
      JOIN public.contractors c ON c.id = bu.contractor_id
      WHERE bu.company_id = p_company_id
        AND bu.status = 'pending'
        AND c.is_active = true
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')

      UNION ALL

      SELECT
        cd.id::text, cd.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'document_pending', cd.document_type || ': ' || cd.document_name,
        NULL::numeric, cd.approval_status, cd.created_at, 3
      FROM public.contractor_documents cd
      JOIN public.contractors c ON c.id = cd.contractor_id
      WHERE cd.company_id = p_company_id
        AND cd.approval_status = 'pending'
        AND cd.uploaded_by_role = 'contractor'
        AND c.is_active = true
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')

      UNION ALL

      SELECT
        cd.id::text, cd.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'document_expiring',
        cd.document_type || ' expires ' || to_char(cd.expiry_date, 'DD Mon YYYY'),
        NULL::numeric, 'expiring', cd.created_at, 4
      FROM public.contractor_documents cd
      JOIN public.contractors c ON c.id = cd.contractor_id
      WHERE cd.company_id = p_company_id
        AND cd.approval_status = 'approved'
        AND cd.expiry_date IS NOT NULL
        AND cd.expiry_date >= CURRENT_DATE
        AND cd.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND c.is_active = true
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
    ) a
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(
  p_company_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.view');

  RETURN jsonb_build_object(
    'active', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id
        AND COALESCE(is_active, true)
        AND coalesce(partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'pending_compliance', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id
        AND COALESCE(compliance_hold, false)
        AND coalesce(partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'pending_payments', (
      SELECT COUNT(*)
      FROM contractor_payouts cp
      JOIN contractors c ON c.id = cp.contractor_id
      WHERE cp.company_id = p_company_id
        AND cp.payout_status IN ('pending', 'approved')
        AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
    ),
    'payment_summary', COALESCE((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'agreed')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'agreed', COALESCE((
            SELECT SUM(jc.agreed_amount) FROM job_contractors jc
            WHERE jc.company_id = p_company_id AND jc.contractor_id = c.id
          ), 0),
          'paid', COALESCE((
            SELECT SUM(cp.total_amount) FROM contractor_payouts cp
            WHERE cp.company_id = p_company_id
              AND cp.contractor_id = c.id
              AND cp.payout_status = 'paid'
          ), 0)
        ) AS row_obj
        FROM contractors c
        WHERE c.company_id = p_company_id
          AND COALESCE(c.is_active, true)
          AND coalesce(c.partner_kind, 'contractor') IN ('contractor', 'both')
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$$;
