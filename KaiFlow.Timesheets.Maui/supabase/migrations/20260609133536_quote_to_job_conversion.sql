-- Migration: 20260609133536_quote_to_job_conversion
-- Quote to job conversion - contractor portal list jobs (reflects converted-quote jobs)
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_list_jobs(p_company_code text, p_contractor_code text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC), '[]'::json)
  FROM (
    SELECT
      j.id,
      j.title,
      j.status,
      j.job_code,
      j.scheduled_start,
      j.scheduled_end,
      j.contractor_cost,
      j.deal_id,
      j.client_id,
      j.site_id,
      j.photo_urls_before,
      j.photo_urls_after,
      j.created_at,
      j.updated_at,
      (
        SELECT v.id FROM public.job_site_visits v
        WHERE v.job_id         = j.id
          AND v.contractor_id  = ct.id
          AND v.sign_out_at    IS NULL
          AND v.party_type     = 'contractor'
        ORDER BY v.sign_in_at DESC
        LIMIT 1
      ) AS open_visit_id
    FROM public.job_contractors jc
    INNER JOIN public.jobs        j   ON j.id   = jc.job_id
    INNER JOIN public.contractors ct  ON ct.id  = jc.contractor_id
    INNER JOIN public.companies   c   ON c.id   = ct.company_id
    WHERE upper(trim(c.code))             = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.is_active = true
      AND jc.company_id = ct.company_id
      AND jc.status     <> 'cancelled'
  ) t;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_list_jobs(p_company_code text, p_contractor_code text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_list_jobs(p_company_code text, p_contractor_code text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_jobs(p_company_code text, p_contractor_code text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_list_jobs(p_company_code text, p_contractor_code text) TO service_role;

