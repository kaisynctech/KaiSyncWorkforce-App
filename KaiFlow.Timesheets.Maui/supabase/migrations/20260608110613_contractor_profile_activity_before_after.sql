-- Migration: 20260608110613_contractor_profile_activity_before_after
-- Before/after photo state on contractor activity feed and jobs
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_append_job_photo(p_company_code text, p_contractor_code text, p_job_id uuid, p_phase text, p_photo_url text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;

  IF lower(trim(p_phase)) = 'after' THEN
    UPDATE public.jobs
    SET photo_urls_after = array_append(coalesce(photo_urls_after, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id;
  ELSE
    UPDATE public.jobs
    SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id;
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  RETURN row_to_json(v_job);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_append_job_photo(p_company_code text, p_contractor_code text, p_job_id uuid, p_phase text, p_photo_url text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_append_job_photo(p_company_code text, p_contractor_code text, p_job_id uuid, p_phase text, p_photo_url text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_append_job_photo(p_company_code text, p_contractor_code text, p_job_id uuid, p_phase text, p_photo_url text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_append_job_photo(p_company_code text, p_contractor_code text, p_job_id uuid, p_phase text, p_photo_url text) TO service_role;

