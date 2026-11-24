-- Manual timesheet: one clock-in and one clock-out for a chosen day.
-- Payroll already pays closed punch pairs, so this writes time_punches.

CREATE OR REPLACE FUNCTION public.employee_submit_timesheet(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_work_date     date,
  p_time_in       text,
  p_time_out      text,
  p_notes         text DEFAULT NULL,
  p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp          public.employees%ROWTYPE;
  v_caller_id    uuid;
  v_role         text;
  v_level        text;
  v_self         boolean;
  v_tz           text;
  v_today        date;
  v_in_time      time;
  v_out_time     time;
  v_in           timestamptz;
  v_out          timestamptz;
  v_prev_type    text;
  v_note         text;
  v_manager      uuid;
  v_in_id        uuid;
  v_out_id       uuid;
  v_in_row       public.time_punches%ROWTYPE;
  v_out_row      public.time_punches%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  SELECT * INTO v_emp
  FROM public.employees
  WHERE id = p_employee_id
    AND company_id = p_company_id
    AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  v_self := auth.uid() IS NOT NULL AND v_emp.user_id = auth.uid();
  v_manager := NULL;

  IF auth.uid() IS NOT NULL AND NOT v_self THEN
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

    IF v_role IN ('owner', 'hr') OR v_level IN ('owner', 'hr') THEN
      v_manager := auth.uid();
    ELSIF v_role = 'manager' OR v_level = 'manager' THEN
      IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
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
        RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
      END IF;
      v_manager := auth.uid();
    ELSE
      RAISE EXCEPTION 'You cannot enter a timesheet for this employee';
    END IF;
  END IF;

  IF p_work_date IS NULL OR p_time_in IS NULL OR p_time_out IS NULL THEN
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

  IF v_out_time <= v_in_time THEN
    RAISE EXCEPTION 'Time out must be after time in on the same day';
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
  v_out := (p_work_date::text || ' ' || v_out_time::text)::timestamp AT TIME ZONE v_tz;
  IF v_out > now() THEN
    RAISE EXCEPTION 'Time out cannot be in the future';
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

  IF EXISTS (
    SELECT 1
    FROM public.daily_absences da
    WHERE da.company_id = p_company_id
      AND da.employee_id = p_employee_id
      AND da.date = p_work_date
  ) THEN
    RAISE EXCEPTION 'This employee is marked absent that day';
  END IF;

  SELECT tp.type INTO v_prev_type
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = p_employee_id
    AND tp.date_time < v_in
  ORDER BY tp.date_time DESC
  LIMIT 1;

  IF v_prev_type = 'in' OR EXISTS (
    SELECT 1
    FROM public.time_punches tp
    WHERE tp.company_id = p_company_id
      AND tp.employee_id = p_employee_id
      AND tp.date_time >= v_in
      AND tp.date_time <= v_out
  ) THEN
    RAISE EXCEPTION 'This time overlaps a shift already on record';
  END IF;

  v_note := 'Manual timesheet';
  IF p_notes IS NOT NULL AND length(trim(p_notes)) > 0 THEN
    v_note := v_note || ' · ' || left(trim(p_notes), 400);
  END IF;

  v_in_id := gen_random_uuid();
  v_out_id := gen_random_uuid();

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_in_id, p_company_id, p_employee_id, 'in', v_in, v_note, v_manager
  )
  RETURNING * INTO v_in_row;

  INSERT INTO public.time_punches (
    id, company_id, employee_id, type, date_time, notes, punched_by_manager_id
  ) VALUES (
    v_out_id, p_company_id, p_employee_id, 'out', v_out, v_note, v_manager
  )
  RETURNING * INTO v_out_row;

  IF auth.uid() IS NOT NULL THEN
    PERFORM public.write_audit_event(
      p_company_id,
      'attendance.manual_timesheet',
      'employee',
      p_employee_id::text,
      NULL,
      jsonb_build_object(
        'work_date', p_work_date,
        'time_in', v_in,
        'time_out', v_out,
        'in_id', v_in_row.id,
        'out_id', v_out_row.id,
        'on_behalf', v_manager IS NOT NULL
      ),
      NULL
    );
  END IF;

  RETURN json_build_object(
    'in_id', v_in_row.id,
    'out_id', v_out_row.id,
    'time_in', v_in,
    'time_out', v_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_submit_timesheet(uuid, uuid, date, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_submit_timesheet(uuid, uuid, date, text, text, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.employee_submit_timesheet(uuid, uuid, date, text, text, text, text) IS
  'Inserts a same-day manual clock-in and clock-out. Employees submit their own days. Owner, HR, or a manager in scope can submit for someone else.';
