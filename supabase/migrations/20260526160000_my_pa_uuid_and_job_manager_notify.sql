-- My PA uuid RPCs, schema compatibility, manager job notifications, PA reminders.

ALTER TABLE public.pa_tasks
  ADD COLUMN IF NOT EXISTS owner_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;
UPDATE public.pa_tasks
SET owner_employee_id = assigned_employee_id
WHERE owner_employee_id IS NULL AND assigned_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pa_tasks_owner
  ON public.pa_tasks(company_id, owner_employee_id);
DROP FUNCTION IF EXISTS public.employee_get_pa_tasks(bigint, bigint);
CREATE OR REPLACE FUNCTION public.employee_get_pa_tasks(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.pa_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT t.*
  FROM public.pa_tasks t
  WHERE t.company_id = p_company_id
    AND (
      t.owner_employee_id = p_employee_id
      OR t.assigned_employee_id = p_employee_id
    )
  ORDER BY t.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.employee_get_pa_tasks(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_tasks(uuid, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.employee_insert_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_title text,
  p_notes text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_priority text DEFAULT 'medium'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
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
    description,
    notes,
    due_date,
    priority,
    status,
    assigned_employee_id,
    owner_employee_id
  ) VALUES (
    p_company_id,
    trim(p_title),
    NULLIF(trim(coalesce(p_notes, '')), ''),
    NULLIF(trim(coalesce(p_notes, '')), ''),
    p_due_date,
    coalesce(nullif(trim(p_priority), ''), 'medium'),
    'open',
    p_employee_id,
    p_employee_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(uuid, uuid, text, text, date, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.employee_notify_manager_job_created(
  p_company_id uuid,
  p_manager_user_id uuid,
  p_job_id uuid,
  p_employee_id uuid,
  p_job_title text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mgr_employee_id uuid;
  v_employee_name text;
BEGIN
  IF p_manager_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_mgr_employee_id
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = p_manager_user_id
    AND e.is_active = true
  LIMIT 1;

  IF v_mgr_employee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
  INTO v_employee_name
  FROM public.employees e
  WHERE e.id = p_employee_id;

  INSERT INTO public.app_notifications (
    company_id,
    audience,
    recipient_auth_user_id,
    recipient_employee_id,
    type,
    title,
    body,
    ref_type,
    ref_id,
    dedupe_key,
    data
  ) VALUES (
    p_company_id,
    'hr',
    p_manager_user_id,
    v_mgr_employee_id,
    'employee_job_created',
    'New job from ' || coalesce(nullif(v_employee_name, ''), 'employee'),
    coalesce(nullif(trim(p_job_title), ''), 'Job') || ' was added and needs your attention.',
    'job',
    p_job_id::text,
    'employee_job_created:' || p_job_id::text || ':' || v_mgr_employee_id::text,
    jsonb_build_object(
      'job_id', p_job_id,
      'employee_id', p_employee_id,
      'job_title', p_job_title
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_notify_manager_job_created(uuid, uuid, uuid, uuid, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.enqueue_pa_task_notifications(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_window text := to_char(now(), 'YYYYMMDDHH24');
BEGIN
  FOR r IN
    SELECT t.id, t.title, t.due_date, t.owner_employee_id, t.assigned_employee_id
    FROM public.pa_tasks t
    WHERE t.company_id = p_company_id
      AND t.status NOT IN ('completed', 'cancelled', 'done')
      AND (
        (t.due_date IS NOT NULL AND t.due_date <= current_date + 1)
      )
    LIMIT 50
  LOOP
    DECLARE
      v_emp_id uuid := coalesce(r.owner_employee_id, r.assigned_employee_id);
      v_user_id uuid;
    BEGIN
      IF v_emp_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT e.user_id INTO v_user_id
      FROM public.employees e
      WHERE e.id = v_emp_id AND e.company_id = p_company_id;

      IF v_user_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.app_notifications (
        company_id, audience, recipient_auth_user_id, recipient_employee_id,
        type, title, body, ref_type, ref_id, dedupe_key, data
      ) VALUES (
        p_company_id,
        'employee',
        v_user_id,
        v_emp_id,
        'pa_task_due',
        'My PA — due soon',
        coalesce(r.title, 'Task') || ' is due soon. Open My PA to review.',
        'pa_task',
        r.id::text,
        'pa_task_due:' || r.id::text || ':' || v_window,
        jsonb_build_object('pa_task_id', r.id)
      )
      ;

      v_count := v_count + 1;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_pa_task_notifications(uuid) TO authenticated;
