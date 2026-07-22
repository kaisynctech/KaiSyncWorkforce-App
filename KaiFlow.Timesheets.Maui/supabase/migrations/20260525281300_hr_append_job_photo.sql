-- HR / authenticated: append before/after photo URLs on jobs (reliable vs full-row update)
CREATE OR REPLACE FUNCTION public.append_job_photo(
  p_company_id uuid,
  p_job_id     uuid,
  p_phase      text,
  p_photo_url  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF trim(coalesce(p_photo_url, '')) = '' THEN
    RAISE EXCEPTION 'PHOTO_URL_REQUIRED';
  END IF;

  IF lower(trim(coalesce(p_phase, ''))) = 'after' THEN
    UPDATE public.jobs
    SET photo_urls_after = array_append(coalesce(photo_urls_after, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  ELSE
    UPDATE public.jobs
    SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.append_job_photo(uuid, uuid, text, text) TO authenticated;
