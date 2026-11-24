-- Client document requests and the client's answer on a project quotation.
-- Portal functions check the company and client codes, the same way the
-- existing client portal functions do. HR uses row security on the table.

CREATE TABLE public.client_document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  request_note text,
  status text NOT NULL DEFAULT 'requested',
  review_note text,
  storage_path text,
  file_url text,
  file_size_bytes bigint,
  mime_type text,
  requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_document_requests_status_check CHECK (
    status = ANY (ARRAY['requested'::text, 'submitted'::text, 'accepted'::text, 'changes_requested'::text])
  ),
  CONSTRAINT client_document_requests_file_check CHECK (
    status = ANY (ARRAY['requested'::text, 'changes_requested'::text])
    OR storage_path IS NOT NULL
  )
);

CREATE INDEX client_document_requests_client_idx
  ON public.client_document_requests (company_id, client_id, created_at DESC);

ALTER TABLE public.client_document_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_document_requests_select ON public.client_document_requests
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.view')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.company_id = client_document_requests.company_id
    )
  );

CREATE POLICY client_document_requests_insert ON public.client_document_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_id AND c.company_id = client_document_requests.company_id
    )
  );

CREATE POLICY client_document_requests_update ON public.client_document_requests
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

REVOKE ALL ON TABLE public.client_document_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.client_document_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.client_document_requests TO authenticated;

ALTER TABLE public.client_deals
  ADD COLUMN quotation_response text NOT NULL DEFAULT 'pending',
  ADD COLUMN quotation_response_note text,
  ADD COLUMN quotation_response_at timestamptz,
  ADD COLUMN quotation_response_storage_path text;

ALTER TABLE public.client_deals
  ADD CONSTRAINT client_deals_quotation_response_check CHECK (
    quotation_response = ANY (ARRAY['pending'::text, 'accepted'::text, 'revision_requested'::text])
  );

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
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public._client_portal_client(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._client_portal_client(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_list_document_requests(
  p_company_code text,
  p_client_code text
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_company uuid;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT id, document_name, document_type, request_note, status, review_note,
             storage_path, submitted_at, created_at
      FROM public.client_document_requests
      WHERE client_id = v_client AND company_id = v_company
    ) x
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_submit_document_request(
  p_company_code text,
  p_client_code text,
  p_request_id uuid,
  p_storage_path text,
  p_file_size_bytes bigint DEFAULT NULL,
  p_mime_type text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid;
  v_company uuid;
  v_prefix text;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  v_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  IF coalesce(p_storage_path, '') = ''
     OR p_storage_path LIKE '%..%'
     OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;

  UPDATE public.client_document_requests
  SET status = 'submitted',
      storage_path = p_storage_path,
      file_url = p_storage_path,
      file_size_bytes = p_file_size_bytes,
      mime_type = nullif(trim(coalesce(p_mime_type, '')), ''),
      submitted_at = now(),
      review_note = NULL,
      updated_at = now()
  WHERE id = p_request_id
    AND client_id = v_client
    AND company_id = v_company
    AND status IN ('requested', 'changes_requested');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_OPEN';
  END IF;

  RETURN p_request_id;
END;
$function$;

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

REVOKE ALL ON FUNCTION public.client_portal_list_document_requests(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_submit_document_request(text, text, uuid, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.client_portal_list_document_requests(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_submit_document_request(text, text, uuid, text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) TO anon, authenticated;
