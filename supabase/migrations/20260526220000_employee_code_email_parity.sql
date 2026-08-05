-- Company-code (anon) and email (authenticated) employee parity: same RPC access for in-app features.

-- ─── Notifications (code login has no auth.uid) ───────────────────────────────

CREATE OR REPLACE FUNCTION public.employee_get_my_notifications_for_employee(p_employee_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(n) ORDER BY n.created_at DESC), '[]'::json)
    FROM (
      SELECT
        id, company_id, type, title, body, ref_type, ref_id,
        data, is_read, read_at, created_at
      FROM public.app_notifications
      WHERE audience IN ('employee', 'all')
        AND (
          recipient_employee_id = p_employee_id
          OR recipient_auth_user_id IN (
            SELECT user_id FROM public.employees WHERE id = p_employee_id AND user_id IS NOT NULL
          )
        )
      ORDER BY created_at DESC
      LIMIT 50
    ) n
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_mark_notification_read_for_employee(
  p_employee_id uuid,
  p_notification_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.app_notifications
  SET is_read = true, read_at = now()
  WHERE id = p_notification_id
    AND (
      recipient_employee_id = p_employee_id
      OR recipient_auth_user_id IN (
        SELECT user_id FROM public.employees WHERE id = p_employee_id AND user_id IS NOT NULL
      )
    );
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_my_notifications_for_employee(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_notification_read_for_employee(uuid, bigint) TO anon, authenticated;
-- ─── Jobs: single job + photos (employee must be assigned) ────────────────────

CREATE OR REPLACE FUNCTION public.employee_get_job_for_employee(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
RETURNS SETOF public.jobs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT j.*
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR (
        j.contractor_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.contractor_member_links cml
          WHERE cml.company_id = p_company_id
            AND cml.employee_id = p_employee_id
            AND cml.contractor_id = j.contractor_id
        )
      )
    )
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.employee_get_job_photo_urls(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'photo_urls_before', coalesce(j.photo_urls_before, '{}'::text[]),
    'photo_urls_after', coalesce(j.photo_urls_after, '{}'::text[])
  )
  FROM public.employee_get_job_for_employee(p_company_id, p_employee_id, p_job_id) j
  LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public.employee_append_job_photo(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_phase text,
  p_photo_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF trim(coalesce(p_photo_url, '')) = '' THEN
    RAISE EXCEPTION 'PHOTO_URL_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employee_get_job_for_employee(p_company_id, p_employee_id, p_job_id)
  ) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  IF lower(trim(coalesce(p_phase, ''))) = 'after' THEN
    UPDATE public.jobs
    SET photo_urls_after = array_append(coalesce(photo_urls_after, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  ELSE
    UPDATE public.jobs
    SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_photo_urls(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_append_job_photo(uuid, uuid, uuid, text, text) TO anon, authenticated;
-- ─── Directory, teams, leave calendar, absences, incidents ────────────────────

CREATE OR REPLACE FUNCTION public.employee_list_company_peers(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.employees
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT e.*
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.employees self
      WHERE self.id = p_employee_id AND self.company_id = p_company_id
    )
  ORDER BY e.name NULLS LAST, e.surname NULLS LAST;
$$;
CREATE OR REPLACE FUNCTION public.employee_get_work_teams(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.work_teams
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT wt.*
  FROM public.work_teams wt
  WHERE wt.company_id = p_company_id
    AND wt.member_ids @> ARRAY[p_employee_id]
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
$$;
CREATE OR REPLACE FUNCTION public.employee_get_company_approved_leave(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.leave_requests
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT lr.*
  FROM public.leave_requests lr
  WHERE lr.company_id = p_company_id
    AND lr.status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
$$;
CREATE OR REPLACE FUNCTION public.employee_get_daily_absences(
  p_company_id uuid,
  p_employee_id uuid,
  p_from date,
  p_to date
)
RETURNS SETOF public.daily_absences
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT da.*
  FROM public.daily_absences da
  WHERE da.company_id = p_company_id
    AND da.employee_id = p_employee_id
    AND da.date >= p_from
    AND da.date <= p_to
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    )
  ORDER BY da.date DESC;
$$;
CREATE OR REPLACE FUNCTION public.employee_get_own_incidents(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.incident_reports
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT i.*
  FROM public.incident_reports i
  WHERE i.company_id = p_company_id
    AND i.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    )
  ORDER BY i.created_at DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.employee_list_company_peers(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_approved_leave(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_daily_absences(uuid, uuid, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_own_incidents(uuid, uuid) TO anon, authenticated;
-- ─── My PA: uuid RPCs + settings read (anon grants) ───────────────────────────

CREATE OR REPLACE FUNCTION public.employee_get_pa_settings(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.employee_pa_settings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT s.*
  FROM public.employee_pa_settings s
  WHERE s.company_id = p_company_id
    AND s.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_settings(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_tasks(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(
  uuid, uuid, text, text, date, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, text, text
) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_notify_manager_job_created(uuid, uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_operational_pa_tasks(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_employee_pa_settings(uuid, uuid, boolean, boolean, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pa_task_notifications(uuid) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.employee_update_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid,
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
      AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id)
  ) THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks t SET
    title = CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE t.title END,
    notes = CASE
      WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '')
      ELSE t.notes
    END,
    description = CASE
      WHEN p_patch ? 'description' THEN NULLIF(trim(COALESCE(p_patch->>'description', '')), '')
      ELSE t.description
    END,
    priority = CASE WHEN p_patch ? 'priority' THEN trim(p_patch->>'priority') ELSE t.priority END,
    status = CASE WHEN p_patch ? 'status' THEN trim(p_patch->>'status') ELSE t.status END,
    due_date = CASE
      WHEN NOT (p_patch ? 'due_date') THEN t.due_date
      WHEN NULLIF(trim(COALESCE(p_patch->>'due_date', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'due_date')::date
    END,
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
    snoozed_until = CASE
      WHEN NOT (p_patch ? 'snoozed_until') THEN t.snoozed_until
      WHEN NULLIF(trim(COALESCE(p_patch->>'snoozed_until', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'snoozed_until')::timestamptz
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
    completed_at = CASE
      WHEN NOT (p_patch ? 'completed_at') THEN t.completed_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'completed_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'completed_at')::timestamptz
    END,
    updated_at = now()
  WHERE t.id = p_task_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_delete_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid
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
    AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_update_pa_task_status(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid,
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
    AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks SET
    status = p_status,
    snoozed_until = p_snoozed_until,
    completed_at = CASE WHEN p_status IN ('done', 'completed') THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id;

  recurrence := COALESCE(rec.recurrence_pattern, 'none');

  IF p_status IN ('done', 'completed') AND recurrence <> 'none' THEN
    base_due := COALESCE(rec.due_at, now());
    next_due := CASE recurrence
      WHEN 'daily' THEN base_due + interval '1 day'
      WHEN 'weekly' THEN base_due + interval '7 days'
      WHEN 'monthly' THEN base_due + interval '1 month'
      ELSE base_due + interval '1 day'
    END;

    INSERT INTO public.pa_tasks (
      company_id, title, description, notes, due_at, priority, status,
      linked_type, linked_id, linked_label, recurrence_pattern,
      assigned_employee_id, owner_employee_id, updated_at
    ) VALUES (
      rec.company_id, rec.title, rec.description, rec.notes, next_due,
      COALESCE(rec.priority, 'medium'), 'todo',
      COALESCE(rec.linked_type, 'none'), rec.linked_id, rec.linked_label, recurrence,
      p_employee_id, p_employee_id, now()
    );
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(uuid, uuid, uuid, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(uuid, uuid, uuid, text, timestamptz) TO anon, authenticated;
