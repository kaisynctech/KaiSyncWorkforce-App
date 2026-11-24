-- Turning Portal user off must stop every client portal call, not only sign-in
-- and the job screens. Message payloads must not carry contractor identity.
-- Project file uploads need the same short-lived storage grant as document requests.

CREATE OR REPLACE FUNCTION public._client_portal_client(
  p_company_code text,
  p_client_code text
)
RETURNS TABLE (client_id uuid, company_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT cl.id, cl.company_id
  FROM public.clients cl
  INNER JOIN public.companies c ON c.id = cl.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._client_portal_client(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._client_portal_client(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_list_projects(
  p_company_code text,
  p_client_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      d.id,
      d.company_id,
      d.client_id,
      d.project_code,
      d.title,
      d.status,
      d.offer_amount,
      d.amount_paid,
      d.progress_percent,
      d.agreement_notes,
      d.last_update_note,
      d.last_update_at,
      d.expected_close_date,
      d.job_id,
      d.created_at,
      d.updated_at,
      (
        SELECT count(*)::int
        FROM public.jobs j
        WHERE j.deal_id = d.id
          AND j.visibility IS DISTINCT FROM 'private'
      ) AS job_count
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND coalesce(cl.portal_enabled, false) = true
      AND d.visibility <> 'private'
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_list_invoices(
  p_company_code text,
  p_client_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.issue_date DESC), '[]'::json)
  FROM (
    SELECT
      i.id, i.company_id, i.client_id, i.invoice_number, i.status, i.currency,
      i.subtotal, i.vat_rate, i.vat_amount, i.total_amount, i.amount_paid, i.balance_due,
      i.issue_date, i.due_date, i.paid_date, i.notes
    FROM public.finance_invoices i
    INNER JOIN public.clients cl ON cl.id = i.client_id
    INNER JOIN public.companies c ON c.id = i.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND coalesce(cl.portal_enabled, false) = true
      AND i.status NOT IN ('draft', 'cancelled')
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_list_message_inbox(
  p_company_code text,
  p_client_code text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(x) ORDER BY x.last_message_at DESC NULLS LAST), '[]'::json)
  FROM (
    SELECT
      d.id AS deal_id,
      d.title AS project_title,
      d.project_code,
      t.last_message_at,
      t.last_message_preview,
      (
        SELECT m.sender_client_id IS NULL
        FROM public.app_messages m
        WHERE m.thread_id = t.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_from_hr
    FROM public.client_deals d
    INNER JOIN public.clients cl ON cl.id = d.client_id
    INNER JOIN public.companies c ON c.id = d.company_id
    INNER JOIN public.message_threads t
      ON t.company_id = d.company_id
     AND t.subject = public._deal_message_subject(d.id)
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND coalesce(cl.portal_enabled, false) = true
      AND d.visibility <> 'private'
      AND t.last_message_at IS NOT NULL
  ) x;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_get_deal_messages(
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
  v_company_id uuid;
  v_subject text;
  v_thread_id uuid;
BEGIN
  SELECT d.company_id INTO v_company_id
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id
    AND d.visibility <> 'private';

  IF NOT FOUND THEN
    RETURN '[]'::json;
  END IF;

  v_subject := public._deal_message_subject(p_deal_id);
  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_company_id AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT coalesce(json_agg(json_build_object(
      'id', m.id,
      'body', m.body,
      'created_at', m.created_at,
      'sender_client_id', m.sender_client_id
    ) ORDER BY m.created_at), '[]'::json)
    FROM public.app_messages m
    WHERE m.thread_id = v_thread_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_send_message(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid,
  p_body text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_client_id uuid;
  v_thread_id uuid;
  v_msg_id uuid;
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN
    RAISE EXCEPTION 'MESSAGE_REQUIRED';
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

  v_client_id := v_deal.client_id;
  v_thread_id := public._get_or_create_deal_thread(v_deal.company_id, v_deal.id, v_deal.manager_employee_id);

  INSERT INTO public.app_messages (
    id, thread_id, sender_id, body, company_id, created_at, sender_client_id, sender_display_name
  ) VALUES (
    gen_random_uuid(),
    v_thread_id,
    coalesce(v_deal.manager_employee_id, v_client_id),
    trim(p_body),
    v_deal.company_id,
    now(),
    v_client_id,
    'Client'
  )
  RETURNING id INTO v_msg_id;

  RETURN json_build_object(
    'id', v_msg_id,
    'body', trim(p_body),
    'created_at', now(),
    'sender_client_id', v_client_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_add_document_link(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid,
  p_document_name text,
  p_file_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_id uuid;
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
    AND coalesce(cl.portal_enabled, false) = true
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
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_register_document(
  p_company_code text,
  p_client_code text,
  p_deal_id uuid,
  p_document_name text,
  p_file_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal public.client_deals%ROWTYPE;
  v_id uuid;
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
    AND coalesce(cl.portal_enabled, false) = true
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
$function$;
