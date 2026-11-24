-- 20261019104058_client_portal_audit_quotes_upload
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.client_portal_get_quotation_response(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_row public.client_deals%ROWTYPE;
BEGIN
  SELECT d.* INTO v_row
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  RETURN json_build_object('quotation_response', v_row.quotation_response, 'quotation_response_note', v_row.quotation_response_note, 'quotation_response_at', v_row.quotation_response_at, 'quotation_response_storage_path', v_row.quotation_response_storage_path);
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_accept_quotation(p_company_code text, p_client_code text, p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_deal public.client_deals%ROWTYPE; v_has_quote boolean;
BEGIN
  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RETURN; END IF;
  SELECT (coalesce(v_deal.offer_amount, 0) > 0 OR nullif(trim(coalesce(v_deal.quotation_notes, '')), '') IS NOT NULL OR v_deal.quotation_sent_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.project_quotation_lines ql WHERE ql.deal_id = v_deal.id) OR EXISTS (SELECT 1 FROM public.commercial_quotes q WHERE q.deal_id = v_deal.id AND q.status = 'sent')) INTO v_has_quote;
  IF NOT v_has_quote THEN RAISE EXCEPTION 'QUOTATION_NOT_SHARED'; END IF;
  UPDATE public.client_deals SET quotation_response = 'accepted', quotation_response_note = NULL, quotation_response_storage_path = NULL, quotation_response_at = now(), updated_at = now() WHERE id = v_deal.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_revise_quotation(p_company_code text, p_client_code text, p_deal_id uuid, p_note text, p_storage_path text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_deal public.client_deals%ROWTYPE; v_prefix text;
BEGIN
  IF nullif(trim(coalesce(p_note, '')), '') IS NULL THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  SELECT d.* INTO v_deal
  FROM public.client_deals d
  INNER JOIN public.clients cl ON cl.id = d.client_id
  INNER JOIN public.companies c ON c.id = d.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    AND coalesce(cl.portal_enabled, false) = true
    AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RAISE EXCEPTION 'QUOTATION_ALREADY_ACCEPTED'; END IF;
  IF nullif(trim(coalesce(p_storage_path, '')), '') IS NOT NULL THEN
    v_prefix := 'client_documents/' || v_deal.company_id::text || '/' || v_deal.client_id::text || '/';
    IF p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION 'FILE_REQUIRED'; END IF;
  END IF;
  UPDATE public.client_deals SET quotation_response = 'revision_requested', quotation_response_note = trim(p_note), quotation_response_storage_path = nullif(trim(coalesce(p_storage_path, '')), ''), quotation_response_at = now(), updated_at = now() WHERE id = v_deal.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_prepare_upload(p_company_code text, p_client_code text, p_storage_path text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid; v_company uuid;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_client_prefix text; v_project_prefix text; v_deal uuid;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF v_path = '' OR v_path LIKE '%..%' THEN RAISE EXCEPTION 'FILE_REQUIRED'; END IF;
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
    IF NOT EXISTS (SELECT 1 FROM public.client_deals d WHERE d.id = v_deal AND d.company_id = v_company AND d.client_id = v_client AND d.visibility <> 'private') THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END IF;
  ELSE
    RAISE EXCEPTION 'FILE_REQUIRED';
  END IF;
  INSERT INTO public.media_upload_grants (company_id, employee_id, storage_path, purpose, expires_at)
  VALUES (v_company, NULL, v_path, 'client_portal_document', now() + interval '15 minutes')
  ON CONFLICT (storage_path) DO UPDATE SET company_id = EXCLUDED.company_id, employee_id = NULL, purpose = EXCLUDED.purpose, expires_at = EXCLUDED.expires_at, consumed_at = NULL;
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
GRANT EXECUTE ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_prepare_upload(text, text, text) TO anon, authenticated;
