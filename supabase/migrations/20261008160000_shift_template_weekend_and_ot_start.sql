-- Weekday hours stay on start_time/end_time.
-- Optional Saturday–Sunday hours and the clock time overtime begins.

ALTER TABLE public.employee_shift_templates
  ADD COLUMN IF NOT EXISTS weekend_start_time time,
  ADD COLUMN IF NOT EXISTS weekend_end_time time,
  ADD COLUMN IF NOT EXISTS ot_start_time time,
  ADD COLUMN IF NOT EXISTS weekend_ot_start_time time;

DROP FUNCTION IF EXISTS public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb);

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
  p_weekend_ot_start_time text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.employee_shift_templates%ROWTYPE;
  v_weekend_start time;
  v_weekend_end time;
  v_ot time;
  v_weekend_ot time;
BEGIN
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

  IF p_id IS NULL THEN
    INSERT INTO public.employee_shift_templates (
      id, company_id, name, start_time, end_time, break_minutes, breaks,
      weekend_start_time, weekend_end_time, ot_start_time, weekend_ot_start_time
    ) VALUES (
      gen_random_uuid(), p_company_id, p_name,
      p_start_time::time, p_end_time::time, p_break_minutes, p_breaks,
      v_weekend_start, v_weekend_end, v_ot, v_weekend_ot
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.employee_shift_templates SET
      name = p_name,
      start_time = p_start_time::time,
      end_time = p_end_time::time,
      break_minutes = p_break_minutes,
      breaks = p_breaks,
      weekend_start_time = v_weekend_start,
      weekend_end_time = v_weekend_end,
      ot_start_time = v_ot,
      weekend_ot_start_time = v_weekend_ot
    WHERE id = p_id AND company_id = p_company_id
    RETURNING * INTO v_row;
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_upsert_shift_template(uuid, uuid, text, text, text, integer, jsonb, text, text, text, text) TO service_role;
