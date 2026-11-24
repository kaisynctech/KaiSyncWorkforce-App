-- Populate sender_display_name when employees send thread / company-feed messages.
-- Historical rows with NULL display names are backfilled from employees.

CREATE OR REPLACE FUNCTION public.employee_send_thread_message(
  p_company_id uuid,
  p_thread_id uuid,
  p_sender_employee_id uuid,
  p_body text,
  p_session_token text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_display_name text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);

  IF trim(coalesce(p_body, '')) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.message_threads t
    WHERE t.id = p_thread_id
      AND t.company_id = p_company_id
      AND p_sender_employee_id = ANY (t.participant_ids)
  ) THEN
    RAISE EXCEPTION 'not a thread member';
  END IF;

  SELECT nullif(trim(concat_ws(' ', e.name, e.surname)), '')
    INTO v_display_name
  FROM public.employees e
  WHERE e.id = p_sender_employee_id
    AND e.company_id = p_company_id;

  INSERT INTO public.app_messages (
    company_id,
    thread_id,
    sender_id,
    body,
    sender_display_name
  )
  VALUES (
    p_company_id,
    p_thread_id,
    p_sender_employee_id,
    trim(p_body),
    v_display_name
  );

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = p_thread_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.employee_send_company_feed_message(
  p_company_id uuid,
  p_sender_employee_id uuid,
  p_body text,
  p_session_token text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_thread uuid;
  v_display_name text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);

  IF trim(coalesce(p_body, '')) = ''
     OR NOT public._employee_valid(p_company_id, p_sender_employee_id) THEN
    RETURN;
  END IF;

  v_thread := public._company_feed_thread_id(p_company_id);

  SELECT nullif(trim(concat_ws(' ', e.name, e.surname)), '')
    INTO v_display_name
  FROM public.employees e
  WHERE e.id = p_sender_employee_id
    AND e.company_id = p_company_id;

  INSERT INTO public.app_messages (
    company_id,
    thread_id,
    sender_id,
    body,
    sender_display_name
  )
  VALUES (
    p_company_id,
    v_thread,
    p_sender_employee_id,
    trim(p_body),
    v_display_name
  );

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = v_thread;
END;
$function$;

UPDATE public.app_messages m
SET sender_display_name = nullif(trim(concat_ws(' ', e.name, e.surname)), '')
FROM public.employees e
WHERE m.sender_id = e.id
  AND m.company_id = e.company_id
  AND nullif(trim(coalesce(m.sender_display_name, '')), '') IS NULL
  AND nullif(trim(concat_ws(' ', e.name, e.surname)), '') IS NOT NULL;
