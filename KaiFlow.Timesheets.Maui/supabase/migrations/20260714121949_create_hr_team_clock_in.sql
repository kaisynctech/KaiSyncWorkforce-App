
CREATE OR REPLACE FUNCTION public.hr_team_clock_in(
  p_company_id uuid,
  p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_address text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id uuid;
  v_last_type text;
BEGIN
  FOREACH v_employee_id IN ARRAY p_employee_ids LOOP
    -- Only clock in if the most recent punch today is NOT 'in'
    SELECT type INTO v_last_type
    FROM time_punches
    WHERE company_id = p_company_id
      AND employee_id = v_employee_id
      AND date_time::date = CURRENT_DATE
    ORDER BY date_time DESC
    LIMIT 1;

    IF v_last_type IS DISTINCT FROM 'in' THEN
      INSERT INTO time_punches (company_id, employee_id, type, date_time, latitude, longitude, address)
      VALUES (p_company_id, v_employee_id, 'in', now(), p_latitude, p_longitude, p_address);
    END IF;
  END LOOP;
END;
$$;
;
