-- Migration: 20260609130300_contractor_activity_polish
-- Polish/refinements to contractor activity - visit history and site sign-in/out
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_visit_history(p_company_code text, p_contractor_code text, p_job_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.sign_in_at DESC), '[]'::json)
  FROM (
    SELECT v.*
    FROM public.job_site_visits v
    INNER JOIN public.contractors ct ON ct.id = v.contractor_id
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND v.party_type = 'contractor'
      AND (p_job_id IS NULL OR v.job_id = p_job_id)
  ) t;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_visit_history(p_company_code text, p_contractor_code text, p_job_id uuid DEFAULT NULL::uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_visit_history(p_company_code text, p_contractor_code text, p_job_id uuid DEFAULT NULL::uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_visit_history(p_company_code text, p_contractor_code text, p_job_id uuid DEFAULT NULL::uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_visit_history(p_company_code text, p_contractor_code text, p_job_id uuid DEFAULT NULL::uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_open_visit(p_company_code text, p_contractor_code text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT row_to_json(v)
  FROM public.job_site_visits v
  INNER JOIN public.contractors ct ON ct.id = v.contractor_id
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND v.party_type = 'contractor'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_open_visit(p_company_code text, p_contractor_code text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_open_visit(p_company_code text, p_contractor_code text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_open_visit(p_company_code text, p_contractor_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_open_visit(p_company_code text, p_contractor_code text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_site_sign_in(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_reported_by_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.job_site_visits%ROWTYPE;
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

  IF EXISTS (
    SELECT 1 FROM public.job_site_visits v
    WHERE v.contractor_id = v_ct.id
      AND v.sign_out_at IS NULL
      AND v.party_type = 'contractor'
  ) THEN
    RAISE EXCEPTION 'ALREADY_ON_SITE';
  END IF;

  INSERT INTO public.job_site_visits (
    company_id, job_id, party_type, contractor_id,
    sign_in_at, sign_in_latitude, sign_in_longitude, sign_in_address,
    reported_by_name, notes
  ) VALUES (
    v_ct.company_id, p_job_id, 'contractor', v_ct.id,
    now(), p_latitude, p_longitude, p_address,
    p_reported_by_name, p_notes
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_site_sign_in(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_reported_by_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_site_sign_in(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_reported_by_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_in(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_reported_by_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_in(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_reported_by_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_site_sign_out(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_row public.job_site_visits%ROWTYPE;
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

  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      sign_out_latitude = p_latitude,
      sign_out_longitude = p_longitude,
      sign_out_address = p_address,
      notes = coalesce(p_notes, v.notes)
  WHERE v.contractor_id = v_ct.id
    AND v.job_id = p_job_id
    AND v.party_type = 'contractor'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_site_sign_out(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_site_sign_out(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_out(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_site_sign_out(p_company_code text, p_contractor_code text, p_job_id uuid, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_address text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) TO service_role;

