-- Continue one shift after a mistaken same-day clock-out.
-- Before a second clock-in: remove that clock-out and keep the original clock-in open.
-- After a second clock-in is already saved: remove the clock-out and the later clock-in.

CREATE OR REPLACE FUNCTION public.resume_same_day_shift(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text;
  v_today date;
  v_latest public.time_punches;
  v_previous public.time_punches;
  v_first public.time_punches;
  v_kept public.time_punches;
  v_allowed boolean := false;
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.company_id = p_company_id
      AND e.user_id = auth.uid()
  ) THEN
    v_allowed := true;
  ELSIF p_session_token IS NOT NULL
    AND public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token)
  THEN
    v_allowed := true;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
      AND lower(e.access_level) IN ('owner', 'admin', 'hr', 'hr_admin', 'manager')
  ) THEN
    v_allowed := true;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.hr_users h
    WHERE h.user_id = auth.uid()
      AND h.company_id = p_company_id
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(nullif(trim(timezone), ''), 'Africa/Johannesburg')
  INTO v_tz
  FROM public.company_settings
  WHERE company_id = p_company_id
  LIMIT 1;
  IF v_tz IS NULL THEN
    v_tz := 'Africa/Johannesburg';
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT * INTO v_latest
  FROM public.time_punches
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
  ORDER BY date_time DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No punch to continue' USING ERRCODE = 'P0002';
  END IF;

  IF (v_latest.date_time AT TIME ZONE v_tz)::date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'A shift can only be continued on the same day' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_previous
  FROM public.time_punches
  WHERE company_id = p_company_id
    AND employee_id = p_employee_id
    AND id <> v_latest.id
  ORDER BY date_time DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
  END IF;

  IF lower(trim(v_latest.type)) = 'out'
     AND v_previous.id IS NOT NULL
     AND lower(trim(v_previous.type)) = 'in'
     AND (v_previous.date_time AT TIME ZONE v_tz)::date = v_today
  THEN
    DELETE FROM public.time_punches WHERE id = v_latest.id;
    v_kept := v_previous;
  ELSIF lower(trim(v_latest.type)) = 'in'
        AND v_previous.id IS NOT NULL
        AND lower(trim(v_previous.type)) = 'out'
        AND (v_previous.date_time AT TIME ZONE v_tz)::date = v_today
  THEN
    SELECT * INTO v_first
    FROM public.time_punches
    WHERE company_id = p_company_id
      AND employee_id = p_employee_id
      AND id NOT IN (v_latest.id, v_previous.id)
    ORDER BY date_time DESC, created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
    END IF;

    IF lower(trim(v_first.type)) IS DISTINCT FROM 'in'
       OR (v_first.date_time AT TIME ZONE v_tz)::date IS DISTINCT FROM v_today
    THEN
      RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.time_punches WHERE id IN (v_latest.id, v_previous.id);
    v_kept := v_first;
  ELSE
    RAISE EXCEPTION 'No same-day shift to continue' USING ERRCODE = 'P0001';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    BEGIN
      PERFORM public.write_audit_event(
        p_company_id,
        'attendance.shift_resumed',
        'time_punch',
        v_kept.id::text,
        jsonb_build_object('removed_latest_type', v_latest.type, 'removed_latest_id', v_latest.id),
        jsonb_build_object('open_punch_id', v_kept.id, 'open_at', v_kept.date_time)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
  END IF;

  RETURN row_to_json(v_kept);
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_same_day_shift(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resume_same_day_shift(uuid, uuid, text) TO anon, authenticated;
