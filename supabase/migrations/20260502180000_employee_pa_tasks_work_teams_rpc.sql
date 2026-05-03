-- Employee app (company-code login uses anon JWT): RPC + authenticated-worker RLS for PA tasks and teams.
-- Code-login workers cannot satisfy work_team_members.profile_id = auth.uid(); nested selects fail without RPC.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pa_tasks'
  ) THEN
    ALTER TABLE public.pa_tasks ADD COLUMN IF NOT EXISTS meeting_minutes text;
    ALTER TABLE public.pa_tasks ADD COLUMN IF NOT EXISTS meeting_follow_up text;
    COMMENT ON COLUMN public.pa_tasks.meeting_minutes IS 'Post-meeting outcomes / notes.';
    COMMENT ON COLUMN public.pa_tasks.meeting_follow_up IS 'Follow-ups: next steps, another meeting, project won, etc.';
  END IF;
END $$;

-- Authenticated employees (email/OTP): manage rows they own (matches jobs RPC trust model for anon).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pa_tasks'
  ) THEN
    ALTER TABLE public.pa_tasks ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'pa_tasks' AND policyname = 'p_pa_tasks_hr_company'
    ) THEN
      CREATE POLICY p_pa_tasks_hr_company ON public.pa_tasks
        FOR ALL TO authenticated
        USING (company_id = current_hr_company_id())
        WITH CHECK (company_id = current_hr_company_id());
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'pa_tasks' AND policyname = 'p_pa_tasks_employee_own'
    ) THEN
      CREATE POLICY p_pa_tasks_employee_own ON public.pa_tasks
        FOR ALL TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = auth.uid()
              AND e.company_id = pa_tasks.company_id
              AND pa_tasks.owner_employee_id = e.id
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.profile_id = auth.uid()
              AND e.company_id = pa_tasks.company_id
              AND pa_tasks.owner_employee_id = e.id
          )
        );
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.employee_get_work_teams(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS TABLE (
  id bigint,
  company_id bigint,
  name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wt.id, wt.company_id, wt.name, wt.created_at
  FROM public.work_teams wt
  INNER JOIN public.work_team_members m
    ON m.team_id = wt.id AND m.company_id = wt.company_id
  WHERE m.company_id = p_company_id
    AND m.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
$$;

CREATE OR REPLACE FUNCTION public.employee_get_pa_tasks(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS SETOF public.pa_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.*
  FROM public.pa_tasks t
  WHERE t.company_id = p_company_id
    AND t.owner_employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    )
  ORDER BY t.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.employee_insert_pa_task(
  p_company_id bigint,
  p_employee_id bigint,
  p_title text,
  p_notes text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL,
  p_priority text DEFAULT 'medium',
  p_remind_at timestamptz DEFAULT NULL,
  p_linked_type text DEFAULT 'none',
  p_linked_id text DEFAULT NULL,
  p_linked_label text DEFAULT NULL,
  p_recurrence_pattern text DEFAULT 'none',
  p_source_type text DEFAULT NULL,
  p_source_id text DEFAULT NULL,
  p_meeting_with text DEFAULT NULL,
  p_meeting_at timestamptz DEFAULT NULL,
  p_meeting_minutes text DEFAULT NULL,
  p_meeting_follow_up text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  INSERT INTO public.pa_tasks (
    company_id,
    title,
    notes,
    due_at,
    priority,
    status,
    remind_at,
    linked_type,
    linked_id,
    linked_label,
    recurrence_pattern,
    source_type,
    source_id,
    meeting_with,
    meeting_at,
    owner_employee_id,
    owner_hr_user_id,
    meeting_minutes,
    meeting_follow_up
  ) VALUES (
    p_company_id,
    trim(p_title),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_due_at,
    COALESCE(NULLIF(trim(p_priority), ''), 'medium'),
    'todo',
    p_remind_at,
    COALESCE(NULLIF(trim(p_linked_type), ''), 'none'),
    NULLIF(trim(COALESCE(p_linked_id, '')), ''),
    NULLIF(trim(COALESCE(p_linked_label, '')), ''),
    COALESCE(NULLIF(trim(p_recurrence_pattern), ''), 'none'),
    NULLIF(trim(COALESCE(p_source_type, '')), ''),
    NULLIF(trim(COALESCE(p_source_id, '')), ''),
    NULLIF(trim(COALESCE(p_meeting_with, '')), ''),
    p_meeting_at,
    p_employee_id,
    NULL,
    NULLIF(trim(COALESCE(p_meeting_minutes, '')), ''),
    NULLIF(trim(COALESCE(p_meeting_follow_up, '')), '')
  )
  RETURNING pa_tasks.id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_update_pa_task(
  p_company_id bigint,
  p_employee_id bigint,
  p_task_id bigint,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pa_tasks t
    WHERE t.id = p_task_id
      AND t.company_id = p_company_id
      AND t.owner_employee_id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks t SET
    title = CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE t.title END,
    notes = CASE
      WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '')
      ELSE t.notes
    END,
    priority = CASE WHEN p_patch ? 'priority' THEN trim(p_patch->>'priority') ELSE t.priority END,
    due_at = CASE
      WHEN NOT (p_patch ? 'due_at') THEN t.due_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'due_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'due_at')::timestamptz
    END,
    remind_at = CASE
      WHEN NOT (p_patch ? 'remind_at') THEN t.remind_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'remind_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'remind_at')::timestamptz
    END,
    linked_type = CASE WHEN p_patch ? 'linked_type' THEN trim(p_patch->>'linked_type') ELSE t.linked_type END,
    linked_id = CASE
      WHEN NOT (p_patch ? 'linked_id') THEN t.linked_id
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_id', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_id')
    END,
    linked_label = CASE
      WHEN NOT (p_patch ? 'linked_label') THEN t.linked_label
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_label', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_label')
    END,
    recurrence_pattern = CASE WHEN p_patch ? 'recurrence_pattern' THEN trim(p_patch->>'recurrence_pattern') ELSE t.recurrence_pattern END,
    source_type = CASE
      WHEN NOT (p_patch ? 'source_type') THEN t.source_type
      WHEN NULLIF(trim(COALESCE(p_patch->>'source_type', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'source_type')
    END,
    source_id = CASE
      WHEN NOT (p_patch ? 'source_id') THEN t.source_id
      WHEN NULLIF(trim(COALESCE(p_patch->>'source_id', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'source_id')
    END,
    meeting_with = CASE
      WHEN NOT (p_patch ? 'meeting_with') THEN t.meeting_with
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_with', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_with')
    END,
    meeting_at = CASE
      WHEN NOT (p_patch ? 'meeting_at') THEN t.meeting_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'meeting_at')::timestamptz
    END,
    meeting_minutes = CASE
      WHEN NOT (p_patch ? 'meeting_minutes') THEN t.meeting_minutes
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_minutes', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_minutes')
    END,
    meeting_follow_up = CASE
      WHEN NOT (p_patch ? 'meeting_follow_up') THEN t.meeting_follow_up
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_follow_up', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_follow_up')
    END,
    updated_at = now()
  WHERE t.id = p_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_delete_pa_task(
  p_company_id bigint,
  p_employee_id bigint,
  p_task_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND t.owner_employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_update_pa_task_status(
  p_company_id bigint,
  p_employee_id bigint,
  p_task_id bigint,
  p_status text,
  p_snoozed_until timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.pa_tasks%ROWTYPE;
  recurrence text;
  next_due timestamptz;
  base_due timestamptz;
BEGIN
  SELECT * INTO rec FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND t.owner_employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks SET
    status = p_status,
    snoozed_until = p_snoozed_until,
    completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id;

  recurrence := COALESCE(rec.recurrence_pattern, 'none');

  IF p_status = 'done' AND recurrence <> 'none' THEN
    base_due := COALESCE(rec.due_at, now());

    next_due := CASE recurrence
      WHEN 'daily' THEN base_due + interval '1 day'
      WHEN 'weekly' THEN base_due + interval '7 days'
      WHEN 'monthly' THEN base_due + interval '1 month'
      ELSE base_due + interval '1 day'
    END;

    INSERT INTO public.pa_tasks (
      company_id,
      title,
      notes,
      due_at,
      priority,
      status,
      remind_at,
      linked_type,
      linked_id,
      linked_label,
      recurrence_pattern,
      source_type,
      source_id,
      meeting_with,
      meeting_at,
      owner_employee_id,
      owner_hr_user_id,
      meeting_minutes,
      meeting_follow_up
    ) VALUES (
      rec.company_id,
      rec.title,
      rec.notes,
      next_due,
      COALESCE(rec.priority, 'medium'),
      'todo',
      NULL,
      COALESCE(rec.linked_type, 'none'),
      rec.linked_id,
      rec.linked_label,
      recurrence,
      rec.source_type,
      rec.source_id,
      rec.meeting_with,
      rec.meeting_at,
      rec.owner_employee_id,
      rec.owner_hr_user_id,
      NULL,
      NULL
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_tasks(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(
  bigint, bigint, text, text, timestamptz, text, timestamptz,
  text, text, text, text, text, text, text, timestamptz, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(bigint, bigint, bigint, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(bigint, bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(bigint, bigint, bigint, text, timestamptz)
  TO anon, authenticated;
