-- ════════════════════════════════════════════════════════════════════════════
-- FIX: Worker session enforcement — missed RPCs
--
-- Background
-- ──────────
-- Migration 20260601120000_worker_session_enforcement_rpcs.sql added
-- p_session_token (text DEFAULT NULL) and a call to _assert_worker_access()
-- to every employee_* RPC callable by code-login workers.
--
-- Three RPCs were omitted from the drop-and-recreate list:
--   • employee_get_last_punch       (20260522054505 — 1 param, no token)
--   • employee_get_my_punches       (20260522054505 — 4 params, no token)
--   • employee_is_on_leave_today    (20260522151249 — 2 params, no token)
--
-- Why this causes PGRST202
-- ────────────────────────
-- WorkerRpc.ShouldInjectWorkerSession() returns true for every rpcName that
-- starts with "employee_" (and is not in WorkerSessionExcludedRpcs). For a
-- code-login session it appends p_session_token to the argument dictionary
-- before calling _supabase.Rpc(). PostgREST resolves functions by matching
-- ALL supplied named parameters against a registered function signature. No
-- overload of these three functions accepts a parameter named p_session_token,
-- so PostgREST returns HTTP 404 / PGRST202 "Could not find function" on every
-- call from a code-login client.
--
-- Production impact
-- ─────────────────
-- • employee_get_last_punch  → clock button always shows "Clock In" regardless
--   of actual state; double-clock-in possible since IsClockedIn never loads.
-- • employee_get_my_punches  → punch history empty for all code-login workers.
-- • employee_is_on_leave_today → client-side leave guard bypassed (DB-internal
--   call inside employee_insert_punch is unaffected and still enforces it).
--
-- Why employee_insert_punch is also updated here
-- ────────────────────────────────────────────────
-- The production body of employee_insert_punch calls:
--   employee_is_on_leave_today(p_company_id, p_employee_id)
-- i.e. without p_session_token. After this migration that call would pass NULL
-- for the new third parameter. _assert_worker_access(…, NULL) raises UNAUTHORIZED
-- when auth.uid() is also NULL (anon/code-login). Clock-in would break.
-- The fix is to thread p_session_token through the internal call:
--   employee_is_on_leave_today(p_company_id, p_employee_id, p_session_token)
-- _assert_worker_access then validates against the same already-live session
-- token. The extra lookup is a cheap indexed point-read on employee_code_sessions.
--
-- Alignment with WorkerRpc.cs
-- ────────────────────────────
-- New signatures:
--   employee_get_last_punch   (uuid, text)
--   employee_get_my_punches   (uuid, uuid, date, date, text)
--   employee_is_on_leave_today(uuid, uuid, text)
--   employee_insert_punch     (uuid×4, float8×2, text, uuid, text, uuid, uuid, text)
-- p_session_token is the LAST parameter with DEFAULT NULL in every case,
-- matching the injection order used by WorkerRpc.RpcAsync().
--
-- Rollback: see bottom of file.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;
-- ── 1. Drop old overloads ────────────────────────────────────────────────────
-- Must be dropped before CREATE OR REPLACE to avoid ambiguous overloads
-- (PGRST203). PostgreSQL function identity includes the full argument list, so
-- the old 1-param / 2-param / 4-param versions and the new token-bearing versions
-- are distinct objects until the old ones are explicitly removed.

