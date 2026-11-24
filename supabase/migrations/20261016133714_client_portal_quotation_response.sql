-- 20261016133714_client_portal_quotation_response
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
    AND d.id = p_deal_id
    AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  RETURN json_build_object(
    'quotation_response', v_row.quotation_response,
    'quotation_response_note', v_row.quotation_response_note,
    'quotation_response_at', v_row.quotation_response_at,
    'quotation_response_storage_path', v_row.quotation_response_storage_path
  );
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
    AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RETURN; END IF;
  SELECT (
    coalesce(v_deal.offer_amount, 0) > 0
    OR nullif(trim(coalesce(v_deal.quotation_notes, '')), '') IS NOT NULL
    OR v_deal.quotation_sent_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.project_quotation_lines ql WHERE ql.deal_id = v_deal.id)
    OR EXISTS (SELECT 1 FROM public.commercial_quotes q WHERE q.deal_id = v_deal.id AND q.status = 'sent')
  ) INTO v_has_quote;
  IF NOT v_has_quote THEN RAISE EXCEPTION 'QUOTATION_NOT_SHARED'; END IF;
  UPDATE public.client_deals
  SET quotation_response = 'accepted', quotation_response_note = NULL,
      quotation_response_storage_path = NULL, quotation_response_at = now(), updated_at = now()
  WHERE id = v_deal.id;
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
    AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RAISE EXCEPTION 'QUOTATION_ALREADY_ACCEPTED'; END IF;
  IF nullif(trim(coalesce(p_storage_path, '')), '') IS NOT NULL THEN
    v_prefix := 'client_documents/' || v_deal.company_id::text || '/' || v_deal.client_id::text || '/';
    IF p_storage_path LIKE '%..%' OR left(p_storage_path, length(v_prefix)) <> v_prefix THEN
      RAISE EXCEPTION 'FILE_REQUIRED';
    END IF;
  END IF;
  UPDATE public.client_deals
  SET quotation_response = 'revision_requested', quotation_response_note = trim(p_note),
      quotation_response_storage_path = nullif(trim(coalesce(p_storage_path, '')), ''),
      quotation_response_at = now(), updated_at = now()
  WHERE id = v_deal.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_get_quotation_response(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_accept_quotation(text, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_revise_quotation(text, text, uuid, text, text) TO anon, authenticated;
