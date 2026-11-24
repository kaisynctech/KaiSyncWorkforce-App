-- 20261016133658_client_portal_request_functions
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public._client_portal_client(p_company_code text, p_client_code text)
RETURNS TABLE (client_id uuid, company_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.client_portal_list_document_requests(p_company_code text, p_client_code text)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid; v_company uuid;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  RETURN COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.created_at DESC)
    FROM (
      SELECT id, document_name, document_type, request_note, status, review_note, storage_path, submitted_at, created_at
      FROM public.client_document_requests
      WHERE client_id = v_client AND company_id = v_company
    ) x
  ), '[]'::json);
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_submit_document_request(p_company_code text, p_client_code text, p_request_id uuid, p_storage_path text, p_file_size_bytes bigint DEFAULT NULL, p_mime_type text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_client uuid; v_company uuid; v_prefix text;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  v_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  IF coalesce(p_storage_path, '') = '' OR p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  UPDATE public.client_document_requests
  SET status = 'submitted', storage_path = p_storage_path, file_url = p_storage_path,
      file_size_bytes = p_file_size_bytes, mime_type = nullif(trim(coalesce(p_mime_type, '')), ''),
      submitted_at = now(), review_note = NULL, updated_at = now()
  WHERE id = p_request_id AND client_id = v_client AND company_id = v_company
    AND status IN ('requested', 'changes_requested');
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_OPEN'; END IF;
  RETURN p_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.client_portal_list_document_requests(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_submit_document_request(text, text, uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_list_document_requests(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_submit_document_request(text, text, uuid, text, bigint, text) TO anon, authenticated;
