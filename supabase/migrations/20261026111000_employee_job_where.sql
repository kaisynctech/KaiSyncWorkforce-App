-- Technician job card: the job's area path and service (Phase 2).
CREATE OR REPLACE FUNCTION public.employee_get_job_where(
  p_company_id uuid, p_employee_id uuid, p_job_id uuid, p_session_token text DEFAULT NULL)
RETURNS TABLE (area_path text, service_name text, service_description text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;
  RETURN QUERY
    SELECT CASE WHEN pa.name IS NOT NULL THEN pa.name || ' › ' || ar.name ELSE ar.name END,
           s.name, s.description
    FROM public.jobs j
    LEFT JOIN public.site_areas ar ON ar.id = j.area_id
    LEFT JOIN public.site_areas pa ON pa.id = ar.parent_area_id
    LEFT JOIN public.job_services s ON s.id = j.service_id
    WHERE j.id = p_job_id AND j.company_id = p_company_id;
END $$;
