-- PostgREST PGRST203: two employee_insert_punch(uuid,...) overloads (9- vs 10-param) break anon punch RPC.
-- Keep the 10-parameter version (includes p_punched_by_manager_id + leave/absence guards).

DROP FUNCTION IF EXISTS public.employee_insert_punch(
  uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text
);

-- Re-assert canonical definition from punch_block_leave_absence migration.
CREATE OR REPLACE FUNCTION public.employee_insert_punch(
    p_company_id  uuid,
    p_employee_id uuid,
    p_type        text,
    p_date_time   timestamptz,
    p_latitude    double precision DEFAULT NULL,
    p_longitude   double precision DEFAULT NULL,
    p_address     text DEFAULT NULL,
    p_job_id      uuid DEFAULT NULL,
    p_notes       text DEFAULT NULL,
    p_punched_by_manager_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_punch time_punches;
BEGIN
    IF lower(trim(p_type)) = 'in' THEN
        IF employee_is_on_leave_today(p_company_id, p_employee_id) THEN
            RAISE EXCEPTION 'Employee is on approved leave and cannot clock in';
        END IF;

        IF EXISTS (
            SELECT 1 FROM daily_absences
            WHERE company_id  = p_company_id
              AND employee_id = p_employee_id
              AND date        = current_date
        ) THEN
            RAISE EXCEPTION 'Employee is marked absent and cannot clock in';
        END IF;
    END IF;

    INSERT INTO time_punches (
        id, company_id, employee_id, type, date_time,
        latitude, longitude, address, job_id, notes, punched_by_manager_id
    ) VALUES (
        gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
        p_latitude, p_longitude, p_address, p_job_id, p_notes, p_punched_by_manager_id
    ) RETURNING * INTO v_punch;

    RETURN row_to_json(v_punch);
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_insert_punch(
  uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid
) TO anon, authenticated;
