-- W5 (Nyarie approved 23 Oct 2026): a manual timesheet can record a night shift.
-- Before: "Time out must be after time in on the same day" blocked 19:00–04:00 even though the
-- company has night-shift templates. Now a time out earlier than the time in ends the next day.
-- Applied live as an in-place edit of employee_submit_timesheet (only these two statements change;
-- grants unchanged).
DO $m$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.employee_submit_timesheet(uuid,uuid,date,text,text,text,text)'::regprocedure);
  IF position('CASE WHEN v_out_time < v_in_time' in d) > 0 THEN RETURN; END IF;
  d := replace(d, $q$IF v_out_time <= v_in_time THEN
    RAISE EXCEPTION 'Time out must be after time in on the same day';
  END IF;$q$, $q$IF v_out_time = v_in_time THEN
    RAISE EXCEPTION 'Time out must be different from time in';
  END IF;$q$);
  d := replace(d, $q$v_out := (p_work_date::text || ' ' || v_out_time::text)::timestamp AT TIME ZONE v_tz;$q$,
    $q$v_out := ((p_work_date + CASE WHEN v_out_time < v_in_time THEN 1 ELSE 0 END)::text || ' ' || v_out_time::text)::timestamp AT TIME ZONE v_tz;$q$);
  EXECUTE d;
END $m$;
