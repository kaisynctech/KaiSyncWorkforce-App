-- Block a second open clock-in in employee_insert_punch.
-- Root cause: RPC only deduped the same idempotency_key. Double-taps used new keys
-- and created multiple consecutive 'in' rows (multiple OPEN sessions in attendance).
-- Fix: if latest punch for the employee is already 'in', return that row (no insert).
-- Same soft-success pattern as idempotency replay so offline flush can dequeue safely.

CREATE OR REPLACE FUNCTION public.employee_insert_punch(
    p_company_id            uuid,
    p_employee_id           uuid,
    p_type                  text,
    p_date_time             timestamptz,
    p_latitude              double precision DEFAULT NULL,
    p_longitude             double precision DEFAULT NULL,
    p_address               text DEFAULT NULL,
    p_job_id                uuid DEFAULT NULL,
    p_notes                 text DEFAULT NULL,
    p_punched_by_manager_id uuid DEFAULT NULL,
    p_idempotency_key       uuid DEFAULT NULL,
    p_session_token         text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_punch public.time_punches;
    v_last  public.time_punches;
    v_type  text := lower(trim(p_type));
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_punch
        FROM public.time_punches
        WHERE company_id      = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
        IF FOUND THEN
            RETURN row_to_json(v_punch);
        END IF;
    END IF;

    IF v_type = 'in' THEN
        IF public.employee_is_on_leave_today(p_company_id, p_employee_id, p_session_token) THEN
            RAISE EXCEPTION 'Employee is on approved leave and cannot clock in';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.daily_absences
            WHERE company_id  = p_company_id
              AND employee_id = p_employee_id
              AND date        = current_date
        ) THEN
            RAISE EXCEPTION 'Employee is marked absent and cannot clock in';
        END IF;

        -- One open session: do not insert another 'in' while latest punch is still 'in'.
        SELECT * INTO v_last
        FROM public.time_punches
        WHERE company_id  = p_company_id
          AND employee_id = p_employee_id
        ORDER BY date_time DESC, created_at DESC
        LIMIT 1;

        IF FOUND AND lower(trim(v_last.type)) = 'in' THEN
            RETURN row_to_json(v_last);
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.time_punches (
            id, company_id, employee_id, type, date_time,
            latitude, longitude, address, job_id, notes,
            punched_by_manager_id, idempotency_key
        ) VALUES (
            gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
            p_latitude, p_longitude, p_address, p_job_id, p_notes,
            p_punched_by_manager_id, p_idempotency_key
        ) RETURNING * INTO v_punch;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_punch
        FROM public.time_punches
        WHERE company_id      = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
    END;

    RETURN row_to_json(v_punch);
END;
$function$;

-- Harden team clock-in: check latest punch overall (not calendar-day only),
-- skip members who already have an open 'in'.
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
SET search_path TO 'public'
AS $function$
DECLARE
  v_employee_id uuid;
  v_last_type text;
BEGIN
  FOREACH v_employee_id IN ARRAY p_employee_ids LOOP
    SELECT type INTO v_last_type
    FROM public.time_punches
    WHERE company_id = p_company_id
      AND employee_id = v_employee_id
    ORDER BY date_time DESC, created_at DESC
    LIMIT 1;

    IF v_last_type IS DISTINCT FROM 'in' THEN
      INSERT INTO public.time_punches (
        company_id, employee_id, type, date_time, latitude, longitude, address
      ) VALUES (
        p_company_id, v_employee_id, 'in', now(), p_latitude, p_longitude, p_address
      );
    END IF;
  END LOOP;
END;
$function$;
