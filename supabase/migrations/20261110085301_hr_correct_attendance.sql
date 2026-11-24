-- HR/owner/manager attendance correction:
-- replace a day's punches with the correct in/out, optionally clear daily_absences.
-- Audited. Blocked on locked payroll periods and approved leave.

CREATE OR REPLACE FUNCTION public.hr_correct_attendance(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_work_date     date,
  p_time_in       text,
  p_time_out      text,
  p_reason        text,
  p_clear_absence boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_emp          public.employees%ROWTYPE;
  v_caller_id    uuid;
  v_role         text;
  v_level        text;
  v_tz           text;
  v_today        date;
  v_in_time      time;
  v_out_time     time;
  v_in           timestamptz;
  v_out          timestamptz;
  v_prev_type    text;
  v_note         text;
  v_reason       text;
  v_before       jsonb;
  v_absence      jsonb;
  v_cleared_abs  boolean := false;
  v_in_id        uuid;
  v_out_id       uuid;
  v_in_row       public.time_punches%ROWTYPE;
  v_out_row      public.time_punches%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RAISE EXCEPTION 'Company not accessible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_emp
  FROM public.employees
  WHERE id = p_employee_id
    AND company_id = p_company_id
    AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT role INTO v_role
  FROM public.company_relationships
  WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND is_active = true
  LIMIT 1;

  SELECT e.id, e.access_level INTO v_caller_id, v_level
  FROM public.employees e
  WHERE e.user_id = auth.uid()
    AND e.company_id = p_company_id
    AND e.is_active = true
  LIMIT 1;

  IF public.role_is_hr_or_above(coalesce(v_role, v_level)) THEN
    NULL; -- owner / admin / hr / hr_admin
  ELSIF coalesce(v_role, v_level) = 'manager' THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION 'You cannot correct attendance for this employee' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      v_emp.manager_id = v_caller_id
      OR (v_emp.manager_user_id IS NOT NULL AND v_emp.manager_user_id = auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.work_teams wt
        WHERE wt.company_id = p_company_id
          AND wt.is_active = true
          AND wt.leader_employee_id = v_caller_id
          AND p_employee_id = ANY (wt.member_ids)
      )
      OR EXISTS (
        SELECT 1
        FROM public.work_teams wt
        WHERE wt.company_id = p_company_id
          AND wt.is_active = true
          AND v_caller_id = ANY (wt.member_ids)
          AND wt.leader_employee_id = p_employee_id
      )
    ) THEN
      RAISE EXCEPTION 'You cannot correct attendance for this employee' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Owner, HR, or manager required to correct attendance' USING ERRCODE = '42501';
  END IF;

  v_reason := left(trim(coalesce(p_reason, '')), 400);
  IF v_reason = '' THEN
    RAISE EXCEPTION 'A reason is required for attendance corrections';
  END IF;

  IF p_work_date IS NULL OR nullif(trim(coalesce(p_time_in, '')), '') IS NULL
     OR nullif(trim(coalesce(p_time_out, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Date, time in, and time out are required';
  END IF;
  IF p_time_in !~ '^\d{1,2}:\d{2}(:\d{2})?$' OR p_time_out !~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
    RAISE EXCEPTION 'Enter time in and time out as hours and minutes';
  END IF;

  BEGIN
    v_in_time := p_time_in::time;
    v_out_time := p_time_out::time;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Enter time in and time out as hours and minutes';
  END;

  IF v_out_time = v_in_time THEN
    RAISE EXCEPTION 'Time out must be different from time in';
  END IF;

  SELECT coalesce(nullif(trim(cs.timezone), ''), 'Africa/Johannesburg')
  INTO v_tz
  FROM public.company_settings cs
  WHERE cs.company_id = p_company_id;
  IF v_tz IS NULL THEN
    v_tz := 'Africa/Johannesburg';
  END IF;

  BEGIN
    PERFORM (now() AT TIME ZONE v_tz);
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'Africa/Johannesburg';
  END;

  v_today := (now() AT TIME ZONE v_tz)::date;
  IF p_work_date > v_today THEN
    RAISE EXCEPTION 'Choose a date that is today or earlier';
  END IF;

  v_in := (p_work_date::text || ' ' || v_in_time::text)::timestamp AT TIME ZONE v_tz;
  v_out := (
    (p_work_date + CASE WHEN v_out_time < v_in_time THEN 1 ELSE 0 END)::text
    || ' ' || v_out_time::text
  )::timestamp AT TIME ZONE v_tz;

  IF v_out > now() THEN
    RAISE EXCEPTION 'Time out cannot be in the future';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payroll_period_locks l
    WHERE l.company_id = p_company_id
      AND l.period_start <= p_work_date
      AND l.period_end >= p_work_date
  ) THEN
    RAISE EXCEPTION 'This date is in a locked payroll period';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    WHERE lr.company_id = p_company_id
      AND lr.employee_id = p_employee_id
      AND lr.status = 'approved'
      AND lr.start_date <= p_work_date
      AND lr.end_date >= p_work_date
  ) THEN
    RAISE EXCEPTION 'This employee is on approved leave that day';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(tp) ORDER BY tp.date_time), '[]'::jsonb)
  INTO v_before
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = p_employee_id
    AND (
      (tp.date_time AT TIME ZONE v_tz)::date = p_work_date
      OR (tp.date_time >= v_in AND tp.date_time <= v_out)
      OR (
        v_out_time < v_in_time
        AND (tp.date_time AT TIME ZONE v_tz)::date = (p_work_date + 1)
        AND tp.type = 'out'
      )
    );

  SELECT coalesce(jsonb_agg(to_jsonb(da)), '[]'::jsonb)
  INTO v_absence
  FROM public.daily_absences da
  WHERE da.company_id = p_company_id
    AND da.employee_id = p_employee_id
    AND da.date = p_work_date;

  IF jsonb_array_length(v_absence) > 0 THEN
    IF coalesce(p_clear_absence, true) THEN
      DELETE FROM public.daily_absences da
      WHERE da.company_id = p_company_id
        AND da.employee_id = p_employee_id
        AND da.date = p_work_date;
      v_cleared_abs := true;
    ELSE
      RAISE EXCEPTION 'This employee is marked absent that day. Clear the absence to correct attendance.';
    END IF;
  END IF;

  DELETE FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = p_employee_id
    AND (
      (tp.date_time AT TIME ZONE v_tz)::date = p_work_date
      OR (tp.date_time >= v_in AND tp.date_time <= v_out)
      OR (
        v_out_time < v_in_time
        AND (tp.date_time AT TIME ZONE v_tz)::date = (p_work_date + 1)
        AND tp.type = 'out'
      )
    );

  SELECT tp.type INTO v_prev_type
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = p_employee_id
    AND tp.date_time < v_in
  ORDER BY tp.date_time DESC
  LIMIT 1;

  IF v_prev_type = 'in' THEN
    RAISE EXCEPTION 'This employee still has an open clock-in before this correction. Close or correct that shift first.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.time_punches tp
    WHERE tp.company_id = p_company_id
      AND tp.employee_id = p_employee_id
      AND tp.date_time >= v_in
      AND tp.date_time <= v_out
  ) THEN
    RAISE EXCEPTION 'This time overlaps a shift already on record';
  END IF;

  v_note := 'HR attendance correction · ' || v_reason;

  v_in_id := gen_random_uuid();
  v_out_id := gen_random_uuid();

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_in_id, p_company_id, p_employee_id, 'in', v_in, v_note, auth.uid()
  )
  RETURNING * INTO v_in_row;

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_out_id, p_company_id, p_employee_id, 'out', v_out, v_note, auth.uid()
  )
  RETURNING * INTO v_out_row;

  PERFORM public.write_audit_event(
    p_company_id,
    'attendance.hr_correct',
    'employee',
    p_employee_id::text,
    jsonb_build_object(
      'work_date', p_work_date,
      'punches', v_before,
      'absences', v_absence
    ),
    jsonb_build_object(
      'work_date', p_work_date,
      'time_in', v_in,
      'time_out', v_out,
      'in_id', v_in_row.id,
      'out_id', v_out_row.id,
      'reason', v_reason,
      'cleared_absence', v_cleared_abs
    ),
    jsonb_build_object('source', 'hr_correct_attendance')
  );

  RETURN json_build_object(
    'in_id', v_in_row.id,
    'out_id', v_out_row.id,
    'time_in', v_in,
    'time_out', v_out,
    'cleared_absence', v_cleared_abs,
    'replaced_punch_count', jsonb_array_length(v_before)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_correct_attendance(uuid, uuid, date, text, text, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_correct_attendance(uuid, uuid, date, text, text, text, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.hr_correct_attendance(uuid, uuid, date, text, text, text, boolean) IS
  'Owner/HR/manager corrects an employee day: replaces that day''s punches with the given in/out, optionally clears daily_absences, writes audit_events.';
