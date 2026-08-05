-- ════════════════════════════════════════════════════════════════════════════
-- FIX: Worker session enforcement — documents + payslips RPCs
--
-- Background
-- ──────────
-- Migration 20260601120000_worker_session_enforcement_rpcs.sql applied
-- p_session_token (text DEFAULT NULL) and _assert_worker_access() to the
-- bulk of the employee_* RPC surface. Three RPCs in the documents/payroll
-- module were not included:
--
--   • employee_get_payslips     (20260522162411 — 2 params, no token)
--   • employee_get_documents    (20260525062215 — 2 params, no token)
--   • employee_submit_document  (20260525062215 — 5 params, no token)
--
-- Why this causes PGRST202
-- ────────────────────────
-- WorkerRpc.ShouldInjectWorkerSession() returns true for all rpcNames that
-- start with "employee_" (and are not in WorkerSessionExcludedRpcs). For a
-- code-login session it appends p_session_token to the argument dictionary
-- before calling _supabase.Rpc(). PostgREST resolves by matching ALL
-- supplied named parameters against registered signatures. None of these
-- three functions register a p_session_token parameter, so PostgREST
-- returns HTTP 404 / PGRST202 "Could not find function" on every
-- call from a code-login client.
--
-- Production impact
-- ─────────────────
-- • employee_get_payslips     → payslip tab always blank for code-login workers
-- • employee_get_documents    → document library always empty for code-login workers
-- • employee_submit_document  → code-login workers cannot upload their own documents
--                               (conditional path: only when uploadedByRole == "employee")
--
-- Internal call chain analysis
-- ────────────────────────────
-- All three functions query base tables directly (employees, payment_approvals,
-- employee_documents). None call any other employee_* RPC. No session token
-- threading through a call chain is required (contrast with the
-- employee_insert_punch → employee_is_on_leave_today chain fixed in
-- 20260602100000).
--
-- New signatures
-- ──────────────
--   employee_get_payslips    (uuid, uuid, text)
--   employee_get_documents   (uuid, uuid, text)
--   employee_submit_document (uuid, uuid, text, text, text, text)
-- p_session_token is the LAST parameter with DEFAULT NULL in every case,
-- matching the injection order used by WorkerRpc.RpcAsync().
--
-- Coverage result
-- ───────────────
-- After this migration all code-login-reachable employee_* RPCs have
-- DB-side session enforcement. The only remaining partial gap is the
-- AppTelemetry.PersistAsync call path that invokes employee_log_app_event
-- via _supabase.Rpc directly (not via RpcAsync) — the DB function itself
-- IS enforced; the gap is client-side best-effort token injection.
--
-- Requires: 20260601110000_worker_session_enforcement_foundation.sql
--           (_assert_worker_access must already exist)
--
-- Rollback: see bottom of file.
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;
-- ── 1. Drop old overloads ────────────────────────────────────────────────────
-- Must be dropped before CREATE OR REPLACE to eliminate any ambiguous overload
-- (PGRST203). PostgreSQL identifies functions by their full argument list, so
-- the old N-param and new (N+1)-param versions are distinct objects until the
-- old ones are explicitly removed.

