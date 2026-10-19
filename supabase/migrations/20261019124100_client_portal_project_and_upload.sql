-- Project detail stays on the sent money quote, and only for a client whose portal is on.

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
      AND coalesce(cl.portal_enabled, false) = true
      AND d.id = p_deal_id
      AND d.visibility <> 'private'
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_get_project(text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_get_quotation_response(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.client_deals%ROWTYPE;
BEGIN
  SELECT d.* INTO v_row
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  RETURN json_build_object(
    'quotation_response', v_row.quotation_response,
    'quotation_response_note', v_row.quotation_response_note,
    'quotation_response_at', v_row.quotation_response_at,
    'quotation_response_storage_path', v_row.quotation_response_storage_path
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_accept_quotation(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_has_quote boolean;
BEGIN
  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  IF v_deal.quotation_response = 'accepted' THEN
    RETURN;
  END IF;

  SELECT (
    coalesce(v_deal.offer_amount, 0) > 0
    OR nullif(trim(coalesce(v_deal.quotation_notes, '')), '') IS NOT NULL
    OR v_deal.quotation_sent_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.project_quotation_lines ql WHERE ql.deal_id = v_deal.id)
    OR EXISTS (SELECT 1 FROM public.commercial_quotes q WHERE q.deal_id = v_deal.id AND q.status = 'sent')
  ) INTO v_has_quote;

  IF NOT v_has_quote THEN
    RAISE EXCEPTION 'QUOTATION_NOT_SHARED';
  END IF;

  UPDATE public.client_deals
  SET quotation_response = 'accepted',
      quotation_response_note = NULL,
      quotation_response_storage_path = NULL,
      quotation_response_at = now(),
      updated_at = now()
  WHERE id = v_deal.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_revise_quotation(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid,
  p_note text,
  p_storage_path text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_prefix text;
BEGIN
  IF nullif(trim(coalesce(p_note, '')), '') IS NULL THEN
    RAISE EXCEPTION 'NOTE_REQUIRED';
  END IF;

  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE';
  END IF;

  IF v_deal.quotation_response = 'accepted' THEN
    RAISE EXCEPTION 'QUOTATION_ALREADY_ACCEPTED';
  END IF;

  IF nullif(trim(coalesce(p_storage_path, '')), '') IS NOT NULL THEN
    v_prefix := 'client_documents/' || v_deal.company_id::text || '/' || v_deal.client_id::text || '/';
    IF p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END IF;
  END IF;

  UPDATE public.client_deals
  SET quotation_response = 'revision_requested',
      quotation_response_note = trim(p_note),
      quotation_response_storage_path = nullif(trim(coalesce(p_storage_path, '')), ''),
      quotation_response_at = now(),
      updated_at = now()
  WHERE id = v_deal.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_prepare_upload(
  p_company_code text,
  p_client_code text,
  p_storage_path text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_company uuid;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_client_prefix text;
  v_project_prefix text;
  v_deal uuid;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  IF v_path = '' OR v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;

  v_client_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  v_project_prefix := 'project_documents/' || v_company::text || '/';

  IF left(v_path, length(v_client_prefix)) = v_client_prefix THEN
    NULL;
  ELSIF left(v_path, length(v_project_prefix)) = v_project_prefix THEN
    BEGIN
      v_deal := split_part(v_path, '/', 3)::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END;
    IF NOT EXISTS (
      SELECT 1
      FROM public.client_deals d
      WHERE d.id = v_deal
        AND d.company_id = v_company
        AND d.client_id = v_client
        AND d.visibility <> 'private'
    ) THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END IF;
  ELSE
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    v_company, NULL, v_path, 'client_portal_document', now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    employee_id = NULL,
    purpose = EXCLUDED.purpose,
    expires_at = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object('storage_path', v_path);
END;
$function$;

REVOKE ALL ON FUNCTION public.client_portal_list_projects(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_list_invoices(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_list_message_inbox(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_get_deal_messages(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_send_message(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_add_document_link(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_register_document(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_get_project(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_prepare_upload(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.client_portal_list_projects(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_list_invoices(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_list_message_inbox(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_deal_messages(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_send_message(text, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_add_document_link(text, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_register_document(text, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_project(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_prepare_upload(text, text, text) TO anon, authenticated;
