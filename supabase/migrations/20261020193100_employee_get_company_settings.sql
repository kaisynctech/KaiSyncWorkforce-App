-- Company settings for code-sign-in workers.
--
-- get_company_settings only allows company members with a Supabase account
-- (user_company_ids()). Workers who sign in with a company + login code have none,
-- so it raised 'Access denied' (HTTP 400) and My Leave / My Attendance silently
-- used default leave types and time zone instead of the company's.
--
-- This adds a worker-scoped read with the same session check as every other
-- employee_* RPC. It returns ONLY what worker screens use (time zone, currency,
-- leave settings) — not payroll, VAT, branding or security settings.
-- get_company_settings itself is unchanged.
CREATE OR REPLACE FUNCTION public.employee_get_company_settings(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.company_settings%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  SELECT * INTO v_row FROM public.company_settings WHERE company_id = p_company_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('company_id', p_company_id);
  END IF;
  RETURN jsonb_build_object(
    'company_id',     p_company_id,
    'timezone',       v_row.timezone,
    'currency',       v_row.currency,
    'leave_settings', v_row.leave_settings
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.employee_get_company_settings(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_get_company_settings(uuid, uuid, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
