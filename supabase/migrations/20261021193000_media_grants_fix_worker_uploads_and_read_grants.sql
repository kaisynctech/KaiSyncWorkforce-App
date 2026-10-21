-- Security Phase 0, stage B1 (additive). Fixes worker/client uploads and adds
-- checked read access for portal users. Removes nothing: the open read policy
-- (p_workforce_media_public_select) stays until stage B2, so no screen can lose files.
--
-- 1) LIVE DEFECT: code-sign-in workers and portal clients cannot upload files.
--    p_workforce_media_worker_insert / _worker_select check media_upload_grants with
--    EXISTS, but that table has RLS on and no policies, so as `anon` the subquery always
--    sees zero rows and every upload is refused ("new row violates row-level security
--    policy for table objects"). Seen 20 Oct 05:28 UTC: a worker's job photo (Android)
--    got HTTP 400 right after employee_prepare_media_upload returned 200.
--    Fix: check the grant through SECURITY DEFINER helpers.
--
-- 2) media_read_grants + *_grant_media_read RPCs: a portal user (worker code session,
--    client, contractor) asks for read access to specific files; each path is checked
--    against what that user may see, and a 1-hour grant is written. Stage B2 then
--    removes the open read policy.
--
-- 3) employee_prepare_media_upload: paths must be inside the worker's own company /
--    own folder (previously any path in the allowed folders, any company), and the
--    profile-photos folder used by My Profile is allowed (it was refused).

-- Fail fast instead of queueing storage requests behind a policy change
-- (DROP/CREATE POLICY on storage.objects needs an exclusive lock).
SET lock_timeout = '5s';