DROP FUNCTION IF EXISTS public.employee_get_last_punch(uuid);
DROP FUNCTION IF EXISTS public.employee_get_my_punches(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS public.employee_is_on_leave_today(uuid, uuid);
-- Drop the current 12-param employee_insert_punch so we can update its body
-- (the internal leave-check call). Signature is identical; only the body changes.
DROP FUNCTION IF EXISTS public.employee_insert_punch(
    uuid, uuid, text, timestamptz,
    double precision, double precision, text, uuid, text,
    uuid, uuid, text
);
-- ── 2. employee_is_on_leave_today ────────────────────────────────────────────
-- Recreated first because employee_insert_punch calls it by name at planning
-- time; PostgreSQL resolves the call at execution time, but defining it first
-- keeps the dependency order clean and avoids any potential plan-cache issue.

CREATE OR REPLACE FUNCTION public.employee_is_on_leave_today(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_session_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validates code-login session token (anon path) or JWT company membership
    -- (authenticated path). Raises UNAUTHORIZED / ERRCODE 42501 on failure.
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    RETURN EXISTS (
        SELECT 1
        FROM public.leave_requests
        WHERE company_id  = p_company_id
          AND employee_id = p_employee_id
          AND status      = 'approved'
          AND start_date  <= CURRENT_DATE
          AND end_date    >= CURRENT_DATE
    );
END;
$$;
REVOKE ALL ON FUNCTION public.employee_is_on_leave_today(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_is_on_leave_today(uuid, uuid, text) TO anon, authenticated;
-- ── 3. employee_get_my_punches ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.employee_get_my_punches(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_from          date,
    p_to            date,
    p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_emp public.employees%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    -- Secondary employee-existence guard: ensures the caller cannot retrieve
    -- punches for a deactivated or deleted employee record even if the session
    -- token itself is still valid.
    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id
      AND company_id = p_company_id
      AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    RETURN (
        SELECT coalesce(
            json_agg(row_to_json(tp) ORDER BY tp.date_time ASC),
            '[]'::json
        )
        FROM public.time_punches tp
        WHERE tp.employee_id       = p_employee_id
          AND tp.company_id        = p_company_id
          AND tp.date_time::date  >= p_from
          AND tp.date_time::date  <= p_to
    );
END;
$$;
REVOKE ALL ON FUNCTION public.employee_get_my_punches(uuid, uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_my_punches(uuid, uuid, date, date, text) TO anon, authenticated;
-- ── 4. employee_get_last_punch ───────────────────────────────────────────────
-- This function has no p_company_id parameter. Use _assert_worker_access_by_employee
-- which resolves company_id internally from employees.company_id before delegating
-- to _assert_worker_access. It returns the resolved company_id but that is not
-- needed here, so the result is discarded via PERFORM.

CREATE OR REPLACE FUNCTION public.employee_get_last_punch(
    p_employee_id   uuid,
    p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row json;
BEGIN
    -- Resolves company_id from employees.company_id, then calls _assert_worker_access.
    -- Raises UNAUTHORIZED / ERRCODE 42501 if the session is invalid or expired.
    PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);

    SELECT row_to_json(tp.*)
    INTO v_row
    FROM public.time_punches tp
    WHERE tp.employee_id = p_employee_id
    ORDER BY tp.date_time DESC
    LIMIT 1;

    RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.employee_get_last_punch(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_last_punch(uuid, text) TO anon, authenticated;
-- ── 5. employee_insert_punch (body update only) ──────────────────────────────
-- Signature is unchanged from 20260601120000. The sole change is the internal
-- call to employee_is_on_leave_today: p_session_token is now threaded through
-- so that _assert_worker_access inside that function receives a non-NULL token
-- instead of the DEFAULT NULL, which would trigger UNAUTHORIZED for anon callers.

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
SET search_path = public
AS $$
DECLARE v_punch public.time_punches;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    -- Idempotent short-circuit: if this key was already committed, return the
    -- existing row instead of inserting again (safe offline-replay).
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

    IF lower(trim(p_type)) = 'in' THEN
        -- Thread p_session_token through so employee_is_on_leave_today can satisfy
        -- its own _assert_worker_access call without a separate session lookup.
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
        -- Concurrent replay: another connection committed between our SELECT and INSERT.
        SELECT * INTO v_punch
        FROM public.time_punches
        WHERE company_id      = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
    END;

    RETURN row_to_json(v_punch);
END;
$$;
REVOKE ALL ON FUNCTION public.employee_insert_punch(
    uuid, uuid, text, timestamptz,
    double precision, double precision, text, uuid, text,
    uuid, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(
    uuid, uuid, text, timestamptz,
    double precision, double precision, text, uuid, text,
    uuid, uuid, text
) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual — run in reverse order)
--
-- Step 1: restore employee_insert_punch to the 20260601120000 body
--         (change leave check back to employee_is_on_leave_today without token)
--
-- DROP FUNCTION IF EXISTS public.employee_insert_punch(
--     uuid, uuid, text, timestamptz,
--     double precision, double precision, text, uuid, text,
--     uuid, uuid, text);
--
-- CREATE OR REPLACE FUNCTION public.employee_insert_punch(
--     p_company_id uuid, p_employee_id uuid, p_type text, p_date_time timestamptz,
--     p_latitude double precision DEFAULT NULL, p_longitude double precision DEFAULT NULL,
--     p_address text DEFAULT NULL, p_job_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
--     p_punched_by_manager_id uuid DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL,
--     p_session_token text DEFAULT NULL)
-- RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- DECLARE v_punch public.time_punches;
-- BEGIN
--   PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
--   IF p_idempotency_key IS NOT NULL THEN
--     SELECT * INTO v_punch FROM public.time_punches
--     WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key LIMIT 1;
--     IF FOUND THEN RETURN row_to_json(v_punch); END IF;
--   END IF;
--   IF lower(trim(p_type)) = 'in' THEN
--     IF employee_is_on_leave_today(p_company_id, p_employee_id) THEN   -- NOTE: no token
--       RAISE EXCEPTION 'Employee is on approved leave and cannot clock in';
--     END IF;
--     IF EXISTS (SELECT 1 FROM public.daily_absences WHERE company_id = p_company_id
--                AND employee_id = p_employee_id AND date = current_date) THEN
--       RAISE EXCEPTION 'Employee is marked absent and cannot clock in';
--     END IF;
--   END IF;
--   BEGIN
--     INSERT INTO public.time_punches (id, company_id, employee_id, type, date_time,
--       latitude, longitude, address, job_id, notes, punched_by_manager_id, idempotency_key)
--     VALUES (gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
--       p_latitude, p_longitude, p_address, p_job_id, p_notes,
--       p_punched_by_manager_id, p_idempotency_key)
--     RETURNING * INTO v_punch;
--   EXCEPTION WHEN unique_violation THEN
--     SELECT * INTO v_punch FROM public.time_punches
--     WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key LIMIT 1;
--   END;
--   RETURN row_to_json(v_punch);
-- END; $$;
-- REVOKE ALL ON FUNCTION public.employee_insert_punch(
--     uuid,uuid,text,timestamptz,double precision,double precision,text,uuid,text,uuid,uuid,text)
--   FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.employee_insert_punch(
--     uuid,uuid,text,timestamptz,double precision,double precision,text,uuid,text,uuid,uuid,text)
--   TO anon, authenticated;
--
-- Step 2: restore employee_is_on_leave_today without p_session_token
--
-- DROP FUNCTION IF EXISTS public.employee_is_on_leave_today(uuid, uuid, text);
-- CREATE OR REPLACE FUNCTION public.employee_is_on_leave_today(
--     p_company_id uuid, p_employee_id uuid)
-- RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- BEGIN
--   RETURN EXISTS (
--     SELECT 1 FROM public.leave_requests
--     WHERE company_id = p_company_id AND employee_id = p_employee_id
--       AND status = 'approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE);
-- END; $$;
-- GRANT EXECUTE ON FUNCTION public.employee_is_on_leave_today(uuid, uuid) TO anon, authenticated;
--
-- Step 3: restore employee_get_my_punches without p_session_token
--
-- DROP FUNCTION IF EXISTS public.employee_get_my_punches(uuid, uuid, date, date, text);
-- CREATE OR REPLACE FUNCTION public.employee_get_my_punches(
--     p_company_id uuid, p_employee_id uuid, p_from date, p_to date)
-- RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- DECLARE v_emp employees%rowtype;
-- BEGIN
--   SELECT * INTO v_emp FROM employees
--   WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
--   RETURN (SELECT coalesce(json_agg(row_to_json(tp) ORDER BY tp.date_time ASC), '[]'::json)
--     FROM time_punches tp WHERE tp.employee_id = p_employee_id AND tp.company_id = p_company_id
--       AND tp.date_time::date >= p_from AND tp.date_time::date <= p_to);
-- END; $$;
-- GRANT EXECUTE ON FUNCTION public.employee_get_my_punches(uuid,uuid,date,date) TO anon, authenticated;
--
-- Step 4: restore employee_get_last_punch without p_session_token
--
-- DROP FUNCTION IF EXISTS public.employee_get_last_punch(uuid, text);
-- CREATE OR REPLACE FUNCTION public.employee_get_last_punch(p_employee_id uuid)
-- RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- DECLARE v_row json;
-- BEGIN
--   SELECT row_to_json(tp.*) INTO v_row FROM time_punches tp
--   WHERE tp.employee_id = p_employee_id ORDER BY tp.date_time DESC LIMIT 1;
--   RETURN v_row;
-- END; $$;
-- GRANT EXECUTE ON FUNCTION public.employee_get_last_punch(uuid) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════;
