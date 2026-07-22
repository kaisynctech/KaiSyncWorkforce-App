-- ════════════════════════════════════════════════════════════════════════════
-- FIX H1 — OFFLINE PUNCH IDEMPOTENCY
--
-- Problem: queued offline punches carry no idempotency key. A punch that commits
-- server-side but appears to fail client-side (e.g. network drop after commit) is
-- re-queued and replayed → DUPLICATE punch row, corrupting attendance/payroll.
--
-- Fix:
--   • add nullable time_punches.idempotency_key (uuid)
--   • partial UNIQUE index on (company_id, idempotency_key) — existing NULL rows excluded
--   • employee_insert_punch gains p_idempotency_key; a replay with a key that already
--     exists returns the EXISTING row instead of inserting again (idempotent).
--
-- The 10-arg overload is DROPPED and replaced by an 11-arg version so PostgREST has
-- a single overload (no PGRST203). The client always sends the new param.
-- Backward compatible: key is nullable; punches without a key behave exactly as before.
-- ════════════════════════════════════════════════════════════════════════════

set search_path = public;
-- ─── 1. Column + dedup index ────────────────────────────────────────────────
ALTER TABLE public.time_punches
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_punches_company_idempotency
  ON public.time_punches (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- ─── 2. Replace the punch RPC with an idempotent, 11-arg version ────────────
DROP FUNCTION IF EXISTS public.employee_insert_punch(
  uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid
);
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
    p_punched_by_manager_id uuid DEFAULT NULL,
    p_idempotency_key uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_punch time_punches;
BEGIN
    -- Idempotent short-circuit: if this key was already recorded for the company,
    -- return the existing punch unchanged (safe offline-replay).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_punch
        FROM time_punches
        WHERE company_id = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
        IF FOUND THEN
            RETURN row_to_json(v_punch);
        END IF;
    END IF;

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

    BEGIN
        INSERT INTO time_punches (
            id, company_id, employee_id, type, date_time,
            latitude, longitude, address, job_id, notes,
            punched_by_manager_id, idempotency_key
        ) VALUES (
            gen_random_uuid(), p_company_id, p_employee_id, p_type, p_date_time,
            p_latitude, p_longitude, p_address, p_job_id, p_notes,
            p_punched_by_manager_id, p_idempotency_key
        ) RETURNING * INTO v_punch;
    EXCEPTION WHEN unique_violation THEN
        -- Concurrent replay raced us between the SELECT and INSERT — return the winner.
        SELECT * INTO v_punch
        FROM time_punches
        WHERE company_id = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;
    END;

    RETURN row_to_json(v_punch);
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(
  uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid, uuid
) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
--   • Recreate the prior 10-arg overload from
--     20260528140000_fix_employee_insert_punch_overload.sql and DROP the 11-arg one:
--       drop function if exists public.employee_insert_punch(
--         uuid,uuid,text,timestamptz,double precision,double precision,text,uuid,text,uuid,uuid);
--   • The column/index are additive and may be left in place safely:
--       drop index if exists public.uq_time_punches_company_idempotency;
--       alter table public.time_punches drop column if exists idempotency_key;
--   • Reverting the RPC requires reverting the C# (InsertPunchAsync sends p_idempotency_key).
-- ════════════════════════════════════════════════════════════════════════════;
