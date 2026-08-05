-- Client portal: quotation lines, documents, activity, job progress photos; client document links

CREATE OR REPLACE FUNCTION public.client_portal_add_document_link(
  p_company_code   text,
  p_client_code    text,
  p_deal_id        uuid,
  p_document_name  text,
  p_file_url       text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_id   uuid;
BEGIN
  IF trim(coalesce(p_document_name, '')) = '' OR trim(coalesce(p_file_url, '')) = '' THEN
    RAISE EXCEPTION 'DOCUMENT_REQUIRED';
  END IF;

  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  INSERT INTO public.project_documents (company_id, deal_id, document_name, document_type, file_url)
  VALUES (v_deal.company_id, v_deal.id, trim(p_document_name), 'client_upload', trim(p_file_url))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.client_portal_add_document_link(text, text, uuid, text, text) TO anon, authenticated;
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
      d.expected_close_date, d.job_id, d.created_at, d.updated_at,
      d.quotation_notes, d.quotation_valid_until, d.quotation_sent_at,
      (
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
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND d.id = p_deal_id
      AND d.visibility <> 'private'
    LIMIT 1
  ) t;
$$;
