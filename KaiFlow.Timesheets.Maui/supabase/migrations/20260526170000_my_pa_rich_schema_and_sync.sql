-- Rich My PA schema (Flutter parity) + operational sync (job/project assignments → todos).

DROP FUNCTION IF EXISTS public.employee_insert_pa_task(uuid, uuid, text, text, date, text);

ALTER TABLE public.pa_tasks
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS remind_at timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS linked_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS linked_id text,
  ADD COLUMN IF NOT EXISTS linked_label text,
  ADD COLUMN IF NOT EXISTS recurrence_pattern text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS meeting_with text,
  ADD COLUMN IF NOT EXISTS meeting_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_minutes text,
  ADD COLUMN IF NOT EXISTS meeting_follow_up text,
  ADD COLUMN IF NOT EXISTS owner_hr_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.pa_tasks
SET due_at = (due_date::timestamp AT TIME ZONE 'UTC') + interval '9 hours'
WHERE due_at IS NULL AND due_date IS NOT NULL;

UPDATE public.pa_tasks SET status = 'todo' WHERE status IN ('open', 'pending');

CREATE OR REPLACE FUNCTION public.sync_operational_pa_tasks(
  p_company_id uuid,
  p_scope_employee_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_created integer := 0;
  v_now timestamptz := now();
  v_sid text;
  v_due timestamptz;
  v_title text;
  v_emp uuid;
BEGIN
  -- Job assignment todos (one per assignee per active job).
  FOR r IN
    SELECT j.id, j.title, j.status, j.assignee_employee_id, j.assigned_employee_ids, j.scheduled_end
    FROM public.jobs j
    WHERE j.company_id = p_company_id
      AND coalesce(j.status, '') NOT IN ('completed', 'cancelled')
    LIMIT 500
  LOOP
    v_title := coalesce(nullif(trim(r.title), ''), 'Job');
    v_due := coalesce(r.scheduled_end, v_now + interval '1 day');

    FOR v_emp IN
      SELECT DISTINCT eid FROM (
        SELECT r.assignee_employee_id AS eid
        UNION ALL
        SELECT unnest(coalesce(r.assigned_employee_ids, '{}'::uuid[]))
      ) x
      WHERE eid IS NOT NULL
        AND (p_scope_employee_id IS NULL OR eid = p_scope_employee_id)
    LOOP
      v_sid := r.id::text || '_' || v_emp::text;
      IF EXISTS (
        SELECT 1 FROM public.pa_tasks t
        WHERE t.company_id = p_company_id
          AND t.source_type = 'job_assignment'
          AND t.source_id = v_sid
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.pa_tasks (
        company_id, title, notes, due_at, priority, status,
        linked_type, linked_id, linked_label,
        source_type, source_id, owner_employee_id, assigned_employee_id
      ) VALUES (
        p_company_id,
        'Job assigned: ' || v_title,
        'You are assigned to this job. Open Jobs to work it; mark this done when your part is complete.',
        v_due,
        'medium',
        'todo',
        'job',
        r.id::text,
        v_title,
        'job_assignment',
        v_sid,
        v_emp,
        v_emp
      );
      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  -- Project / deal due for manager or scoped employee.
  FOR r IN
    SELECT d.id, d.title, d.expected_close_date, d.manager_employee_id, d.status
    FROM public.client_deals d
    WHERE d.company_id = p_company_id
      AND d.status IN ('draft', 'sent', 'negotiation', 'won')
      AND d.expected_close_date IS NOT NULL
      AND d.expected_close_date <= (current_date + 3)
      AND (
        p_scope_employee_id IS NULL
        OR d.manager_employee_id = p_scope_employee_id
      )
    LIMIT 120
  LOOP
    v_sid := 'deal_' || r.id::text;
    IF p_scope_employee_id IS NOT NULL THEN
      v_sid := v_sid || '_' || p_scope_employee_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.pa_tasks t
      WHERE t.company_id = p_company_id
        AND t.source_type = 'project_assignment'
        AND t.source_id = v_sid
    ) THEN
      CONTINUE;
    END IF;

    v_emp := coalesce(p_scope_employee_id, r.manager_employee_id);
    v_due := (r.expected_close_date::timestamp AT TIME ZONE 'UTC') + interval '9 hours';

    INSERT INTO public.pa_tasks (
      company_id, title, notes, due_at, priority, status,
      linked_type, linked_id, linked_label,
      source_type, source_id, owner_employee_id, assigned_employee_id
    ) VALUES (
      p_company_id,
      'Project due: ' || coalesce(nullif(trim(r.title), ''), 'Project'),
      'Expected close ' || to_char(r.expected_close_date, 'DD Mon YYYY') || '. Follow up with the client.',
      v_due,
      'high',
      'todo',
      'deal',
      r.id::text,
      r.title,
      'project_assignment',
      v_sid,
      v_emp,
      v_emp
    );
    v_created := v_created + 1;
  END LOOP;

  -- Open jobs ending within 48h (SLA risk) for assignees.
  FOR r IN
    SELECT j.id, j.title, j.scheduled_end, j.assignee_employee_id
    FROM public.jobs j
    WHERE j.company_id = p_company_id
      AND j.status IN ('scheduled', 'inProgress', 'in_progress')
      AND j.scheduled_end IS NOT NULL
      AND j.scheduled_end <= v_now + interval '48 hours'
    LIMIT 200
  LOOP
    v_emp := r.assignee_employee_id;
    IF v_emp IS NULL THEN CONTINUE; END IF;
    IF p_scope_employee_id IS NOT NULL AND v_emp <> p_scope_employee_id THEN CONTINUE; END IF;

    v_sid := 'sla_' || r.id::text || '_' || v_emp::text;
    IF EXISTS (
      SELECT 1 FROM public.pa_tasks t
      WHERE t.company_id = p_company_id AND t.source_type = 'job_sla_risk' AND t.source_id = v_sid
    ) THEN CONTINUE; END IF;

    INSERT INTO public.pa_tasks (
      company_id, title, notes, due_at, priority, status,
      linked_type, linked_id, linked_label, source_type, source_id,
      owner_employee_id, assigned_employee_id
    ) VALUES (
      p_company_id,
      CASE WHEN r.scheduled_end < v_now THEN 'Job overdue window: ' ELSE 'Job ending soon: ' END
        || coalesce(nullif(trim(r.title), ''), 'Job'),
      'Scheduled end ' || to_char(r.scheduled_end AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI') || '. Confirm status or reschedule.',
      CASE WHEN r.scheduled_end < v_now THEN v_now + interval '4 hours' ELSE r.scheduled_end END,
      CASE WHEN r.scheduled_end < v_now THEN 'high' ELSE 'medium' END,
      'todo',
      'job', r.id::text, r.title, 'job_sla_risk', v_sid, v_emp, v_emp
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_operational_pa_tasks(uuid, uuid) TO authenticated;

-- Expanded employee insert
CREATE OR REPLACE FUNCTION public.employee_insert_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_title text,
  p_notes text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_priority text DEFAULT 'medium',
  p_due_at timestamptz DEFAULT NULL,
  p_remind_at timestamptz DEFAULT NULL,
  p_linked_type text DEFAULT 'none',
  p_linked_id text DEFAULT NULL,
  p_linked_label text DEFAULT NULL,
  p_recurrence_pattern text DEFAULT 'none',
  p_meeting_with text DEFAULT NULL,
  p_meeting_at timestamptz DEFAULT NULL,
  p_meeting_minutes text DEFAULT NULL,
  p_meeting_follow_up text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
  v_due timestamptz := coalesce(p_due_at, CASE WHEN p_due_date IS NOT NULL
    THEN (p_due_date::timestamp AT TIME ZONE 'UTC') + interval '9 hours' ELSE NULL END);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  INSERT INTO public.pa_tasks (
    company_id, title, description, notes, due_date, due_at, remind_at,
    priority, status, linked_type, linked_id, linked_label, recurrence_pattern,
    meeting_with, meeting_at, meeting_minutes, meeting_follow_up,
    assigned_employee_id, owner_employee_id, updated_at
  ) VALUES (
    p_company_id, trim(p_title), nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), p_due_date, v_due, p_remind_at,
    coalesce(nullif(trim(p_priority), ''), 'medium'), 'todo',
    coalesce(nullif(trim(p_linked_type), ''), 'none'),
    nullif(trim(coalesce(p_linked_id, '')), ''),
    nullif(trim(coalesce(p_linked_label, '')), ''),
    coalesce(nullif(trim(p_recurrence_pattern), ''), 'none'),
    nullif(trim(coalesce(p_meeting_with, '')), ''),
    p_meeting_at,
    nullif(trim(coalesce(p_meeting_minutes, '')), ''),
    nullif(trim(coalesce(p_meeting_follow_up, '')), ''),
    p_employee_id, p_employee_id, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(
  uuid, uuid, text, text, date, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, text, text
) TO authenticated;
