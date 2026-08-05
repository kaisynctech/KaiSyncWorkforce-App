-- Job site visits: idempotent same-job sign-in, sign out any open visit, switch jobs.

CREATE OR REPLACE FUNCTION public.employee_job_site_sign_in(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open public.job_site_visits%ROWTYPE;
  v_row  public.job_site_visits%ROWTYPE;
BEGIN
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  SELECT * INTO v_open
  FROM public.job_site_visits v
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_open.job_id = p_job_id THEN
      RETURN row_to_json(v_open);
    END IF;
    RAISE EXCEPTION 'ALREADY_ON_SITE';
  END IF;

  INSERT INTO public.job_site_visits (
    company_id, job_id, party_type, employee_id,
    sign_in_at, sign_in_latitude, sign_in_longitude, sign_in_address,
    reported_by_name, notes
  ) VALUES (
    p_company_id, p_job_id, 'employee', p_employee_id,
    now(), p_latitude, p_longitude, p_address,
    p_reported_by_name, p_notes
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_out_open_visit(
  p_company_id  uuid,
  p_employee_id uuid,
  p_notes       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      notes = coalesce(p_notes, v.notes)
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_job_site_switch_to_job(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      notes = coalesce(v.notes, '') || ' (switched to another job)'
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
    AND v.job_id IS DISTINCT FROM p_job_id;

  RETURN public.employee_job_site_sign_in(
    p_company_id, p_employee_id, p_job_id,
    p_latitude, p_longitude, p_address, p_reported_by_name, p_notes
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_out_open_visit(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_switch_to_job(
  uuid, uuid, uuid, double precision, double precision, text, text, text
) TO anon, authenticated;
