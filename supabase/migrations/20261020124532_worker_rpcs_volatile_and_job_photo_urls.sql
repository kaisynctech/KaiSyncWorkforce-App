-- Worker (code-session) RPC fixes. Behaviour and security checks unchanged.
--
-- 1. These functions call public._assert_worker_access, which writes
--    employee_code_sessions.last_seen_at. They were declared STABLE, so PostgREST
--    runs them in a read-only transaction and every code-session worker call fails
--    with "cannot execute UPDATE in a read-only transaction" (HTTP 405).
--    Evidence 19-20 Oct: employee_assigned_branch_ids 118 x 405 vs 40 x 200;
--    message_unread_counts_for_threads 3 x 405.
--    Fix: VOLATILE (the default). ALTER keeps owner, grants, SECURITY DEFINER and settings.
ALTER FUNCTION public.employee_assigned_branch_ids(uuid, uuid, text) VOLATILE;
ALTER FUNCTION public.message_unread_counts_for_threads(uuid, uuid, uuid[], text) VOLATILE;

-- 2. employee_get_job_photo_urls read photo_urls_before/after from the result of
--    employee_get_job_for_employee, which does not return those columns, so it always
--    failed ("column j.photo_urls_before does not exist", HTTP 400).
--    Fix: keep the same access rule (the job must be returned by
--    employee_get_job_for_employee for this worker), then read the photos from jobs.
--    CREATE OR REPLACE keeps owner and grants.
CREATE OR REPLACE FUNCTION public.employee_get_job_photo_urls(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_session_token text DEFAULT NULL::text
)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (
    SELECT json_build_object(
      'photo_urls_before', coalesce(jb.photo_urls_before, '{}'::text[]),
      'photo_urls_after',  coalesce(jb.photo_urls_after,  '{}'::text[])
    )
    FROM public.jobs jb
    WHERE jb.company_id = p_company_id
      AND jb.id = (
        SELECT j.id
        FROM public.employee_get_job_for_employee(p_company_id, p_employee_id, p_job_id, p_session_token) j
        LIMIT 1
      )
  );
END;
$function$;

-- 3. message_company_feed_unread_count could never succeed:
--    it called _company_feed_thread_id with 2 arguments (the function takes 1),
--    giving "function does not exist" (HTTP 404), and it called
--    message_unread_counts_for_threads without the worker's session token, which
--    _assert_worker_access rejects for code-session workers.
--    Fix: correct call arguments; VOLATILE (it writes last_seen_at and may create
--    the company feed thread). Same access check, owner, grants and settings.
CREATE OR REPLACE FUNCTION public.message_company_feed_unread_count(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL::text
)
 RETURNS bigint
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT coalesce((
    SELECT unread_count
    FROM public.message_unread_counts_for_threads(
      p_company_id,
      p_employee_id,
      ARRAY[public._company_feed_thread_id(p_company_id)],
      p_session_token
    )
  ), 0));
END;
$function$;

NOTIFY pgrst, 'reload schema';
