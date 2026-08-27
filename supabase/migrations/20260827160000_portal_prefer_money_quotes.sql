-- Portal quotations: prefer linked Money commercial_quotes lines when present.
-- Falls back to project_quotation_lines for deals without a Money quote.
-- Shape of quotation_lines JSON stays compatible with client portal UI.

CREATE OR REPLACE FUNCTION public.client_portal_get_project(
  p_company_code text,
  p_client_code  text,
  p_deal_id      uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT row_to_json(t)
  FROM (
    SELECT
      d.id, d.company_id, d.client_id, d.project_code, d.title, d.status,
      d.offer_amount, d.amount_paid, d.deposit_required, d.progress_percent,
      d.agreement_notes, d.last_update_note, d.last_update_at,
      d.expected_close_date, d.site_start_date, d.expected_completion_date, d.next_visit_date,
      d.job_id, d.created_at, d.updated_at,
      COALESCE(mq.scope_notes, d.quotation_notes) AS quotation_notes,
      COALESCE(mq.valid_until, d.quotation_valid_until) AS quotation_valid_until,
      COALESCE(mq.sent_at, d.quotation_sent_at) AS quotation_sent_at,
      (
        CASE
          WHEN mq.id IS NOT NULL THEN (
            SELECT COALESCE(json_agg(
              json_build_object(
                'line_no', cql.sort_order + 1,
                'description', cql.description,
                'quantity', cql.quantity,
                'unit_price', cql.unit_sell_price,
                'line_total', cql.quantity * cql.unit_sell_price
              ) ORDER BY cql.sort_order
            ), '[]'::json)
            FROM public.commercial_quote_lines cql
            WHERE cql.quote_id = mq.id
              AND COALESCE(cql.is_excluded, false) = false
          )
          ELSE (
            SELECT COALESCE(json_agg(
              json_build_object(
                'line_no', ql.line_no,
                'description', ql.description,
                'quantity', ql.quantity,
                'unit_price', ql.unit_price,
                'line_total', ql.quantity * ql.unit_price
              ) ORDER BY ql.line_no
            ), '[]'::json)
            FROM public.project_quotation_lines ql
            WHERE ql.deal_id = d.id
          )
        END
      ) AS quotation_lines,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', pd.id,
            'document_name', pd.document_name,
            'document_type', pd.document_type,
            'file_url', pd.file_url,
            'created_at', pd.created_at
          ) ORDER BY pd.created_at DESC
        ), '[]'::json)
        FROM public.project_documents pd
        WHERE pd.deal_id = d.id
      ) AS documents,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'body', u.body,
            'status_from', u.status_from,
            'status_to', u.status_to,
            'created_at', u.created_at
          ) ORDER BY u.created_at DESC
        ), '[]'::json)
        FROM public.client_deal_updates u
        WHERE u.deal_id = d.id
      ) AS activity_updates,
      public.client_portal_get_deal_messages(p_company_code, p_client_code, p_deal_id) AS messages,
      (
        SELECT COALESCE(json_agg(
          json_build_object(
            'id', pay.id,
            'amount', pay.amount,
            'paid_at', pay.paid_at,
            'payment_method', pay.payment_method,
            'reference', pay.reference,
            'notes', pay.notes,
            'receipt_url', pay.receipt_url
          ) ORDER BY pay.paid_at DESC
        ), '[]'::json)
        FROM public.project_client_payments pay
        WHERE pay.deal_id = d.id
      ) AS payments,
      (
        SELECT COALESCE(json_agg(photo_row), '[]'::json)
        FROM (
          SELECT json_build_object(
            'job_title', j.title,
            'phase', 'before',
            'url', url
          ) AS photo_row,
          j.title AS sort_title,
          1 AS sort_phase
          FROM public.jobs j
          CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_before, '{}'::text[])) AS url
          WHERE j.deal_id = d.id
            AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit')
            AND trim(url) <> ''
          UNION ALL
          SELECT json_build_object(
            'job_title', j.title,
            'phase', 'after',
            'url', url
          ),
          j.title,
          2
          FROM public.jobs j
          CROSS JOIN LATERAL unnest(coalesce(j.photo_urls_after, '{}'::text[])) AS url
          WHERE j.deal_id = d.id
            AND coalesce(j.visibility, 'inherit') IN ('all', 'inherit')
            AND trim(url) <> ''
          ORDER BY sort_title, sort_phase
        ) photos
      ) AS progress_photos
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    LEFT JOIN LATERAL (
      SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount
      FROM public.commercial_quotes q
      WHERE q.deal_id = d.id
        AND q.company_id = d.company_id
        AND q.status IN ('sent', 'viewed', 'accepted')
      ORDER BY
        CASE q.status
          WHEN 'accepted' THEN 1
          WHEN 'viewed' THEN 2
          WHEN 'sent' THEN 3
          ELSE 4
        END,
        q.updated_at DESC NULLS LAST
      LIMIT 1
    ) mq ON true
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.id = p_deal_id
      AND d.visibility <> 'private'
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_get_project(text, text, uuid) TO anon, authenticated;
