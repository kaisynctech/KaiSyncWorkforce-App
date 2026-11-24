-- Client portal uploads land in the private workforce-media bucket.
-- Anon can insert only when a short-lived grant exists for that exact path.

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
  v_prefix text;
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND';
  END IF;

  v_prefix := 'client_documents/' || v_company::text || '/' || v_client::text || '/';
  IF v_path = '' OR v_path LIKE '%..%' OR left(v_path, length(v_prefix)) <> v_prefix THEN
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

REVOKE ALL ON FUNCTION public.client_portal_prepare_upload(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_prepare_upload(text, text, text) TO anon, authenticated;
