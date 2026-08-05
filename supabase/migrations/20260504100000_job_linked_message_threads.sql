-- Optional link from a group message thread to a job. HR can ensure one thread
-- per job; members mirror job assignees (assigned_employee_ids + assignee + contractor employee).

ALTER TABLE public.app_message_threads
  ADD COLUMN IF NOT EXISTS job_id bigint REFERENCES public.jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_message_threads_company_job
  ON public.app_message_threads (company_id, job_id)
  WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_message_threads_job
  ON public.app_message_threads (job_id)
  WHERE job_id IS NOT NULL;
COMMENT ON COLUMN public.app_message_threads.job_id IS
  'When set, this group thread is the job crew channel; members follow job assignments.';
CREATE OR REPLACE FUNCTION public.ensure_job_team_message_thread(
  p_company_id bigint,
  p_job_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid bigint;
  v_title text;
  v_members bigint[];
  uid bigint;
BEGIN
  IF current_hr_company_id() IS NULL OR current_hr_company_id() <> p_company_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT j.title INTO v_title
  FROM public.jobs j
  WHERE j.id = p_job_id AND j.company_id = p_company_id;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT s.x
      FROM (
        SELECT unnest(COALESCE(j.assigned_employee_ids, ARRAY[]::bigint[])) AS x
        FROM public.jobs j
        WHERE j.id = p_job_id AND j.company_id = p_company_id
        UNION ALL
        SELECT j.assignee_employee_id AS x
        FROM public.jobs j
        WHERE j.id = p_job_id AND j.company_id = p_company_id
          AND j.assignee_employee_id IS NOT NULL
        UNION ALL
        SELECT j.contractor_employee_id AS x
        FROM public.jobs j
        WHERE j.id = p_job_id AND j.company_id = p_company_id
          AND j.contractor_employee_id IS NOT NULL
      ) s
      WHERE s.x IS NOT NULL
      ORDER BY s.x
    ),
    ARRAY[]::bigint[]
  )
  INTO v_members;

  SELECT t.id INTO v_tid
  FROM public.app_message_threads t
  WHERE t.company_id = p_company_id
    AND t.job_id = p_job_id
  LIMIT 1;

  IF v_tid IS NULL THEN
    INSERT INTO public.app_message_threads (
      company_id,
      title,
      thread_type,
      job_id,
      created_by_hr_user_id
    )
    VALUES (
      p_company_id,
      left(trim(v_title), 200),
      'group',
      p_job_id,
      auth.uid()
    )
    RETURNING id INTO v_tid;
  ELSE
    UPDATE public.app_message_threads
    SET title = left(trim(v_title), 200)
    WHERE id = v_tid;
  END IF;

  IF v_members IS NULL OR cardinality(v_members) = 0 THEN
    RETURN v_tid;
  END IF;

  DELETE FROM public.app_message_thread_members m
  WHERE m.thread_id = v_tid
    AND m.member_employee_id IS NOT NULL
    AND NOT (m.member_employee_id = ANY (v_members));

  FOREACH uid IN ARRAY v_members LOOP
    INSERT INTO public.app_message_thread_members (
      company_id,
      thread_id,
      member_employee_id,
      role
    )
    VALUES (
      p_company_id,
      v_tid,
      uid,
      'member'
    )
    ON CONFLICT ON CONSTRAINT uq_thread_member_employee DO NOTHING;
  END LOOP;

  RETURN v_tid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.ensure_job_team_message_thread(bigint, bigint)
  TO authenticated;
