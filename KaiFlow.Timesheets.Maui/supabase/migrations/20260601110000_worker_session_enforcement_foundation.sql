-- ════════════════════════════════════════════════════════════════════════════
-- WORKER SESSION ENFORCEMENT — Foundation
--
-- Adds _assert_worker_access() for dual-path authorization:
--   • authenticated (HR JWT): linked employee or hr_users for company
--   • anon (code-login): valid p_session_token via _employee_session_is_valid()
--
-- Rollback: drop function _assert_worker_access(uuid,uuid,text);
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;

CREATE OR REPLACE FUNCTION public._assert_worker_access(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'company_id and employee_id are required';
  END IF;

  -- HR / manager JWT path (authenticated PostgREST or MAUI HR login)
  IF auth.uid() IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.id = p_employee_id
        AND e.company_id = p_company_id
        AND e.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1
      FROM public.hr_users h
      WHERE h.user_id = auth.uid()
        AND h.company_id = p_company_id
    ) THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'jwt_not_linked_to_employee';
  END IF;

  -- Code-login worker path: require active session token
  IF p_session_token IS NULL OR length(trim(p_session_token)) = 0 THEN
    PERFORM public.employee_validate_session(p_company_id, p_employee_id, coalesce(p_session_token, ''));
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'session_token_required';
  END IF;

  IF NOT public._employee_session_is_valid(p_company_id, p_employee_id, p_session_token) THEN
    PERFORM public.employee_validate_session(p_company_id, p_employee_id, p_session_token);
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'invalid_or_expired_session';
  END IF;

  UPDATE public.employee_code_sessions
  SET last_seen_at = now()
  WHERE session_token = p_session_token;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_worker_access(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_worker_access(uuid, uuid, text) TO anon, authenticated;

-- Helper for RPCs that only receive employee_id (resolve company internally)
CREATE OR REPLACE FUNCTION public._assert_worker_access_by_employee(
  p_employee_id uuid,
  p_session_token text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT e.company_id INTO v_company_id
  FROM public.employees e
  WHERE e.id = p_employee_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  PERFORM public._assert_worker_access(v_company_id, p_employee_id, p_session_token);
  RETURN v_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_worker_access_by_employee(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._assert_worker_access_by_employee(uuid, text) TO anon, authenticated;
