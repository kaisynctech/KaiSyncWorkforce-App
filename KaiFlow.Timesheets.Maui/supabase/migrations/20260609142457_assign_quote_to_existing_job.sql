-- Migration: 20260609142457_assign_quote_to_existing_job
-- Assign quote to existing job - job messaging functions for quote-linked jobs
-- Representation file: idempotent (CREATE OR REPLACE FUNCTION throughout)

CREATE OR REPLACE FUNCTION public.contractor_portal_get_job_messages(p_company_code text, p_contractor_code text, p_job_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_subject text;
  v_thread_id uuid;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RETURN '[]'::json; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RETURN '[]'::json;
  END IF;

  v_subject := 'Job:' || p_job_id::text;
  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_ct.company_id AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN RETURN '[]'::json; END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(m) ORDER BY m.created_at), '[]'::json)
    FROM public.app_messages m
    WHERE m.thread_id = v_thread_id
  );
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_get_job_messages(p_company_code text, p_contractor_code text, p_job_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_get_job_messages(p_company_code text, p_contractor_code text, p_job_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_job_messages(p_company_code text, p_contractor_code text, p_job_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_get_job_messages(p_company_code text, p_contractor_code text, p_job_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.contractor_portal_send_job_message(p_company_code text, p_contractor_code text, p_job_id uuid, p_body text, p_sender_name text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ct public.contractors%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_thread_id uuid;
  v_subject text;
  v_msg public.app_messages%ROWTYPE;
  v_manager uuid;
BEGIN
  SELECT * INTO v_ct
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'; END IF;
  IF NOT public._contractor_owns_job(v_ct.company_id, v_ct.id, p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_ASSIGNED';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  v_manager := coalesce(v_job.assignee_employee_id, v_job.contractor_employee_id);
  v_subject := 'Job:' || p_job_id::text;

  SELECT t.id INTO v_thread_id
  FROM public.message_threads t
  WHERE t.company_id = v_ct.company_id
    AND t.subject = v_subject
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    INSERT INTO public.message_threads (id, company_id, subject, participant_ids, type_raw, created_at)
    VALUES (
      gen_random_uuid(),
      v_ct.company_id,
      v_subject,
      CASE WHEN v_manager IS NOT NULL THEN ARRAY[v_manager] ELSE '{}' END,
      'job',
      now()
    )
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.app_messages (
    id, thread_id, sender_id, body, company_id, created_at,
    sender_contractor_id, sender_display_name
  ) VALUES (
    gen_random_uuid(),
    v_thread_id,
    coalesce(v_manager, v_ct.id),
    trim(p_body),
    v_ct.company_id,
    now(),
    v_ct.id,
    coalesce(nullif(trim(p_sender_name), ''), v_ct.name)
  )
  RETURNING * INTO v_msg;

  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = v_thread_id;

  RETURN row_to_json(v_msg);
END;
$function$


REVOKE ALL ON FUNCTION public.contractor_portal_send_job_message(p_company_code text, p_contractor_code text, p_job_id uuid, p_body text, p_sender_name text DEFAULT NULL::text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contractor_portal_send_job_message(p_company_code text, p_contractor_code text, p_job_id uuid, p_body text, p_sender_name text DEFAULT NULL::text) FROM anon;
GRANT EXECUTE ON FUNCTION public.contractor_portal_send_job_message(p_company_code text, p_contractor_code text, p_job_id uuid, p_body text, p_sender_name text DEFAULT NULL::text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contractor_portal_send_job_message(p_company_code text, p_contractor_code text, p_job_id uuid, p_body text, p_sender_name text DEFAULT NULL::text) TO service_role;

