-- Optional early overtime on a shift template, and team punch that follows the latest punch.

ALTER TABLE public.employee_shift_templates
  ADD COLUMN IF NOT EXISTS early_ot_start_time time,
  ADD COLUMN IF NOT EXISTS weekend_early_ot_start_time time;

DROP FUNCTION IF EXISTS public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text);

CREATE OR REPLACE FUNCTION public.hr_upsert_shift_template(
  p_company_id uuid,
  p_id uuid,
  p_name text,
  p_start_time text,
  p_end_time text,
  p_break_minutes integer,
  p_breaks jsonb,
  p_weekend_start_time text DEFAULT NULL,
  p_weekend_end_time text DEFAULT NULL,
  p_ot_start_time text DEFAULT NULL,
  p_weekend_ot_start_time text DEFAULT NULL,
  p_early_ot_start_time text DEFAULT NULL,
  p_weekend_early_ot_start_time text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.employee_shift_templates%ROWTYPE;
  v_start time;
  v_weekend_start time;
  v_weekend_end time;
  v_ot time;
  v_weekend_ot time;
  v_early time;
  v_weekend_early time;
BEGIN
  v_start := NULLIF(trim(COALESCE(p_start_time, '')), '')::time;

  IF NULLIF(trim(COALESCE(p_weekend_start_time, '')), '') IS NOT NULL
     OR NULLIF(trim(COALESCE(p_weekend_end_time, '')), '') IS NOT NULL THEN
    IF NULLIF(trim(COALESCE(p_weekend_start_time, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_weekend_end_time, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Weekend start and end time are both required';
    END IF;
    v_weekend_start := trim(p_weekend_start_time)::time;
    v_weekend_end := trim(p_weekend_end_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_ot_start_time, '')), '') IS NOT NULL THEN
    v_ot := trim(p_ot_start_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_weekend_ot_start_time, '')), '') IS NOT NULL THEN
    v_weekend_ot := trim(p_weekend_ot_start_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_early_ot_start_time, '')), '') IS NOT NULL THEN
    v_early := trim(p_early_ot_start_time)::time;
    IF v_start IS NULL OR v_early >= v_start THEN
      RAISE EXCEPTION 'Early overtime must be earlier than the shift start';
    END IF;
  END IF;

  IF v_weekend_start IS NOT NULL
     AND NULLIF(trim(COALESCE(p_weekend_early_ot_start_time, '')), '') IS NOT NULL THEN
    v_weekend_early := trim(p_weekend_early_ot_start_time)::time;
    IF v_weekend_early >= v_weekend_start THEN
      RAISE EXCEPTION 'Weekend early overtime must be earlier than the weekend start';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.employee_shift_templates (
      id, company_id, name, start_time, end_time, break_minutes, breaks,
      weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time,
      early_ot_start_time, weekend_early_ot_start_time
    ) VALUES (
      gen_random_uuid(), p_company_id, p_name,
      v_start, p_end_time::time, p_break_minutes, p_breaks,
      v_weekend_start, v_weekend_end, v_ot, v_weekend_ot,
      v_early, v_weekend_early
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.employee_shift_templates SET
      name = p_name,
      start_time = v_start,
      end_time = p_end_time::time,
      break_minutes = p_break_minutes,
      breaks = p_breaks,
      weekend_start_time = v_weekend_start,
      weekend_end_time = v_weekend_end,
      ot_start_time = v_ot,
      weekend_ot_start_time = v_weekend_ot,
      early_ot_start_time = v_early,
      weekend_early_ot_start_time = v_weekend_early
    WHERE id = p_id AND company_id = p_company_id
    RETURNING * INTO v_row;
  END IF;

  RETURN row_to_json(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text);
DROP FUNCTION IF EXISTS public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text);

CREATE OR REPLACE FUNCTION public.hr_team_clock_in(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_last_type text;
  v_clocked uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.hr_users h
    WHERE h.user_id = auth.uid()
      AND h.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  FOREACH v_employee_id IN ARRAY COALESCE(p_employee_ids, ARRAY[]::uuid[]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = v_employee_id AND e.company_id = p_company_id
    ) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'employee_id', v_employee_id, 'reason', 'not_in_company'
      ));
      CONTINUE;
    END IF;

    SELECT tp.type INTO v_last_type
    FROM public.time_punches tp
    WHERE tp.company_id = p_company_id
      AND tp.employee_id = v_employee_id
    ORDER BY tp.date_time DESC, tp.created_at DESC
    LIMIT 1;

    IF v_last_type = 'in' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'employee_id', v_employee_id, 'reason', 'already_in'
      ));
      CONTINUE;
    END IF;

    INSERT INTO public.time_punches (
      company_id, employee_id, type, date_time, latitude, longitude, address
    ) VALUES (
      p_company_id, v_employee_id, 'in', now(), p_latitude, p_longitude, p_address
    );
    v_clocked := array_append(v_clocked, v_employee_id);
  END LOOP;

  RETURN jsonb_build_object('clocked', to_jsonb(v_clocked), 'skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.hr_team_clock_out(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_last_type text;
  v_clocked uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  IF p_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.hr_users h
    WHERE h.user_id = auth.uid()
      AND h.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  FOREACH v_employee_id IN ARRAY COALESCE(p_employee_ids, ARRAY[]::uuid[]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = v_employee_id AND e.company_id = p_company_id
    ) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'employee_id', v_employee_id, 'reason', 'not_in_company'
      ));
      CONTINUE;
    END IF;

    SELECT tp.type INTO v_last_type
    FROM public.time_punches tp
    WHERE tp.company_id = p_company_id
      AND tp.employee_id = v_employee_id
    ORDER BY tp.date_time DESC, tp.created_at DESC
    LIMIT 1;

    IF v_last_type IS DISTINCT FROM 'in' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'employee_id', v_employee_id, 'reason', 'not_in'
      ));
      CONTINUE;
    END IF;

    INSERT INTO public.time_punches (
      company_id, employee_id, type, date_time, latitude, longitude, address
    ) VALUES (
      p_company_id, v_employee_id, 'out', now(), p_latitude, p_longitude, p_address
    );
    v_clocked := array_append(v_clocked, v_employee_id);
  END LOOP;

  RETURN jsonb_build_object('clocked', to_jsonb(v_clocked), 'skipped', v_skipped);
END;
$function$;

CREATE OR REPLACE FUNCTION public.hr_team_latest_punches(
  p_company_id uuid,
  p_employee_ids uuid[]
)
RETURNS TABLE(employee_id uuid, punch_type text, punched_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.user_id = auth.uid()
      AND e.company_id = p_company_id
      AND e.is_active = true
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.hr_users h
    WHERE h.user_id = auth.uid()
      AND h.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (tp.employee_id)
    tp.employee_id,
    tp.type,
    tp.date_time
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = ANY(COALESCE(p_employee_ids, ARRAY[]::uuid[]))
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = tp.employee_id AND e.company_id = p_company_id
    )
  ORDER BY tp.employee_id, tp.date_time DESC, tp.created_at DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) TO service_role;

REVOKE ALL ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) TO service_role;

REVOKE ALL ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) TO service_role;
