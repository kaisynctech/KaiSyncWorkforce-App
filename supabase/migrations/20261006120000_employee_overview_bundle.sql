-- Phase B speed: single employee home bundle RPC (replaces ~11 round-trips).
-- Auth: _assert_worker_access (JWT membership or valid code session token).
-- Returns jsonb keys consumed by kaisync-web employee overview.

CREATE OR REPLACE FUNCTION public.employee_get_overview_bundle(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL,
  p_include_jobs boolean DEFAULT true,
  p_include_leave boolean DEFAULT true,
  p_include_attendance boolean DEFAULT true,
  p_include_incidents boolean DEFAULT true,
  p_include_my_pa boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_today date := (timezone('utc', now()))::date;
  v_week_from date := (timezone('utc', now()))::date - 7;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'enabled_modules', coalesce(c.enabled_modules, '{}'::jsonb),
        'dispatch_settings', coalesce(c.custom_settings->'dispatch_settings', '{}'::jsonb)
      )
      FROM public.companies c
      WHERE c.id = p_company_id
    ),
    'employee', (
      SELECT jsonb_build_object(
        'id', e.id,
        'company_id', e.company_id,
        'name', e.name,
        'surname', e.surname,
        'branch_id', e.branch_id,
        'branch', e.branch,
        'registration_status', e.registration_status,
        'is_active', e.is_active,
        'access_level', e.access_level
      )
      FROM public.employees e
      WHERE e.id = p_employee_id
        AND e.company_id = p_company_id
    ),
    'branches', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'latitude', b.latitude,
        'longitude', b.longitude,
        'is_active', b.is_active
      ) ORDER BY b.name)
      FROM public.branches b
      WHERE b.company_id = p_company_id
    ), '[]'::jsonb),
    'last_punch', (
      SELECT to_jsonb(tp.*)
      FROM public.time_punches tp
      WHERE tp.employee_id = p_employee_id
      ORDER BY tp.date_time DESC
      LIMIT 1
    ),
    'jobs', CASE WHEN NOT p_include_jobs THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(j.*) ORDER BY j.created_at DESC)
      FROM public.jobs j
      WHERE j.company_id = p_company_id
        AND (
          j.created_by_employee_id = p_employee_id
          OR j.assigned_employee_ids @> ARRAY[p_employee_id]
          OR j.assignee_employee_id = p_employee_id
          OR j.contractor_employee_id = p_employee_id
          OR (
            j.contractor_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.contractor_member_links cml
              WHERE cml.company_id = p_company_id
                AND cml.employee_id = p_employee_id
                AND cml.contractor_id = j.contractor_id
            )
          )
        )
    ), '[]'::jsonb) END,
    'leave_requests', CASE WHEN NOT p_include_leave THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at DESC)
      FROM public.leave_requests r
      WHERE r.company_id = p_company_id
        AND r.employee_id = p_employee_id
    ), '[]'::jsonb) END,
    'is_on_leave', CASE WHEN NOT p_include_leave THEN false ELSE EXISTS (
      SELECT 1
      FROM public.leave_requests lr
      WHERE lr.company_id = p_company_id
        AND lr.employee_id = p_employee_id
        AND lr.status = 'approved'
        AND lr.start_date <= v_today
        AND lr.end_date >= v_today
    ) END,
    'colleagues_on_leave', CASE WHEN NOT p_include_leave THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'employee_id', x.employee_id,
        'leave_type', x.leave_type,
        'end_date', x.end_date,
        'employees', jsonb_build_object(
          'name', x.name,
          'surname', x.surname
        )
      ))
      FROM (
        SELECT lr.employee_id, lr.leave_type, lr.end_date, e.name, e.surname
        FROM public.leave_requests lr
        JOIN public.employees e ON e.id = lr.employee_id
        WHERE lr.company_id = p_company_id
          AND lr.status = 'approved'
          AND lr.start_date <= v_today
          AND lr.end_date >= v_today
          AND lr.employee_id <> p_employee_id
        LIMIT 10
      ) x
    ), '[]'::jsonb) END,
    'incidents', CASE WHEN NOT p_include_incidents THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(i.*) ORDER BY i.created_at DESC)
      FROM (
        SELECT i.*
        FROM public.incident_reports i
        WHERE i.company_id = p_company_id
          AND (
            i.employee_id = p_employee_id
            OR i.assignee_id = p_employee_id
            OR (
              i.job_id IS NOT NULL
              AND public._employee_assigned_to_job(p_company_id, p_employee_id, i.job_id)
            )
          )
        ORDER BY i.created_at DESC
        LIMIT 200
      ) i
    ), '[]'::jsonb) END,
    'punches_today', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(tp.*) ORDER BY tp.date_time DESC)
      FROM public.time_punches tp
      WHERE tp.company_id = p_company_id
        AND tp.employee_id = p_employee_id
        AND (tp.date_time AT TIME ZONE 'utc')::date = v_today
    ), '[]'::jsonb) END,
    'punches_week', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(tp.*) ORDER BY tp.date_time DESC)
      FROM public.time_punches tp
      WHERE tp.company_id = p_company_id
        AND tp.employee_id = p_employee_id
        AND (tp.date_time AT TIME ZONE 'utc')::date BETWEEN v_week_from AND v_today
    ), '[]'::jsonb) END,
    'pa_tasks', CASE WHEN NOT p_include_my_pa THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at DESC)
      FROM public.pa_tasks t
      WHERE t.company_id = p_company_id
        AND (
          t.owner_employee_id = p_employee_id
          OR t.assigned_employee_id = p_employee_id
        )
    ), '[]'::jsonb) END,
    'absences_today', CASE WHEN NOT p_include_attendance THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(to_jsonb(a.*) ORDER BY a.date DESC)
      FROM public.daily_absences a
      WHERE a.company_id = p_company_id
        AND a.employee_id = p_employee_id
        AND a.date = v_today
    ), '[]'::jsonb) END,
    'notifications', coalesce((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC)
      FROM (
        SELECT
          id, company_id, type, title, body, ref_type, ref_id,
          data, is_read, read_at, created_at
        FROM public.app_notifications
        WHERE audience IN ('employee', 'all')
          AND (
            recipient_employee_id = p_employee_id
            OR recipient_auth_user_id IN (
              SELECT user_id FROM public.employees
              WHERE id = p_employee_id AND user_id IS NOT NULL
            )
          )
        ORDER BY created_at DESC
        LIMIT 50
      ) n
    ), '[]'::jsonb),
    'work_teams', coalesce((
      SELECT jsonb_agg(to_jsonb(wt.*))
      FROM public.work_teams wt
      WHERE wt.company_id = p_company_id
        AND wt.member_ids @> ARRAY[p_employee_id]
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_get_overview_bundle(
  uuid, uuid, text, boolean, boolean, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_overview_bundle(
  uuid, uuid, text, boolean, boolean, boolean, boolean, boolean
) TO anon, authenticated;

COMMENT ON FUNCTION public.employee_get_overview_bundle(
  uuid, uuid, text, boolean, boolean, boolean, boolean, boolean
) IS
  'Employee home dashboard bundle — one round-trip for overview widgets. Auth via _assert_worker_access.';
