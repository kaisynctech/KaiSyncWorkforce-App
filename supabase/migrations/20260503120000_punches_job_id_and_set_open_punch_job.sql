-- Optional job on a punch session (clock-in row) for job-level time / costing.
ALTER TABLE public.punches
  ADD COLUMN IF NOT EXISTS job_id bigint REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_punches_job_id
  ON public.punches(job_id) WHERE job_id IS NOT NULL;

-- After sign-in, link the open session for that work date to a job the worker is allowed to use.
CREATE OR REPLACE FUNCTION public.employee_set_open_punch_job(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_work_date date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id bigint;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND (
        j.assignee_employee_id IS NOT DISTINCT FROM p_employee_id
        OR j.contractor_employee_id IS NOT DISTINCT FROM p_employee_id
        OR j.assigned_employee_ids @> ARRAY[p_employee_id]
      )
  ) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  SELECT p2.id INTO v_row_id
  FROM public.punches p2
  WHERE p2.company_id = p_company_id
    AND p2.employees_id = p_employee_id
    AND p2."Date" = p_work_date
    AND p2.sign_out IS NULL
  ORDER BY p2.id DESC
  LIMIT 1;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'NO_OPEN_PUNCH_SESSION';
  END IF;

  UPDATE public.punches p
  SET job_id = p_job_id
  WHERE p.id = v_row_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_set_open_punch_job(bigint, bigint, bigint, date)
  TO anon, authenticated;
