-- Saturday stays on the existing weekend_* columns. Sunday gets its own clocks.
-- Templates that already set weekend hours keep those hours on Sunday until someone edits them.

ALTER TABLE public.employee_shift_templates
  ADD COLUMN IF NOT EXISTS sunday_start_time time,
  ADD COLUMN IF NOT EXISTS sunday_end_time time,
  ADD COLUMN IF NOT EXISTS sunday_ot_start_time time,
  ADD COLUMN IF NOT EXISTS sunday_early_ot_start_time time;

UPDATE public.employee_shift_templates
SET
  sunday_start_time = weekend_start_time,
  sunday_end_time = weekend_end_time,
  sunday_ot_start_time = weekend_ot_start_time,
  sunday_early_ot_start_time = weekend_early_ot_start_time
WHERE weekend_start_time IS NOT NULL
  AND weekend_end_time IS NOT NULL
  AND sunday_start_time IS NULL
  AND sunday_end_time IS NULL;

DROP FUNCTION IF EXISTS public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text);

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
  p_weekend_early_ot_start_time text DEFAULT NULL,
  p_sunday_start_time text DEFAULT NULL,
  p_sunday_end_time text DEFAULT NULL,
  p_sunday_ot_start_time text DEFAULT NULL,
  p_sunday_early_ot_start_time text DEFAULT NULL
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
  v_sunday_start time;
  v_sunday_end time;
  v_sunday_ot time;
  v_sunday_early time;
BEGIN
  v_start := NULLIF(trim(COALESCE(p_start_time, '')), '')::time;

  IF NULLIF(trim(COALESCE(p_weekend_start_time, '')), '') IS NOT NULL
     OR NULLIF(trim(COALESCE(p_weekend_end_time, '')), '') IS NOT NULL THEN
    IF NULLIF(trim(COALESCE(p_weekend_start_time, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_weekend_end_time, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Saturday start and end time are both required';
    END IF;
    v_weekend_start := trim(p_weekend_start_time)::time;
    v_weekend_end := trim(p_weekend_end_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_sunday_start_time, '')), '') IS NOT NULL
     OR NULLIF(trim(COALESCE(p_sunday_end_time, '')), '') IS NOT NULL THEN
    IF NULLIF(trim(COALESCE(p_sunday_start_time, '')), '') IS NULL
       OR NULLIF(trim(COALESCE(p_sunday_end_time, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Sunday start and end time are both required';
    END IF;
    v_sunday_start := trim(p_sunday_start_time)::time;
    v_sunday_end := trim(p_sunday_end_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_ot_start_time, '')), '') IS NOT NULL THEN
    v_ot := trim(p_ot_start_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_weekend_ot_start_time, '')), '') IS NOT NULL THEN
    v_weekend_ot := trim(p_weekend_ot_start_time)::time;
  END IF;

  IF NULLIF(trim(COALESCE(p_sunday_ot_start_time, '')), '') IS NOT NULL THEN
    v_sunday_ot := trim(p_sunday_ot_start_time)::time;
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
      RAISE EXCEPTION 'Saturday early overtime must be earlier than the Saturday start';
    END IF;
  END IF;

  IF v_sunday_start IS NOT NULL
     AND NULLIF(trim(COALESCE(p_sunday_early_ot_start_time, '')), '') IS NOT NULL THEN
    v_sunday_early := trim(p_sunday_early_ot_start_time)::time;
    IF v_sunday_early >= v_sunday_start THEN
      RAISE EXCEPTION 'Sunday early overtime must be earlier than the Sunday start';
    END IF;
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.employee_shift_templates (
      id, company_id, name, start_time, end_time, break_minutes, breaks,
      weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time,
      early_ot_start_time, weekend_early_ot_start_time,
      sunday_start_time, sunday_end_time, sunday_ot_start_time, sunday_early_ot_start_time
    ) VALUES (
      gen_random_uuid(), p_company_id, p_name,
      v_start, p_end_time::time, p_break_minutes, p_breaks,
      v_weekend_start, v_weekend_end, v_ot, v_weekend_ot,
      v_early, v_weekend_early,
      v_sunday_start, v_sunday_end, v_sunday_ot, v_sunday_early
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
      weekend_early_ot_start_time = v_weekend_early,
      sunday_start_time = v_sunday_start,
      sunday_end_time = v_sunday_end,
      sunday_ot_start_time = v_sunday_ot,
      sunday_early_ot_start_time = v_sunday_early
    WHERE id = p_id AND company_id = p_company_id
    RETURNING * INTO v_row;
  END IF;

  RETURN row_to_json(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text, text, text, text, text, text, text) TO service_role;