DROP FUNCTION IF EXISTS public.employee_get_payslips(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_documents(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_submit_document(uuid, uuid, text, text, text);
-- ── 2. employee_get_payslips ─────────────────────────────────────────────────
-- Source: 20260522162411_payslip_employee_sharing.sql
-- Original: returns json, security definer, set search_path = public
-- Change:   + p_session_token text DEFAULT NULL (last param)
--           + PERFORM _assert_worker_access (first statement)
--           + set row_security = off (consistent with enforcement migration pattern)

CREATE OR REPLACE FUNCTION public.employee_get_payslips(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_emp employees%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    SELECT * INTO v_emp FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    RETURN (
        SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.period_start DESC), '[]'::json)
        FROM payment_approvals p
        WHERE p.employee_id = p_employee_id
          AND p.company_id  = p_company_id
          AND p.shared_with_employee = true
    );
END;
$$;
-- ── 3. employee_get_documents ────────────────────────────────────────────────
-- Source: 20260525062215_employee_documents.sql
-- Original: returns json, security definer, set search_path = public
-- Change:   + p_session_token text DEFAULT NULL (last param)
--           + PERFORM _assert_worker_access (first statement)
--           + set row_security = off

CREATE OR REPLACE FUNCTION public.employee_get_documents(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    PERFORM 1 FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    RETURN (
        SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]'::json)
        FROM employee_documents d
        WHERE d.employee_id = p_employee_id AND d.company_id = p_company_id
    );
END;
$$;
-- ── 4. employee_submit_document ──────────────────────────────────────────────
-- Source: 20260525062215_employee_documents.sql
-- Original: returns json, security definer, set search_path = public
-- Change:   + p_session_token text DEFAULT NULL (last param)
--           + PERFORM _assert_worker_access (first statement)
--           + set row_security = off
-- Note: uploaded_by_role is hardcoded 'employee' — preserved exactly as in
--       the original. Only reachable from client when uploadedByRole == "employee".

CREATE OR REPLACE FUNCTION public.employee_submit_document(
    p_company_id    uuid,
    p_employee_id   uuid,
    p_document_type text,
    p_document_name text,
    p_file_url      text,
    p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
    v_doc employee_documents%rowtype;
BEGIN
    PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    PERFORM 1 FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

    INSERT INTO employee_documents (company_id, employee_id, document_type, document_name, file_url, uploaded_by_role)
    VALUES (p_company_id, p_employee_id, p_document_type, p_document_name, p_file_url, 'employee')
    RETURNING * INTO v_doc;

    RETURN row_to_json(v_doc);
END;
$$;
-- ── 5. Re-grant anon + authenticated ────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid, uuid, text)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid, uuid, text)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid, uuid, text, text, text, text) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual)
-- ─────────────────
-- Run the block below to revert to the pre-enforcement signatures.
-- The client (WorkerRpc.RpcAsync) will revert to PGRST202 errors for
-- code-login workers, but no data is lost — these are read/insert-only RPCs.
--
--   DROP FUNCTION IF EXISTS public.employee_get_payslips(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.employee_get_documents(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.employee_submit_document(uuid, uuid, text, text, text, text);
--
--   CREATE OR REPLACE FUNCTION public.employee_get_payslips(p_company_id uuid, p_employee_id uuid)
--   RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   DECLARE v_emp employees%rowtype;
--   BEGIN
--       SELECT * INTO v_emp FROM employees WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
--       IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
--       RETURN (SELECT COALESCE(json_agg(row_to_json(p) ORDER BY p.period_start DESC), '[]'::json)
--               FROM payment_approvals p WHERE p.employee_id = p_employee_id AND p.company_id = p_company_id AND p.shared_with_employee = true);
--   END; $$;
--
--   CREATE OR REPLACE FUNCTION public.employee_get_documents(p_company_id uuid, p_employee_id uuid)
--   RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   BEGIN
--       PERFORM 1 FROM employees WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
--       IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
--       RETURN (SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.created_at DESC), '[]'::json)
--               FROM employee_documents d WHERE d.employee_id = p_employee_id AND d.company_id = p_company_id);
--   END; $$;
--
--   CREATE OR REPLACE FUNCTION public.employee_submit_document(
--       p_company_id uuid, p_employee_id uuid, p_document_type text, p_document_name text, p_file_url text)
--   RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
--   DECLARE v_doc employee_documents%rowtype;
--   BEGIN
--       PERFORM 1 FROM employees WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
--       IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
--       INSERT INTO employee_documents (company_id, employee_id, document_type, document_name, file_url, uploaded_by_role)
--       VALUES (p_company_id, p_employee_id, p_document_type, p_document_name, p_file_url, 'employee') RETURNING * INTO v_doc;
--       RETURN row_to_json(v_doc);
--   END; $$;
--
--   GRANT EXECUTE ON FUNCTION public.employee_get_payslips(uuid, uuid)                      TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.employee_get_documents(uuid, uuid)                     TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.employee_submit_document(uuid, uuid, text, text, text) TO anon, authenticated;
--
-- ════════════════════════════════════════════════════════════════════════════;
