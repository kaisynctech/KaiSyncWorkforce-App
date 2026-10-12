-- Include jobs that sit on the client's project even when jobs.client_id is empty.
-- The project name is still shown only for a project owned by that client.

CREATE OR REPLACE FUNCTION public.client_portal_list_jobs(
  p_company_code text,
  p_client_code  text
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    json_agg(row_to_json(t) ORDER BY t.scheduled_start DESC NULLS LAST, t.created_at DESC),
    '[]'::json
  )
  FROM (
    SELECT
      j.id,
      j.job_code,
      j.title,
      j.status,
      j.scheduled_start,
      j.scheduled_end,
      j.created_at,
      d.id AS deal_id,
      d.project_code,
      d.title AS project_title
    FROM public.jobs j
    INNER JOIN public.companies c
      ON c.id = j.company_id
    INNER JOIN public.clients cl
      ON cl.company_id = j.company_id
     AND cl.client_code IS NOT NULL
     AND coalesce(cl.portal_enabled, false) = true
     AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
    LEFT JOIN public.client_deals d
      ON d.id = j.deal_id
     AND d.company_id = j.company_id
     AND d.client_id = cl.id
     AND d.visibility <> 'private'
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND (
        j.client_id = cl.id
        OR d.id IS NOT NULL
      )
      AND j.visibility IS DISTINCT FROM 'private'
      AND NOT (
        j.visibility = 'inherit'
        AND d.id IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.client_deals hidden
          WHERE hidden.id = j.deal_id
            AND hidden.company_id = j.company_id
            AND hidden.client_id = cl.id
            AND hidden.visibility = 'private'
        )
      )
  ) t;
$$;

REVOKE ALL ON FUNCTION public.client_portal_list_jobs(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_list_jobs(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.client_portal_list_jobs(text, text) IS
  'Portal job list for one client code. Includes jobs with no project and jobs on that client''s shared projects. Omits private jobs.';
