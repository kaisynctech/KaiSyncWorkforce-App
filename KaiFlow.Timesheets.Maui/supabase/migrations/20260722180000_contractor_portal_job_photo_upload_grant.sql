-- Contractor portal job photo uploads need anon storage access under hardened
-- workforce-media. Mirror employee_prepare_media_upload: validate portal codes +
-- job ownership, then issue a short-lived media_upload_grants row.

CREATE OR REPLACE FUNCTION public.contractor_portal_prepare_job_photo_upload(
  p_company_code    text,
  p_contractor_code text,
  p_job_id          uuid,
  p_storage_path    text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ct   public.contractors%ROWTYPE;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_prefix text;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND';
  END IF;

  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  IF v_path = '' THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;

  v_prefix := 'job_photos/' || v_ct.company_id::text || '/' || p_job_id::text || '/';
  IF left(v_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'storage_path_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    v_ct.company_id, NULL, v_path, 'contractor_job_photo',
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = NULL,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', now() + interval '15 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.contractor_portal_prepare_job_photo_upload(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contractor_portal_prepare_job_photo_upload(text, text, uuid, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_portal_prepare_job_photo_upload IS
  'Issues a short-lived media upload grant for contractor portal job photos. Phase D6.';