-- ---------- 2a. read grants table ----------
CREATE TABLE IF NOT EXISTS public.media_read_grants (
  storage_path text PRIMARY KEY,
  company_id   uuid NOT NULL,
  granted_to   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_read_grants_expires_idx ON public.media_read_grants (expires_at);
ALTER TABLE public.media_read_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_read_grants FROM PUBLIC, anon, authenticated;

-- ---------- 1. grant checks usable inside storage policies ----------
CREATE OR REPLACE FUNCTION public.media_upload_granted(p_name text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.media_upload_grants g
    WHERE g.storage_path = p_name AND g.consumed_at IS NULL AND g.expires_at > now()
  );
$function$;

CREATE OR REPLACE FUNCTION public.media_read_granted(p_name text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.media_read_grants r
           WHERE r.storage_path = p_name AND r.expires_at > now())
      OR EXISTS (
           -- a file being uploaded may be read back (upsert / signed link) while its upload grant is valid
           SELECT 1 FROM public.media_upload_grants g
           WHERE g.storage_path = p_name AND g.expires_at > now());
$function$;

REVOKE ALL ON FUNCTION public.media_upload_granted(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_read_granted(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.media_upload_granted(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.media_read_granted(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS p_workforce_media_worker_insert ON storage.objects;
CREATE POLICY p_workforce_media_worker_insert ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'workforce-media' AND public.media_upload_granted(name));

DROP POLICY IF EXISTS p_workforce_media_worker_select ON storage.objects;
CREATE POLICY p_workforce_media_worker_select ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'workforce-media' AND public.media_read_granted(name));

-- ---------- 2b. read-grant RPCs ----------
CREATE OR REPLACE FUNCTION public._media_write_read_grant(p_path text, p_company uuid, p_to text)
 RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  INSERT INTO public.media_read_grants (storage_path, company_id, granted_to, expires_at)
  VALUES (p_path, p_company, p_to, now() + interval '1 hour')
  ON CONFLICT (storage_path) DO UPDATE
    SET expires_at = greatest(public.media_read_grants.expires_at, EXCLUDED.expires_at),
        granted_to = EXCLUDED.granted_to;
$function$;
REVOKE ALL ON FUNCTION public._media_write_read_grant(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Worker (code sign-in or account). Returns the paths that were granted.
CREATE OR REPLACE FUNCTION public.employee_grant_media_read(
  p_company_id uuid, p_employee_id uuid, p_paths text[], p_session_token text DEFAULT NULL::text)
 RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_path text; v_p text[]; v_ok boolean; v_out text[] := '{}';
  v_c text := p_company_id::text; v_e text := p_employee_id::text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF coalesce(array_length(p_paths, 1), 0) > 200 THEN RAISE EXCEPTION 'too_many_paths'; END IF;
  FOREACH v_path IN ARRAY coalesce(p_paths, '{}'::text[]) LOOP
    v_path := trim(both '/' from trim(coalesce(v_path, '')));
    CONTINUE WHEN v_path = '' OR v_path LIKE '%..%';
    v_p := string_to_array(v_path, '/');
    v_ok := CASE
      WHEN v_p[1] = 'company_logos' THEN v_p[2] = v_c
      WHEN v_p[1] IN ('employee_documents', 'incident_reports') THEN v_p[2] = v_c AND v_p[3] = v_e
      WHEN v_p[1] = 'profile-photos' THEN v_p[2] = v_c AND split_part(v_p[3], '.', 1) = v_e
      WHEN v_p[1] = 'leave_attachments' THEN v_p[2] = v_e
      WHEN v_p[1] IN ('job_photos', 'job_documents', 'job_cards') AND v_p[2] = v_c
           AND v_p[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        EXISTS (
          SELECT 1 FROM public.jobs j
          WHERE j.id = v_p[3]::uuid AND j.company_id = p_company_id
            AND ( j.assigned_employee_ids @> ARRAY[p_employee_id]
               OR j.assignee_employee_id = p_employee_id
               OR j.contractor_employee_id = p_employee_id
               OR j.created_by_employee_id = p_employee_id
               OR ( j.contractor_id IS NOT NULL AND EXISTS (
                      SELECT 1 FROM public.contractor_member_links cml
                      WHERE cml.company_id = p_company_id AND cml.employee_id = p_employee_id
                        AND cml.contractor_id = j.contractor_id))))
      ELSE false
    END;
    IF v_ok THEN
      PERFORM public._media_write_read_grant(v_path, p_company_id, 'employee:' || v_e);
      v_out := v_out || v_path;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- Client portal (company code + client code, same check as every client_portal_* RPC).
CREATE OR REPLACE FUNCTION public.client_portal_grant_media_read(
  p_company_code text, p_client_code text, p_paths text[])
 RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_client uuid; v_company uuid; v_path text; v_p text[]; v_ok boolean; v_out text[] := '{}';
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT r.client_id, r.company_id INTO v_client, v_company
  FROM public._client_portal_client(p_company_code, p_client_code) r;
  IF v_client IS NULL THEN RAISE EXCEPTION 'CLIENT_NOT_FOUND'; END IF;
  IF coalesce(array_length(p_paths, 1), 0) > 200 THEN RAISE EXCEPTION 'too_many_paths'; END IF;
  FOREACH v_path IN ARRAY coalesce(p_paths, '{}'::text[]) LOOP
    v_path := trim(both '/' from trim(coalesce(v_path, '')));
    CONTINUE WHEN v_path = '' OR v_path LIKE '%..%';
    v_p := string_to_array(v_path, '/');
    v_ok := false;
    IF v_p[2] = v_company::text THEN
      IF v_p[1] = 'company_logos' THEN
        v_ok := true;
      ELSIF v_p[1] = 'client_documents' THEN
        v_ok := v_p[3] = v_client::text;
      ELSIF v_p[1] = 'project_documents' AND v_p[3] ~* v_uuid THEN
        v_ok := EXISTS (SELECT 1 FROM public.client_deals d
                        WHERE d.id = v_p[3]::uuid AND d.company_id = v_company
                          AND d.client_id = v_client AND d.visibility <> 'private');
      ELSIF v_p[1] IN ('job_photos', 'job_documents') AND v_p[3] ~* v_uuid THEN
        v_ok := public.client_portal_get_job(p_company_code, p_client_code, v_p[3]::uuid) IS NOT NULL;
      END IF;
    END IF;
    IF v_ok THEN
      PERFORM public._media_write_read_grant(v_path, v_company, 'client:' || v_client::text);
      v_out := v_out || v_path;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- Contractor portal (company code + contractor code, as contractor_portal_prepare_job_photo_upload).
CREATE OR REPLACE FUNCTION public.contractor_portal_grant_media_read(
  p_company_code text, p_contractor_code text, p_paths text[])
 RETURNS text[] LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ct uuid; v_company uuid; v_path text; v_p text[]; v_ok boolean; v_out text[] := '{}';
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  SELECT ct.id, ct.company_id INTO v_ct, v_company
  FROM public.contractors ct JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true AND coalesce(ct.portal_enabled, false) = true
  LIMIT 1;
  IF v_ct IS NULL THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF coalesce(array_length(p_paths, 1), 0) > 200 THEN RAISE EXCEPTION 'too_many_paths'; END IF;
  FOREACH v_path IN ARRAY coalesce(p_paths, '{}'::text[]) LOOP
    v_path := trim(both '/' from trim(coalesce(v_path, '')));
    CONTINUE WHEN v_path = '' OR v_path LIKE '%..%';
    v_p := string_to_array(v_path, '/');
    v_ok := false;
    IF v_p[2] = v_company::text THEN
      IF v_p[1] = 'company_logos' THEN
        v_ok := true;
      ELSIF v_p[1] IN ('contractor_documents', 'contractor_quotes') THEN
        v_ok := v_p[3] = v_ct::text;
      ELSIF v_p[1] IN ('job_photos', 'job_documents') AND v_p[3] ~* v_uuid THEN
        v_ok := public._contractor_owns_job(v_company, v_ct, v_p[3]::uuid);
      END IF;
    END IF;
    IF v_ok THEN
      PERFORM public._media_write_read_grant(v_path, v_company, 'contractor:' || v_ct::text);
      v_out := v_out || v_path;
    END IF;
  END LOOP;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.employee_grant_media_read(uuid, uuid, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.client_portal_grant_media_read(text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_grant_media_read(text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_grant_media_read(uuid, uuid, text[], text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_grant_media_read(text, text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contractor_portal_grant_media_read(text, text, text[]) TO anon, authenticated, service_role;

-- ---------- 3. worker upload paths: own company / own folder only; allow profile-photos ----------
CREATE OR REPLACE FUNCTION public.employee_prepare_media_upload(
  p_company_id uuid, p_employee_id uuid, p_storage_path text,
  p_purpose text DEFAULT 'attachment'::text, p_session_token text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_p text[];
  v_ok boolean;
  v_c text := p_company_id::text;
  v_e text := p_employee_id::text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF v_path = '' THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;
  IF v_path LIKE '%..%' THEN
    RAISE EXCEPTION 'folder_not_allowed';
  END IF;

  v_p := string_to_array(v_path, '/');
  v_ok := CASE
    WHEN v_p[1] = 'leave_attachments' THEN v_p[2] = v_e
    WHEN v_p[1] IN ('incident_reports', 'employee_documents') THEN v_p[2] = v_c AND v_p[3] = v_e
    WHEN v_p[1] = 'profile-photos' THEN v_p[2] = v_c AND split_part(v_p[3], '.', 1) = v_e
    WHEN v_p[1] IN ('job_photos', 'job_documents', 'job_cards') THEN v_p[2] = v_c
    ELSE false
  END;
  IF NOT coalesce(v_ok, false) THEN
    RAISE EXCEPTION 'folder_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    p_company_id, p_employee_id, v_path, coalesce(nullif(trim(p_purpose), ''), 'attachment'),
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = EXCLUDED.employee_id,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', (now() + interval '15 minutes')
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
