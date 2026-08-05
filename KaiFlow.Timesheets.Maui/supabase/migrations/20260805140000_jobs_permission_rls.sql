-- ============================================================
-- Jobs: replace membership-only RLS with jobs.view / jobs.create / jobs.edit
-- ============================================================

DROP POLICY IF EXISTS jobs_all ON public.jobs;
DROP POLICY IF EXISTS "jobs_all" ON public.jobs;
DROP POLICY IF EXISTS jobs_select ON public.jobs;
DROP POLICY IF EXISTS jobs_insert ON public.jobs;
DROP POLICY IF EXISTS jobs_update ON public.jobs;
DROP POLICY IF EXISTS jobs_delete ON public.jobs;

CREATE POLICY jobs_select ON public.jobs
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'jobs.view')
  );

CREATE POLICY jobs_insert ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'jobs.create')
  );

CREATE POLICY jobs_update ON public.jobs
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'jobs.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'jobs.edit')
  );

CREATE POLICY jobs_delete ON public.jobs
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'jobs.edit')
  );

REVOKE ALL ON TABLE public.jobs FROM anon;

-- Ensure assignment RPC is authenticated-only (anon revoked earlier; reaffirm)
REVOKE ALL ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) TO service_role;
