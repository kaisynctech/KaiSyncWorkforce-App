-- Employee incident reports via RPC (code login / anon cannot insert through RLS).

CREATE OR REPLACE FUNCTION public.employee_insert_incident(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_description      text,
  p_severity         text DEFAULT 'low',
  p_job_id           uuid DEFAULT NULL,
  p_site_id          uuid DEFAULT NULL,
  p_assignee_id      uuid DEFAULT NULL,
  p_photo_urls       text[] DEFAULT '{}',
  p_reported_by_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row public.incident_reports%ROWTYPE;
BEGIN
  IF trim(coalesce(p_description, '')) = '' THEN
    RAISE EXCEPTION 'DESCRIPTION_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  IF p_job_id IS NOT NULL
     AND NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  INSERT INTO public.incident_reports (
    company_id,
    employee_id,
    job_id,
    site_id,
    description,
    severity,
    photo_urls,
    assignee_id,
    reported_by_name,
    is_closed,
    created_at
  ) VALUES (
    p_company_id,
    p_employee_id,
    p_job_id,
    p_site_id,
    trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    coalesce(p_photo_urls, '{}'),
    p_assignee_id,
    nullif(trim(coalesce(p_reported_by_name, '')), ''),
    false,
    now()
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_insert_incident(
  uuid, uuid, text, text, uuid, uuid, uuid, text[], text
) TO anon, authenticated;
