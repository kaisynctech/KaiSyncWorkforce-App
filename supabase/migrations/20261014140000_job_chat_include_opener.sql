-- The person who opens a job chat must be a participant, otherwise the
-- messages list never shows the thread they just created.
CREATE OR REPLACE FUNCTION public.ensure_job_team_message_thread(
  p_company_id uuid,
  p_job_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_tid uuid;
  v_title text;
  v_members uuid[];
BEGIN
  SELECT j.title INTO v_title
  FROM public.jobs j
  WHERE j.id = p_job_id AND j.company_id = p_company_id;
  IF v_title IS NULL THEN RAISE EXCEPTION 'job not found'; END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO v_members
  FROM (
    SELECT unnest(coalesce(j.assigned_employee_ids, '{}'::uuid[])) AS x
    FROM public.jobs j
    WHERE j.id = p_job_id
    UNION
    SELECT j.assignee_employee_id
    FROM public.jobs j
    WHERE j.id = p_job_id AND j.assignee_employee_id IS NOT NULL
    UNION
    SELECT j.contractor_employee_id
    FROM public.jobs j
    WHERE j.id = p_job_id AND j.contractor_employee_id IS NOT NULL
    UNION
    SELECT e.id
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
  ) s
  WHERE x IS NOT NULL;

  SELECT t.id INTO v_tid
  FROM public.message_threads t
  WHERE t.company_id = p_company_id AND t.subject = 'Job:' || p_job_id::text
  LIMIT 1;

  IF v_tid IS NULL THEN
    INSERT INTO public.message_threads (company_id, subject, type_raw, participant_ids)
    VALUES (p_company_id, 'Job:' || p_job_id::text, 'job', coalesce(v_members, '{}'::uuid[]))
    RETURNING id INTO v_tid;
  ELSE
    UPDATE public.message_threads
    SET subject = 'Job:' || p_job_id::text,
        participant_ids = coalesce(v_members, '{}'::uuid[])
    WHERE id = v_tid;
  END IF;
  RETURN v_tid;
END;
$$;
