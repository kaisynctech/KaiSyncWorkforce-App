-- Fix employee My Jobs: allow code-login (anon) to list assigned jobs, and persist team assignments via RPC.

-- 1) Employee job list (code login uses anon key — must match leave/punch RPCs)
REVOKE ALL ON FUNCTION public.employee_get_jobs_for_employee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_jobs_for_employee(uuid, uuid) TO anon, authenticated;

-- 2) Persist assignee + team array in SQL (Postgrest often drops uuid[] on insert/update)
CREATE OR REPLACE FUNCTION public.hr_set_job_assignments(
  p_job_id uuid,
  p_company_id uuid,
  p_assignee_employee_id uuid DEFAULT NULL,
  p_assigned_employee_ids uuid[] DEFAULT '{}'
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_job public.jobs%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF p_job_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'job_id and company_id are required';
  END IF;

  v_ids := COALESCE(p_assigned_employee_ids, '{}'::uuid[]);
  IF p_assignee_employee_id IS NOT NULL
     AND NOT (p_assignee_employee_id = ANY (v_ids)) THEN
    v_ids := array_prepend(p_assignee_employee_id, v_ids);
  END IF;

  IF array_length(v_ids, 1) IS NOT NULL AND array_length(v_ids, 1) > 0
     AND p_assignee_employee_id IS NULL THEN
    p_assignee_employee_id := v_ids[1];
  END IF;

  UPDATE public.jobs j
  SET assignee_employee_id = p_assignee_employee_id,
      assigned_employee_ids = v_ids,
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found';
  END IF;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_set_job_assignments(uuid, uuid, uuid, uuid[]) TO anon, authenticated;
