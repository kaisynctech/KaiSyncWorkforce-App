-- Client portal: list every job owned by the signed-in client.
-- A project name is included only when the job is linked to a project
-- that is shared with that same client. Private jobs stay hidden.

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
    INNER JOIN public.clients cl
      ON cl.id = j.client_id
     AND cl.company_id = j.company_id
    INNER JOIN public.companies c
      ON c.id = j.company_id
    LEFT JOIN public.client_deals d
      ON d.id = j.deal_id
     AND d.company_id = j.company_id
     AND d.client_id = j.client_id
     AND d.visibility <> 'private'
    WHERE upper(trim(c.code)) = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
      AND coalesce(cl.portal_enabled, false) = true
      AND j.visibility IS DISTINCT FROM 'private'
      AND NOT (
        j.visibility = 'inherit'
        AND EXISTS (
          SELECT 1
          FROM public.client_deals hidden
          WHERE hidden.id = j.deal_id
            AND hidden.company_id = j.company_id
            AND hidden.visibility = 'private'
        )
      )
  ) t;
$$;

REVOKE ALL ON FUNCTION public.client_portal_list_jobs(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_list_jobs(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.client_portal_list_jobs(text, text) IS
  'Portal job list for one client code. Includes jobs with no project. Omits private jobs and jobs that inherit a private project.';
