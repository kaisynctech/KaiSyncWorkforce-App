CREATE OR REPLACE FUNCTION public._assert_worker_access(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_session_token text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL OR p_employee_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'company_id and employee_id are required';
  END IF;

  -- JWT path (HR shell or MAUI login)
  IF auth.uid() IS NOT NULL THEN

    -- Case 1: the caller IS the employee (own record)
    IF EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id          = p_employee_id
        AND e.company_id  = p_company_id
        AND e.user_id     = auth.uid()
    ) THEN
      RETURN;
    END IF;

    -- Case 2: the caller is an HR / manager / owner employee of this company
    --         (replaces the old hr_users table which no longer exists)
    IF EXISTS (
      SELECT 1 FROM public.employees hr
      WHERE hr.user_id     = auth.uid()
        AND hr.company_id  = p_company_id
        AND hr.access_level IN ('hr', 'owner', 'manager')
        AND hr.is_active   = true
    ) THEN
      RETURN;
    END IF;

    RAISE EXCEPTION 'UNAUTHORIZED'
      USING ERRCODE = '42501', DETAIL = 'jwt_not_linked_to_employee';
  END IF;

  -- Code-login worker path: require active session token
  IF p_session_token IS NULL OR length(trim(p_session_token)) = 0 THEN
    PERFORM public.employee_validate_session(
      p_company_id, p_employee_id, coalesce(p_session_token, '')
    );
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
$function$;
