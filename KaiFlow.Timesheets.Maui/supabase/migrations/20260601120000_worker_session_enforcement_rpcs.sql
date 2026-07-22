-- ════════════════════════════════════════════════════════════════════════════
-- WORKER SESSION ENFORCEMENT — Per-RPC session token binding
--
-- Adds p_session_token (last param) + _assert_worker_access() to all worker-facing
-- employee_* RPCs (and related PA/messaging helpers) granted to anon.
--
-- Requires: 20260601110000_worker_session_enforcement_foundation.sql
-- Regenerate: python scripts/generate_worker_session_migration.py
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;
-- ─── Drop pre-session overloads ────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.employee_add_incident_comment(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_append_incident_photos(uuid, uuid, uuid, text[]);
DROP FUNCTION IF EXISTS public.employee_append_job_photo(uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.employee_consume_media_upload(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.employee_create_job(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid[], uuid, text);
DROP FUNCTION IF EXISTS public.employee_delete_pa_task(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_find_direct_thread_peer(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_calendar_events_for_worker(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS public.employee_get_checklist_for_job(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_company_approved_leave(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_company_feed_thread(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_company_messages_for_worker(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.employee_get_daily_absences(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS public.employee_get_direct_peer_thread_map(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_incident(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_incident_comments(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_incident_status_history(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_incidents(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.employee_get_inventory_items(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_inventory_usage_for_job(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_card_for_employee(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_card_for_job(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_documents(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_feedback(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_for_employee(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_photo_urls(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_job_thread(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_jobs_for_employee(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_leave_requests(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_linked_contractors(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_message_threads_for_worker(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_my_notifications_for_employee(uuid);
DROP FUNCTION IF EXISTS public.employee_get_or_create_direct_thread_peer(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_get_own_incidents(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_pa_settings(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_pa_tasks(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_thread_messages_for_worker(uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.employee_get_work_teams(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_workflow_form_submissions(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_get_workflow_form_templates(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_insert_checklist_item(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_insert_incident(uuid, uuid, text, text, uuid, uuid, uuid, text[], text, text, text, timestamptz, double precision, double precision, text);
DROP FUNCTION IF EXISTS public.employee_insert_job_document(uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.employee_insert_pa_task(uuid, uuid, text, text, date, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.employee_insert_punch(uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_job_site_open_visit(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_job_site_sign_in(uuid, uuid, uuid, double precision, double precision, text, text, text);
DROP FUNCTION IF EXISTS public.employee_job_site_sign_out(uuid, uuid, uuid, double precision, double precision, text, text);
DROP FUNCTION IF EXISTS public.employee_job_site_sign_out_open_visit(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_job_site_switch_to_job(uuid, uuid, uuid, double precision, double precision, text, text, text);
DROP FUNCTION IF EXISTS public.employee_list_company_peers(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_log_app_event(uuid, uuid, text, text, text, text, jsonb, text, text);
DROP FUNCTION IF EXISTS public.employee_mark_company_feed_read_for_worker(uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_mark_notification_read_for_employee(uuid, bigint);
DROP FUNCTION IF EXISTS public.employee_mark_thread_read_for_worker(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_notify_manager_job_created(uuid, uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_prepare_media_upload(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.employee_report_absence(uuid, uuid, date, text, text);
DROP FUNCTION IF EXISTS public.employee_send_company_feed_message(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_send_thread_message(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_set_inventory_usage_for_job(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.employee_set_open_punch_job(bigint, bigint, bigint, date);
DROP FUNCTION IF EXISTS public.employee_submit_job_feedback(uuid, uuid, uuid, int, text);
DROP FUNCTION IF EXISTS public.employee_submit_leave_request(uuid, uuid, text, date, date, float, text, text);
DROP FUNCTION IF EXISTS public.employee_submit_workflow_form(uuid, uuid, uuid, jsonb, uuid, uuid);
DROP FUNCTION IF EXISTS public.employee_update_calendar_event_attendance(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_update_checklist_item(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.employee_update_document(uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.employee_update_incident(uuid, uuid, uuid, text, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.employee_update_job_status(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_update_leave_request(uuid, uuid, text, date, date, float, text, text);
DROP FUNCTION IF EXISTS public.employee_update_pa_task(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.employee_update_pa_task_status(uuid, uuid, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.employee_update_profile(uuid, uuid, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.employee_update_punch_address(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.employee_upsert_job_card(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text);
DROP FUNCTION IF EXISTS public.enqueue_pa_task_notifications(uuid);
DROP FUNCTION IF EXISTS public.message_company_feed_unread_count(uuid, uuid);
DROP FUNCTION IF EXISTS public.message_unread_counts_for_threads(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.sync_operational_pa_tasks(uuid, uuid);
DROP FUNCTION IF EXISTS public.upsert_employee_pa_settings(uuid, uuid, boolean, boolean, boolean);
-- ─── Recreate with session enforcement ─────────────────────────────────────

-- employee_add_incident_comment
create or replace function public.employee_add_incident_comment(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_body text,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_comments%rowtype;
  v_name text;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_body, '')) = '' then
    raise exception 'BODY_REQUIRED';
  end if;

  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  select trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
  into v_name
  from public.employees e
  where e.id = p_employee_id;

  insert into public.incident_comments (
    company_id, incident_id, author_employee_id, author_name, body
  ) values (
    p_company_id, p_incident_id, p_employee_id,
    nullif(trim(v_name), ''), trim(p_body)
  )
  returning * into v_row;

  update public.incident_reports set updated_at = now() where id = p_incident_id;

  return row_to_json(v_row);
end;
$$;
-- employee_append_incident_photos
create or replace function public.employee_append_incident_photos(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_photo_urls text[],
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.incident_reports
  set photo_urls = photo_urls || coalesce(p_photo_urls, '{}'),
      updated_at = now()
  where id = p_incident_id and company_id = p_company_id
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
-- employee_append_job_photo
CREATE OR REPLACE FUNCTION public.employee_append_job_photo(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_phase text,
  p_photo_url text,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF trim(coalesce(p_photo_url, '')) = '' THEN
    RAISE EXCEPTION 'PHOTO_URL_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employee_get_job_for_employee(p_company_id, p_employee_id, p_job_id, p_session_token)
  ) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;

  IF lower(trim(coalesce(p_phase, ''))) = 'after' THEN
    UPDATE public.jobs
    SET photo_urls_after = array_append(coalesce(photo_urls_after, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  ELSE
    UPDATE public.jobs
    SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;
  END IF;
END;
$$;
-- employee_consume_media_upload
CREATE OR REPLACE FUNCTION public.employee_consume_media_upload(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_storage_path  text,
  p_session_token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  UPDATE public.media_upload_grants
  SET consumed_at = now()
  WHERE storage_path = trim(both '/' from trim(p_storage_path))
    AND company_id = p_company_id
    AND employee_id = p_employee_id;
END;
$$;
-- employee_create_job
create or replace function public.employee_create_job(
  p_company_id              uuid,
  p_creator_employee_id     uuid,
  p_title                   text,
  p_description             text default null,
  p_priority                text default 'medium',
  p_scheduled_start         timestamptz default null,
  p_scheduled_end           timestamptz default null,
  p_site_id                 uuid default null,
  p_client_id               uuid default null,
  p_assignee_employee_id    uuid default null,
  p_assigned_employee_ids   uuid[] default '{}',
  p_notify_manager_employee_id uuid default null,
  p_visibility              text default 'inherit',
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.jobs%rowtype;
  v_ids uuid[];
  v_assignee uuid;
  v_mgr_user uuid;
  v_employee_name text;
begin
  PERFORM public._assert_worker_access(p_company_id, p_creator_employee_id, p_session_token);

  if trim(coalesce(p_title, '')) = '' then
    raise exception 'TITLE_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_creator_employee_id) then
    raise exception 'invalid employee';
  end if;

  v_ids := coalesce(p_assigned_employee_ids, '{}'::uuid[]);
  if not (p_creator_employee_id = any(v_ids)) then
    v_ids := array_prepend(p_creator_employee_id, v_ids);
  end if;

  foreach v_assignee in array v_ids loop
    if not public._employee_valid(p_company_id, v_assignee) then
      raise exception 'invalid assignee %', v_assignee;
    end if;
  end loop;

  v_assignee := coalesce(p_assignee_employee_id, p_creator_employee_id);
  if not (v_assignee = any(v_ids)) then
    v_ids := array_prepend(v_assignee, v_ids);
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.company_id = p_company_id
  ) then
    raise exception 'invalid site';
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = p_client_id and c.company_id = p_company_id
  ) then
    raise exception 'invalid client';
  end if;

  insert into public.jobs (
    company_id, title, description, priority,
    scheduled_start, scheduled_end, site_id, client_id,
    status, opened_at, visibility, job_code,
    created_by_employee_id, assignee_employee_id, assigned_employee_ids,
    created_at, updated_at
  ) values (
    p_company_id,
    trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''),
    coalesce(nullif(trim(p_priority), ''), 'medium'),
    p_scheduled_start,
    coalesce(p_scheduled_end, p_scheduled_start + interval '8 hours'),
    p_site_id,
    p_client_id,
    'scheduled',
    now(),
    coalesce(nullif(trim(p_visibility), ''), 'inherit'),
    public._next_job_code(p_company_id),
    p_creator_employee_id,
    v_assignee,
    v_ids,
    now(),
    now()
  )
  returning * into v_row;

  perform public.ensure_job_team_message_thread(p_company_id, v_row.id);

  if p_scheduled_start is not null then
    insert into public.calendar_events (
      company_id, title, description, start_time, end_time,
      attendee_ids, event_type, linked_job_id, created_by, created_at
    ) values (
      p_company_id,
      v_row.title,
      v_row.description,
      p_scheduled_start,
      coalesce(p_scheduled_end, p_scheduled_start + interval '8 hours'),
      v_ids,
      'job',
      v_row.id,
      p_creator_employee_id,
      now()
    );
  end if;

  if p_notify_manager_employee_id is not null then
    select e.user_id,
           trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
    into v_mgr_user, v_employee_name
    from public.employees e
    where e.id = p_notify_manager_employee_id
      and e.company_id = p_company_id
      and e.is_active = true;

    if v_mgr_user is not null then
      perform public.employee_notify_manager_job_created(
        p_company_id,
        v_mgr_user,
        v_row.id,
        p_creator_employee_id,
        v_row.title
      );
    end if;
  end if;

  return row_to_json(v_row);
end;
$$;
-- employee_delete_pa_task
CREATE OR REPLACE FUNCTION public.employee_delete_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  DELETE FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
END;
$$;
-- employee_find_direct_thread_peer
CREATE OR REPLACE FUNCTION public.employee_find_direct_thread_peer(
  p_company_id uuid,
  p_from_id uuid,
  p_to_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_from_id, p_session_token);
  RETURN (SELECT t.id
  FROM public.message_threads t
  WHERE t.company_id = p_company_id
    AND t.type_raw = 'direct'
    AND p_from_id = ANY(t.participant_ids)
    AND p_to_id = ANY(t.participant_ids)
    AND cardinality(t.participant_ids) = 2
  ORDER BY t.created_at DESC
  LIMIT 1);
END;
$$;
-- employee_get_calendar_events_for_worker
create or replace function public.employee_get_calendar_events_for_worker(
  p_company_id  uuid,
  p_employee_id uuid,
  p_from        date,
  p_to          date,
  p_session_token text DEFAULT NULL)
returns setof public.calendar_events
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select e.*
  from public.calendar_events e
  where e.company_id = p_company_id
    and p_employee_id = any(e.attendee_ids)
    and e.start_time >= p_from::timestamptz
    and e.start_time <= (p_to + 1)::timestamptz
    and public._employee_valid(p_company_id, p_employee_id)
  order by e.start_time asc;
END;
$$;
-- employee_get_checklist_for_job
CREATE OR REPLACE FUNCTION public.employee_get_checklist_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.job_checklist_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT c.*
  FROM public.job_checklist_items c
  WHERE c.company_id = p_company_id
    AND c.job_id = p_job_id
    AND public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id)
  ORDER BY c.sort_order, c.description;
END;
$$;
-- employee_get_company_approved_leave
CREATE OR REPLACE FUNCTION public.employee_get_company_approved_leave(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.leave_requests
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT lr.*
  FROM public.leave_requests lr
  WHERE lr.company_id = p_company_id
    AND lr.status = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
END;
$$;
-- employee_get_company_feed_thread
create or replace function public.employee_get_company_feed_thread(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.message_threads
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_valid(p_company_id, p_employee_id) then
    return;
  end if;

  v_id := public._company_feed_thread_id(p_company_id);

  return query
  select t.*
  from public.message_threads t
  where t.id = v_id;
end;
$$;
-- employee_get_company_messages_for_worker
CREATE OR REPLACE FUNCTION public.employee_get_company_messages_for_worker(
  p_company_id uuid,
  p_employee_id uuid,
  p_limit integer DEFAULT 120,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.app_messages
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT m.*
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id = public._company_feed_thread_id(p_company_id)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 120), 500));
END;
$$;
-- employee_get_daily_absences
CREATE OR REPLACE FUNCTION public.employee_get_daily_absences(
  p_company_id uuid,
  p_employee_id uuid,
  p_from date,
  p_to date,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.daily_absences
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT da.*
  FROM public.daily_absences da
  WHERE da.company_id = p_company_id
    AND da.employee_id = p_employee_id
    AND da.date >= p_from
    AND da.date <= p_to
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    )
  ORDER BY da.date DESC;
END;
$$;
-- employee_get_direct_peer_thread_map
CREATE OR REPLACE FUNCTION public.employee_get_direct_peer_thread_map(
  p_company_id uuid,
  p_my_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS TABLE(peer_employee_id uuid, thread_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_my_employee_id, p_session_token);
  RETURN QUERY
  SELECT other_id AS peer_employee_id, t.id AS thread_id
  FROM public.message_threads t
  CROSS JOIN LATERAL (
    SELECT unnest(t.participant_ids) AS other_id
  ) x
  WHERE t.company_id = p_company_id
    AND t.type_raw = 'direct'
    AND p_my_employee_id = ANY(t.participant_ids)
    AND other_id <> p_my_employee_id
    AND cardinality(t.participant_ids) = 2;
END;
$$;
-- employee_get_incident
create or replace function public.employee_get_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_row
  from public.incident_reports
  where id = p_incident_id and company_id = p_company_id;

  if v_row.id is null then
    raise exception 'NOT_FOUND';
  end if;

  return row_to_json(v_row);
end;
$$;
-- employee_get_incident_comments
create or replace function public.employee_get_incident_comments(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.incident_comments
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select c.*
  from public.incident_comments c
  where c.company_id = p_company_id
    and c.incident_id = p_incident_id
    and public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id)
  order by c.created_at asc;
END;
$$;
-- employee_get_incident_status_history
create or replace function public.employee_get_incident_status_history(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.incident_status_history
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select h.*
  from public.incident_status_history h
  where h.company_id = p_company_id
    and h.incident_id = p_incident_id
    and public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id)
  order by h.created_at desc;
END;
$$;
-- employee_get_incidents
create or replace function public.employee_get_incidents(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid default null,
  p_include_closed boolean default true,
  p_session_token text DEFAULT NULL)
returns setof public.incident_reports
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select i.*
  from public.incident_reports i
  where i.company_id = p_company_id
    and public._employee_valid(p_company_id, p_employee_id)
    and (p_job_id is null or i.job_id = p_job_id)
    and (p_include_closed or i.status not in ('closed', 'resolved'))
    and (
      i.employee_id = p_employee_id
      or i.assignee_id = p_employee_id
      or (
        i.job_id is not null
        and public._employee_assigned_to_job(p_company_id, p_employee_id, i.job_id)
      )
    )
  order by i.created_at desc
  limit 200;
END;
$$;
-- employee_get_inventory_items
CREATE OR REPLACE FUNCTION public.employee_get_inventory_items(
  p_company_id uuid,
  p_employee_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.inventory_items
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT i.*
  FROM public.inventory_items i
  WHERE i.company_id = p_company_id
  ORDER BY i.name;
END;
$$;
-- employee_get_inventory_usage_for_job
CREATE OR REPLACE FUNCTION public.employee_get_inventory_usage_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.inventory_usage
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT u.*
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND (p_employee_id IS NULL OR u.employee_id = p_employee_id);
END;
$$;
-- employee_get_job_card_for_employee
CREATE OR REPLACE FUNCTION public.employee_get_job_card_for_employee(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT row_to_json(jc)
  FROM public.job_cards jc
  JOIN public.jobs j ON j.id = jc.job_id AND j.company_id = jc.company_id
  WHERE jc.company_id = p_company_id
    AND jc.job_id = p_job_id
    AND public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id));
END;
$$;
-- employee_get_job_card_for_job
CREATE OR REPLACE FUNCTION public.employee_get_job_card_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT public.employee_get_job_card_for_employee(
    p_company_id, p_job_id, p_employee_id
  , p_session_token));
END;
$$;
-- employee_get_job_documents
create or replace function public.employee_get_job_documents(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.job_documents
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select d.*
  from public.job_documents d
  where d.company_id = p_company_id
    and d.job_id = p_job_id
    and public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id)
  order by d.created_at desc;
END;
$$;
-- employee_get_job_feedback
create or replace function public.employee_get_job_feedback(
  p_company_id  uuid,
  p_employee_id uuid,
  p_job_id      uuid,
  p_session_token text DEFAULT NULL)
returns setof public.job_feedback
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select f.*
  from public.job_feedback f
  where f.company_id = p_company_id
    and f.job_id = p_job_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by f.submitted_at desc;
END;
$$;
-- employee_get_job_for_employee
CREATE OR REPLACE FUNCTION public.employee_get_job_for_employee(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT j.*
  FROM public.jobs j
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR (
        j.contractor_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.contractor_member_links cml
          WHERE cml.company_id = p_company_id
            AND cml.employee_id = p_employee_id
            AND cml.contractor_id = j.contractor_id
        )
      )
    )
  LIMIT 1;
END;
$$;
-- employee_get_job_photo_urls
CREATE OR REPLACE FUNCTION public.employee_get_job_photo_urls(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT json_build_object(
    'photo_urls_before', coalesce(j.photo_urls_before, '{}'::text[]),
    'photo_urls_after', coalesce(j.photo_urls_after, '{}'::text[])
  )
  FROM public.employee_get_job_for_employee(p_company_id, p_employee_id, p_job_id, p_session_token) j
  LIMIT 1);
END;
$$;
-- employee_get_job_thread
create or replace function public.employee_get_job_thread(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_tid uuid;
  v_row public.message_threads%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  v_tid := public.ensure_job_team_message_thread(p_company_id, p_job_id);

  select * into v_row from public.message_threads where id = v_tid;
  return row_to_json(v_row);
end;
$$;
-- employee_get_jobs_for_employee
create or replace function public.employee_get_jobs_for_employee(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.jobs
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select j.*
  from public.jobs j
  where j.company_id = p_company_id
    and (
      j.created_by_employee_id = p_employee_id
      or j.assigned_employee_ids @> array[p_employee_id]
      or j.assignee_employee_id = p_employee_id
      or j.contractor_employee_id = p_employee_id
      or (
        j.contractor_id is not null
        and exists (
          select 1
          from public.contractor_member_links cml
          where cml.company_id = p_company_id
            and cml.employee_id = p_employee_id
            and cml.contractor_id = j.contractor_id
        )
      )
    )
  order by j.created_at desc;
END;
$$;
-- employee_get_leave_requests
create or replace function public.employee_get_leave_requests(
    p_company_id  uuid,
    p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_emp public.employees%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    select * into v_emp
    from public.employees
    where id = p_employee_id
      and company_id = p_company_id
      and is_active = true;

    if not found then
        raise exception 'Employee not found in company';
    end if;

    return (
        select coalesce(
            json_agg(row_to_json(r) order by r.created_at desc),
            '[]'::json
        )
        from public.leave_requests r
        where r.employee_id = p_employee_id
          and r.company_id  = p_company_id
    );
end;
$$;
-- employee_get_linked_contractors
create or replace function public.employee_get_linked_contractors(
  p_company_id  uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.contractors
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select distinct c.*
  from public.contractors c
  inner join public.contractor_member_links l
    on l.contractor_id = c.id
   and l.company_id = c.company_id
  where c.company_id = p_company_id
    and l.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by c.name;
END;
$$;
-- employee_get_message_threads_for_worker
CREATE OR REPLACE FUNCTION public.employee_get_message_threads_for_worker(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.message_threads
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT t.*
  FROM public.message_threads t
  WHERE t.company_id = p_company_id
    AND p_employee_id = ANY(t.participant_ids)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY coalesce(t.last_message_at, t.created_at) DESC;
END;
$$;
-- employee_get_my_notifications_for_employee
CREATE OR REPLACE FUNCTION public.employee_get_my_notifications_for_employee(p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);

  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RETURN '[]'::json;
  END IF;

  RETURN (
    SELECT coalesce(json_agg(row_to_json(n) ORDER BY n.created_at DESC), '[]'::json)
    FROM (
      SELECT
        id, company_id, type, title, body, ref_type, ref_id,
        data, is_read, read_at, created_at
      FROM public.app_notifications
      WHERE audience IN ('employee', 'all')
        AND (
          recipient_employee_id = p_employee_id
          OR recipient_auth_user_id IN (
            SELECT user_id FROM public.employees WHERE id = p_employee_id AND user_id IS NOT NULL
          )
        )
      ORDER BY created_at DESC
      LIMIT 50
    ) n
  );
END;
$$;
-- employee_get_or_create_direct_thread_peer
CREATE OR REPLACE FUNCTION public.employee_get_or_create_direct_thread_peer(
  p_company_id uuid,
  p_creator_id uuid,
  p_peer_id uuid,
  p_title text,
  p_session_token text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE v_tid uuid;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_creator_id, p_session_token);

  IF p_creator_id = p_peer_id THEN RAISE EXCEPTION 'invalid peers'; END IF;
  IF NOT public._employee_valid(p_company_id, p_creator_id)
     OR NOT public._employee_valid(p_company_id, p_peer_id) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;
  v_tid := public.employee_find_direct_thread_peer(p_company_id, p_creator_id, p_peer_id);
  IF v_tid IS NOT NULL THEN RETURN v_tid; END IF;
  INSERT INTO public.message_threads (company_id, subject, type_raw, participant_ids)
  VALUES (
    p_company_id,
    trim(coalesce(nullif(trim(p_title), ''), 'Direct chat')),
    'direct',
    ARRAY[p_creator_id, p_peer_id]
  )
  RETURNING id INTO v_tid;
  RETURN v_tid;
END;
$$;
-- employee_get_own_incidents
create or replace function public.employee_get_own_incidents(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.incident_reports
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select i.*
  from public.incident_reports i
  where i.company_id = p_company_id
    and i.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id)
  order by i.created_at desc
  limit 200;
END;
$$;
-- employee_get_pa_settings
CREATE OR REPLACE FUNCTION public.employee_get_pa_settings(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.employee_pa_settings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT s.*
  FROM public.employee_pa_settings s
  WHERE s.company_id = p_company_id
    AND s.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
END;
$$;
-- employee_get_pa_tasks
CREATE OR REPLACE FUNCTION public.employee_get_pa_tasks(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.pa_tasks
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT t.*
  FROM public.pa_tasks t
  WHERE t.company_id = p_company_id
    AND (
      t.owner_employee_id = p_employee_id
      OR t.assigned_employee_id = p_employee_id
    )
  ORDER BY t.created_at DESC;
END;
$$;
-- employee_get_thread_messages_for_worker
CREATE OR REPLACE FUNCTION public.employee_get_thread_messages_for_worker(
  p_company_id uuid,
  p_thread_id uuid,
  p_employee_id uuid,
  p_limit integer DEFAULT 200,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.app_messages
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT m.*
  FROM public.app_messages m
  INNER JOIN public.message_threads t ON t.id = m.thread_id AND t.company_id = m.company_id
  WHERE m.company_id = p_company_id
    AND m.thread_id = p_thread_id
    AND p_employee_id = ANY(t.participant_ids)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
END;
$$;
-- employee_get_work_teams
CREATE OR REPLACE FUNCTION public.employee_get_work_teams(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.work_teams
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT wt.*
  FROM public.work_teams wt
  WHERE wt.company_id = p_company_id
    AND wt.member_ids @> ARRAY[p_employee_id]
    AND EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = p_employee_id AND e.company_id = p_company_id
    );
END;
$$;
-- employee_get_workflow_form_submissions
create or replace function public.employee_get_workflow_form_submissions(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_template_id  uuid default null,
  p_session_token text DEFAULT NULL)
returns setof public.workflow_form_submissions
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select s.*
  from public.workflow_form_submissions s
  where s.company_id = p_company_id
    and s.submitted_by = p_employee_id
    and (p_template_id is null or s.template_id = p_template_id)
    and public._employee_valid(p_company_id, p_employee_id)
  order by s.submitted_at desc;
END;
$$;
-- employee_get_workflow_form_templates
create or replace function public.employee_get_workflow_form_templates(
  p_company_id  uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
returns setof public.workflow_form_templates
LANGUAGE plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  select t.*
  from public.workflow_form_templates t
  where t.company_id = p_company_id
    and coalesce(t.is_active, true)
    and public._employee_valid(p_company_id, p_employee_id)
  order by t.name;
END;
$$;
-- employee_insert_checklist_item
create or replace function public.employee_insert_checklist_item(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_description text,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_checklist_items%rowtype;
  v_sort int;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  select coalesce(max(c.sort_order), -1) + 1 into v_sort
  from public.job_checklist_items c
  where c.company_id = p_company_id and c.job_id = p_job_id;

  insert into public.job_checklist_items (
    company_id, job_id, description, is_checked, sort_order
  ) values (
    p_company_id, p_job_id, trim(p_description), false, v_sort
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
-- employee_insert_incident
create or replace function public.employee_insert_incident(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_description      text,
  p_severity         text default 'low',
  p_job_id           uuid default null,
  p_site_id          uuid default null,
  p_assignee_id      uuid default null,
  p_photo_urls       text[] default '{}',
  p_reported_by_name text default null,
  p_title            text default null,
  p_category         text default 'general',
  p_occurred_at      timestamptz default null,
  p_latitude         double precision default null,
  p_longitude        double precision default null,
  p_location_text    text default null,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
  v_title text;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_description, '')) = '' then
    raise exception 'DESCRIPTION_REQUIRED';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if p_job_id is not null
     and not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  if p_assignee_id is not null and not public._employee_valid(p_company_id, p_assignee_id) then
    raise exception 'invalid assignee';
  end if;

  v_title := nullif(trim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := left(trim(p_description), 80);
  end if;

  insert into public.incident_reports (
    company_id, employee_id, job_id, site_id, title, description, severity, category,
    status, photo_urls, assignee_id, reported_by_name, is_closed,
    occurred_at, latitude, longitude, location_text, created_at, updated_at
  ) values (
    p_company_id, p_employee_id, p_job_id, p_site_id, v_title, trim(p_description),
    coalesce(nullif(trim(p_severity), ''), 'low'),
    coalesce(nullif(trim(p_category), ''), 'general'),
    'open',
    coalesce(p_photo_urls, '{}'), p_assignee_id,
    nullif(trim(coalesce(p_reported_by_name, '')), ''),
    false,
    coalesce(p_occurred_at, now()),
    p_latitude, p_longitude,
    nullif(trim(coalesce(p_location_text, '')), ''),
    now(), now()
  )
  returning * into v_row;

  insert into public.incident_status_history (
    company_id, incident_id, changed_by_employee_id, old_status, new_status, notes
  ) values (
    p_company_id, v_row.id, p_employee_id, null, 'open', 'Incident reported'
  );

  return row_to_json(v_row);
end;
$$;
-- employee_insert_job_document
create or replace function public.employee_insert_job_document(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_document_name text,
  p_document_type text,
  p_file_url text,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_documents%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_document_name, '')) = '' or trim(coalesce(p_file_url, '')) = '' then
    raise exception 'DOCUMENT_REQUIRED';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_documents (
    company_id, job_id, document_name, document_type, file_url, created_at
  ) values (
    p_company_id, p_job_id, trim(p_document_name),
    coalesce(nullif(trim(p_document_type), ''), 'other'),
    trim(p_file_url), now()
  )
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
-- employee_insert_pa_task
CREATE OR REPLACE FUNCTION public.employee_insert_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_title text,
  p_notes text DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_priority text DEFAULT 'medium',
  p_due_at timestamptz DEFAULT NULL,
  p_remind_at timestamptz DEFAULT NULL,
  p_linked_type text DEFAULT 'none',
  p_linked_id text DEFAULT NULL,
  p_linked_label text DEFAULT NULL,
  p_recurrence_pattern text DEFAULT 'none',
  p_meeting_with text DEFAULT NULL,
  p_meeting_at timestamptz DEFAULT NULL,
  p_meeting_minutes text DEFAULT NULL,
  p_meeting_follow_up text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
  v_due timestamptz := coalesce(p_due_at, CASE WHEN p_due_date IS NOT NULL
    THEN (p_due_date::timestamp AT TIME ZONE 'UTC') + interval '9 hours' ELSE NULL END);
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  INSERT INTO public.pa_tasks (
    company_id, title, description, notes, due_date, due_at, remind_at,
    priority, status, linked_type, linked_id, linked_label, recurrence_pattern,
    meeting_with, meeting_at, meeting_minutes, meeting_follow_up,
    assigned_employee_id, owner_employee_id, updated_at
  ) VALUES (
    p_company_id, trim(p_title), nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''), p_due_date, v_due, p_remind_at,
    coalesce(nullif(trim(p_priority), ''), 'medium'), 'todo',
    coalesce(nullif(trim(p_linked_type), ''), 'none'),
    nullif(trim(coalesce(p_linked_id, '')), ''),
    nullif(trim(coalesce(p_linked_label, '')), ''),
    coalesce(nullif(trim(p_recurrence_pattern), ''), 'none'),
    nullif(trim(coalesce(p_meeting_with, '')), ''),
    p_meeting_at,
    nullif(trim(coalesce(p_meeting_minutes, '')), ''),
    nullif(trim(coalesce(p_meeting_follow_up, '')), ''),
    p_employee_id, p_employee_id, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
-- employee_insert_punch
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
    p_idempotency_key uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_punch time_punches;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

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
-- employee_job_site_open_visit
CREATE OR REPLACE FUNCTION public.employee_job_site_open_visit(
  p_company_id  uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT row_to_json(v)
  FROM public.job_site_visits v
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1);
END;
$$;
-- employee_job_site_sign_in
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_in(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open public.job_site_visits%ROWTYPE;
  v_row  public.job_site_visits%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  SELECT * INTO v_open
  FROM public.job_site_visits v
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  ORDER BY v.sign_in_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_open.job_id = p_job_id THEN
      RETURN row_to_json(v_open);
    END IF;
    RAISE EXCEPTION 'ALREADY_ON_SITE';
  END IF;

  INSERT INTO public.job_site_visits (
    company_id, job_id, party_type, employee_id,
    sign_in_at, sign_in_latitude, sign_in_longitude, sign_in_address,
    reported_by_name, notes
  ) VALUES (
    p_company_id, p_job_id, 'employee', p_employee_id,
    now(), p_latitude, p_longitude, p_address,
    p_reported_by_name, p_notes
  )
  RETURNING * INTO v_row;

  RETURN row_to_json(v_row);
END;
$$;
-- employee_job_site_sign_out
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_out(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      sign_out_latitude = p_latitude,
      sign_out_longitude = p_longitude,
      sign_out_address = p_address,
      notes = coalesce(p_notes, v.notes)
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.job_id = p_job_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
-- employee_job_site_sign_out_open_visit
CREATE OR REPLACE FUNCTION public.employee_job_site_sign_out_open_visit(
  p_company_id  uuid,
  p_employee_id uuid,
  p_notes       text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_site_visits%ROWTYPE;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      notes = coalesce(p_notes, v.notes)
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_OPEN_VISIT';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;
-- employee_job_site_switch_to_job
CREATE OR REPLACE FUNCTION public.employee_job_site_switch_to_job(
  p_company_id       uuid,
  p_employee_id      uuid,
  p_job_id           uuid,
  p_latitude         double precision DEFAULT NULL,
  p_longitude        double precision DEFAULT NULL,
  p_address          text DEFAULT NULL,
  p_reported_by_name text DEFAULT NULL,
  p_notes            text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  UPDATE public.job_site_visits v
  SET sign_out_at = now(),
      notes = coalesce(v.notes, '') || ' (switched to another job)'
  WHERE v.company_id = p_company_id
    AND v.employee_id = p_employee_id
    AND v.party_type = 'employee'
    AND v.sign_out_at IS NULL
    AND v.job_id IS DISTINCT FROM p_job_id;

  RETURN public.employee_job_site_sign_in(
    p_company_id, p_employee_id, p_job_id,
    p_latitude, p_longitude, p_address, p_reported_by_name, p_notes
  , p_session_token);
END;
$$;
-- employee_list_company_peers
CREATE OR REPLACE FUNCTION public.employee_list_company_peers(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS SETOF public.employees
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT e.*
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.employees self
      WHERE self.id = p_employee_id AND self.company_id = p_company_id
    )
  ORDER BY e.name NULLS LAST, e.surname NULLS LAST;
END;
$$;
-- employee_log_app_event
create or replace function public.employee_log_app_event(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_screen       text,
  p_action       text,
  p_level        text default 'info',
  p_error_text   text default null,
  p_meta         jsonb default null,
  p_user_agent   text default null,
  p_app_version  text default null,
  p_session_token text DEFAULT NULL)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_valid(p_company_id, p_employee_id) then
    return;
  end if;

  insert into public.app_events (
    company_id, auth_user_id, screen, action, level,
    error_text, meta, user_agent, app_version
  ) values (
    p_company_id,
    null,
    coalesce(nullif(trim(p_screen), ''), 'unknown'),
    coalesce(nullif(trim(p_action), ''), 'unknown'),
    case when p_level in ('info', 'warning', 'error') then p_level else 'info' end,
    p_error_text,
    p_meta,
    p_user_agent,
    p_app_version
  );
end;
$$;
-- employee_mark_company_feed_read_for_worker
CREATE OR REPLACE FUNCTION public.employee_mark_company_feed_read_for_worker(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  PERFORM public.employee_mark_thread_read_for_worker(
    p_company_id,
    public._company_feed_thread_id(p_company_id, p_session_token),
    p_employee_id
  );
END;
$$;
-- employee_mark_notification_read_for_employee
CREATE OR REPLACE FUNCTION public.employee_mark_notification_read_for_employee(
  p_employee_id uuid,
  p_notification_id bigint,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);

  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.app_notifications
  SET is_read = true, read_at = now()
  WHERE id = p_notification_id
    AND (
      recipient_employee_id = p_employee_id
      OR recipient_auth_user_id IN (
        SELECT user_id FROM public.employees WHERE id = p_employee_id AND user_id IS NOT NULL
      )
    );
END;
$$;
-- employee_mark_thread_read_for_worker
CREATE OR REPLACE FUNCTION public.employee_mark_thread_read_for_worker(
  p_company_id uuid,
  p_thread_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.message_threads t
    WHERE t.id = p_thread_id AND t.company_id = p_company_id
      AND p_employee_id = ANY(t.participant_ids)
  ) THEN
    RAISE EXCEPTION 'not a thread member';
  END IF;
  UPDATE public.app_messages m
  SET read_by_ids = array(SELECT DISTINCT unnest(m.read_by_ids || p_employee_id))
  WHERE m.company_id = p_company_id
    AND m.thread_id = p_thread_id
    AND m.sender_id <> p_employee_id
    AND NOT (p_employee_id = ANY(m.read_by_ids));
END;
$$;
-- employee_notify_manager_job_created
CREATE OR REPLACE FUNCTION public.employee_notify_manager_job_created(
  p_company_id uuid,
  p_manager_user_id uuid,
  p_job_id uuid,
  p_employee_id uuid,
  p_job_title text,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mgr_employee_id uuid;
  v_employee_name text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF p_manager_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT e.id INTO v_mgr_employee_id
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = p_manager_user_id
    AND e.is_active = true
  LIMIT 1;

  IF v_mgr_employee_id IS NULL THEN
    RETURN;
  END IF;

  SELECT trim(coalesce(e.name, '') || ' ' || coalesce(e.surname, ''))
  INTO v_employee_name
  FROM public.employees e
  WHERE e.id = p_employee_id;

  INSERT INTO public.app_notifications (
    company_id,
    audience,
    recipient_auth_user_id,
    recipient_employee_id,
    type,
    title,
    body,
    ref_type,
    ref_id,
    dedupe_key,
    data
  ) VALUES (
    p_company_id,
    'hr',
    p_manager_user_id,
    v_mgr_employee_id,
    'employee_job_created',
    'New job from ' || coalesce(nullif(v_employee_name, ''), 'employee'),
    coalesce(nullif(trim(p_job_title), ''), 'Job') || ' was added and needs your attention.',
    'job',
    p_job_id::text,
    'employee_job_created:' || p_job_id::text || ':' || v_mgr_employee_id::text,
    jsonb_build_object(
      'job_id', p_job_id,
      'employee_id', p_employee_id,
      'job_title', p_job_title
    )
  );
END;
$$;
-- employee_prepare_media_upload
CREATE OR REPLACE FUNCTION public.employee_prepare_media_upload(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_storage_path  text,
  p_purpose       text DEFAULT 'attachment',
  p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_folder text;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF v_path = '' THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;

  v_folder := split_part(v_path, '/', 1);
  IF v_folder NOT IN (
    'leave_attachments', 'incident_reports', 'job_photos',
    'employee_documents', 'job_documents', 'job_cards'
  ) THEN
    RAISE EXCEPTION 'folder_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    p_company_id, p_employee_id, v_path, coalesce(nullif(trim(p_purpose), ''), 'attachment'),
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = EXCLUDED.employee_id,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', (now() + interval '15 minutes')
  );
END;
$$;
-- employee_report_absence
create or replace function public.employee_report_absence(
    p_company_id  uuid,
    p_employee_id uuid,
    p_date        date,
    p_reason      text,
    p_note        text default null,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_emp    public.employees%rowtype;
    v_result public.daily_absences%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    -- Validate employee belongs to company
    select * into v_emp
    from public.employees
    where id = p_employee_id and company_id = p_company_id and is_active = true;

    if not found then
        raise exception 'Employee not found in company';
    end if;

    -- Upsert: one absence record per employee per day
    insert into public.daily_absences (company_id, employee_id, date, reason, note)
    values (p_company_id, p_employee_id, p_date, p_reason, p_note)
    on conflict (employee_id, date)
    do update set
        reason = excluded.reason,
        note   = excluded.note
    returning * into v_result;

    return row_to_json(v_result);
end;
$$;
-- employee_send_company_feed_message
CREATE OR REPLACE FUNCTION public.employee_send_company_feed_message(
  p_company_id uuid,
  p_sender_employee_id uuid,
  p_body text,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE v_thread uuid;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);

  IF trim(coalesce(p_body, '')) = '' OR NOT public._employee_valid(p_company_id, p_sender_employee_id) THEN
    RETURN;
  END IF;
  v_thread := public._company_feed_thread_id(p_company_id);
  INSERT INTO public.app_messages (company_id, thread_id, sender_id, body)
  VALUES (p_company_id, v_thread, p_sender_employee_id, trim(p_body));
  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = v_thread;
END;
$$;
-- employee_send_thread_message
CREATE OR REPLACE FUNCTION public.employee_send_thread_message(
  p_company_id uuid,
  p_thread_id uuid,
  p_sender_employee_id uuid,
  p_body text,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_sender_employee_id, p_session_token);

  IF trim(coalesce(p_body, '')) = '' THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.message_threads t
    WHERE t.id = p_thread_id AND t.company_id = p_company_id
      AND p_sender_employee_id = ANY(t.participant_ids)
  ) THEN
    RAISE EXCEPTION 'not a thread member';
  END IF;
  INSERT INTO public.app_messages (company_id, thread_id, sender_id, body)
  VALUES (p_company_id, p_thread_id, p_sender_employee_id, trim(p_body));
  UPDATE public.message_threads
  SET last_message_at = now(),
      last_message_preview = left(trim(p_body), 120)
  WHERE id = p_thread_id;
END;
$$;
-- employee_set_inventory_usage_for_job
CREATE OR REPLACE FUNCTION public.employee_set_inventory_usage_for_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_usages jsonb,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'Not allowed to set usage for this job';
  END IF;

  -- Prior usage for this (job, employee), aggregated per item.
  CREATE TEMPORARY TABLE _old_usage ON COMMIT DROP AS
  SELECT u.inventory_item_id, sum(u.quantity_used) AS qty
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id
  GROUP BY u.inventory_item_id;

  -- Desired new usage from the client payload.
  CREATE TEMPORARY TABLE _new_usage ON COMMIT DROP AS
  SELECT (x.inventory_item_id)::uuid AS inventory_item_id,
         coalesce((x.quantity)::numeric, 0) AS qty
  FROM jsonb_to_recordset(coalesce(p_usages, '[]'::jsonb)) AS x(
    inventory_item_id text,
    quantity text
  )
  WHERE coalesce((x.quantity)::numeric, 0) > 0;

  -- Lock every affected item row up-front to serialise concurrent edits and
  -- prevent read-modify-write races / negative stock under concurrency.
  PERFORM 1
  FROM public.inventory_items i
  WHERE i.company_id = p_company_id
    AND i.id IN (
      SELECT inventory_item_id FROM _new_usage
      UNION
      SELECT inventory_item_id FROM _old_usage
    )
  FOR UPDATE;

  -- Apply the per-item delta (new − old) against quantity_on_hand.
  FOR r IN
    SELECT coalesce(n.inventory_item_id, o.inventory_item_id) AS inventory_item_id,
           coalesce(n.qty, 0) - coalesce(o.qty, 0) AS delta
    FROM _new_usage n
    FULL OUTER JOIN _old_usage o ON o.inventory_item_id = n.inventory_item_id
  LOOP
    IF r.delta > 0 THEN
      UPDATE public.inventory_items i
      SET quantity_on_hand = i.quantity_on_hand - r.delta
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id
        AND i.quantity_on_hand >= r.delta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for item %', r.inventory_item_id
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF r.delta < 0 THEN
      UPDATE public.inventory_items i
      SET quantity_on_hand = i.quantity_on_hand + abs(r.delta)
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id;
    END IF;
  END LOOP;

  -- Replace this (job, employee)'s usage rows with the new set. Because this all
  -- runs inside one function (one transaction), any RAISE above rolls the whole
  -- operation back — no partial stock/usage state can be committed.
  DELETE FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id;

  INSERT INTO public.inventory_usage (
    company_id, job_id, inventory_item_id, quantity_used, employee_id, used_at
  )
  SELECT p_company_id, p_job_id, n.inventory_item_id, n.qty, p_employee_id, now()
  FROM _new_usage n;
END;
$$;
-- employee_set_open_punch_job
CREATE OR REPLACE FUNCTION public.employee_set_open_punch_job(
  p_company_id bigint,
  p_employee_id bigint,
  p_job_id bigint,
  p_work_date date,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id bigint;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF p_job_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.jobs j
    WHERE j.id = p_job_id
      AND j.company_id = p_company_id
      AND (
        j.assignee_employee_id IS NOT DISTINCT FROM p_employee_id
        OR j.contractor_employee_id IS NOT DISTINCT FROM p_employee_id
        OR j.assigned_employee_ids @> ARRAY[p_employee_id]
      )
  ) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  SELECT p2.id INTO v_row_id
  FROM public.punches p2
  WHERE p2.company_id = p_company_id
    AND p2.employees_id = p_employee_id
    AND p2."Date" = p_work_date
    AND p2.sign_out IS NULL
  ORDER BY p2.id DESC
  LIMIT 1;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'NO_OPEN_PUNCH_SESSION';
  END IF;

  UPDATE public.punches p
  SET job_id = p_job_id
  WHERE p.id = v_row_id;
END;
$$;
-- employee_submit_job_feedback
create or replace function public.employee_submit_job_feedback(
  p_company_id  uuid,
  p_employee_id uuid,
  p_job_id      uuid,
  p_rating      int,
  p_comments    text default null,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_feedback%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_RATING';
  end if;

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_feedback (company_id, job_id, employee_id, rating, comments)
  values (p_company_id, p_job_id, p_employee_id, p_rating, nullif(trim(coalesce(p_comments, '')), ''))
  on conflict (job_id, employee_id)
  do update set
    rating = excluded.rating,
    comments = excluded.comments,
    submitted_at = now()
  returning * into v_row;

  return row_to_json(v_row);
end;
$$;
-- employee_submit_leave_request
CREATE OR REPLACE FUNCTION public.employee_submit_leave_request(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_leave_type    text,
  p_start_date    date,
  p_end_date      date,
  p_total_days    float,
  p_reason        text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_result json;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  -- Validate employee belongs to company
  IF NOT EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = p_employee_id
      AND company_id = p_company_id
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'employee_not_found';
  END IF;

  -- Validate dates
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  -- Insert leave request
  INSERT INTO public.leave_requests (
    id, company_id, employee_id, leave_type,
    start_date, end_date, total_days,
    reason, attachment_url, status, created_at
  )
  VALUES (
    gen_random_uuid(), p_company_id, p_employee_id, p_leave_type,
    p_start_date, p_end_date, p_total_days,
    p_reason, p_attachment_url, 'pending', now()
  )
  RETURNING id INTO v_id;

  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT id, company_id, employee_id, leave_type,
           start_date, end_date, total_days,
           reason, attachment_url, status,
           decision_note, approver_hr_user_id, decided_at,
           created_at
    FROM public.leave_requests
    WHERE id = v_id
  ) r;

  RETURN v_result;
END;
$$;
-- employee_submit_workflow_form
create or replace function public.employee_submit_workflow_form(
  p_company_id   uuid,
  p_employee_id  uuid,
  p_template_id  uuid,
  p_data         jsonb,
  p_job_id       uuid default null,
  p_site_id      uuid default null,
  p_session_token text DEFAULT NULL)
returns public.workflow_form_submissions
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.workflow_form_submissions;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_valid(p_company_id, p_employee_id) then
    raise exception 'invalid employee';
  end if;

  if not exists (
    select 1 from public.workflow_form_templates t
    where t.id = p_template_id and t.company_id = p_company_id and coalesce(t.is_active, true)
  ) then
    raise exception 'template not found';
  end if;

  insert into public.workflow_form_submissions (
    company_id, template_id, submitted_by, job_id, site_id, data, submitted_at
  ) values (
    p_company_id, p_template_id, p_employee_id, p_job_id, p_site_id,
    coalesce(p_data, '{}'::jsonb), now()
  )
  returning * into v_row;

  return v_row;
end;
$$;
-- employee_update_calendar_event_attendance
create or replace function public.employee_update_calendar_event_attendance(
  p_company_id  uuid,
  p_employee_id uuid,
  p_event_id    uuid,
  p_response    text,
  p_session_token text DEFAULT NULL)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if p_response not in ('accepted', 'declined', 'pending') then
    raise exception 'invalid attendance response';
  end if;

  update public.calendar_events e
  set attendance_responses =
    coalesce(e.attendance_responses, '{}'::jsonb)
    || jsonb_build_object(p_employee_id::text, p_response)
  where e.id = p_event_id
    and e.company_id = p_company_id
    and p_employee_id = any(e.attendee_ids)
    and public._employee_valid(p_company_id, p_employee_id);

  if not found then
    raise exception 'event not found or not an attendee';
  end if;
end;
$$;
-- employee_update_checklist_item
CREATE OR REPLACE FUNCTION public.employee_update_checklist_item(
  p_company_id uuid,
  p_employee_id uuid,
  p_item_id uuid,
  p_is_checked boolean,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_job_id uuid;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  SELECT c.job_id INTO v_job_id
  FROM public.job_checklist_items c
  WHERE c.id = p_item_id AND c.company_id = p_company_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'CHECKLIST_ITEM_NOT_FOUND';
  END IF;

  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, v_job_id) THEN
    RAISE EXCEPTION 'NOT_ASSIGNED_TO_JOB';
  END IF;

  UPDATE public.job_checklist_items
  SET is_checked = p_is_checked
  WHERE id = p_item_id AND company_id = p_company_id;
END;
$$;
-- employee_update_document
CREATE OR REPLACE FUNCTION public.employee_update_document(
  p_document_id   uuid,
  p_company_id    uuid,
  p_employee_id   uuid,
  p_document_type text,
  p_document_name text,
  p_file_url      text,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.employee_documents%rowtype;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  PERFORM 1 FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  UPDATE public.employee_documents
  SET document_type    = p_document_type,
      document_name    = p_document_name,
      file_url         = p_file_url,
      uploaded_by_role = 'employee'
  WHERE id = p_document_id
    AND employee_id = p_employee_id
    AND company_id = p_company_id
  RETURNING * INTO v_doc;

  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  RETURN row_to_json(v_doc);
END;
$$;
-- employee_update_incident
create or replace function public.employee_update_incident(
  p_company_id uuid,
  p_employee_id uuid,
  p_incident_id uuid,
  p_status text default null,
  p_resolution_notes text default null,
  p_assignee_id uuid default null,
  p_clear_assignee boolean default false,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.incident_reports%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_can_view_incident(p_company_id, p_employee_id, p_incident_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_status is not null then
    if not public._employee_can_manage_incident(p_company_id, p_employee_id, p_incident_id) then
      raise exception 'FORBIDDEN_STATUS';
    end if;
    perform public._incident_apply_status(
      p_incident_id, p_status, p_employee_id, p_resolution_notes
    );
  elsif p_resolution_notes is not null then
    update public.incident_reports
    set resolution_notes = p_resolution_notes, updated_at = now()
    where id = p_incident_id;
  end if;

  if p_clear_assignee or p_assignee_id is not null then
    if not public._employee_can_manage_incident(p_company_id, p_employee_id, p_incident_id) then
      raise exception 'FORBIDDEN_ASSIGN';
    end if;
  end if;

  if p_assignee_id is not null and not public._employee_valid(p_company_id, p_assignee_id) then
    raise exception 'invalid assignee';
  end if;

  if p_clear_assignee then
    update public.incident_reports set assignee_id = null, updated_at = now()
    where id = p_incident_id;
  elsif p_assignee_id is not null then
    update public.incident_reports set assignee_id = p_assignee_id, updated_at = now()
    where id = p_incident_id;
  end if;

  select * into v_row from public.incident_reports where id = p_incident_id;
  return row_to_json(v_row);
end;
$$;
-- employee_update_job_status
CREATE OR REPLACE FUNCTION public.employee_update_job_status(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_status text,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF p_status NOT IN ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid job status';
  END IF;

  UPDATE public.jobs j
  SET status = p_status,
      updated_at = now()
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not allowed to update this job';
  END IF;
END;
$$;
-- employee_update_leave_request
CREATE OR REPLACE FUNCTION public.employee_update_leave_request(
  p_id             uuid,
  p_employee_id    uuid,
  p_leave_type     text,
  p_start_date     date,
  p_end_date       date,
  p_total_days     float,
  p_reason         text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
BEGIN
  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);

  -- Only allow edits on pending rows that belong to this employee
  IF NOT EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE id = p_id
      AND employee_id = p_employee_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'leave_request_not_editable';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  UPDATE public.leave_requests
  SET
    leave_type     = p_leave_type,
    start_date     = p_start_date,
    end_date       = p_end_date,
    total_days     = p_total_days,
    reason         = p_reason,
    attachment_url = p_attachment_url
  WHERE id = p_id;

  SELECT row_to_json(r) INTO v_result
  FROM (
    SELECT id, company_id, employee_id, leave_type,
           start_date, end_date, total_days,
           reason, attachment_url, status,
           decision_note, approver_hr_user_id, decided_at,
           created_at
    FROM public.leave_requests
    WHERE id = p_id
  ) r;

  RETURN v_result;
END;
$$;
-- employee_update_pa_task
CREATE OR REPLACE FUNCTION public.employee_update_pa_task(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  IF NOT EXISTS (
    SELECT 1 FROM public.pa_tasks t
    WHERE t.id = p_task_id
      AND t.company_id = p_company_id
      AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id)
  ) THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks t SET
    title = CASE WHEN p_patch ? 'title' THEN trim(p_patch->>'title') ELSE t.title END,
    notes = CASE
      WHEN p_patch ? 'notes' THEN NULLIF(trim(COALESCE(p_patch->>'notes', '')), '')
      ELSE t.notes
    END,
    description = CASE
      WHEN p_patch ? 'description' THEN NULLIF(trim(COALESCE(p_patch->>'description', '')), '')
      ELSE t.description
    END,
    priority = CASE WHEN p_patch ? 'priority' THEN trim(p_patch->>'priority') ELSE t.priority END,
    status = CASE WHEN p_patch ? 'status' THEN trim(p_patch->>'status') ELSE t.status END,
    due_date = CASE
      WHEN NOT (p_patch ? 'due_date') THEN t.due_date
      WHEN NULLIF(trim(COALESCE(p_patch->>'due_date', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'due_date')::date
    END,
    due_at = CASE
      WHEN NOT (p_patch ? 'due_at') THEN t.due_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'due_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'due_at')::timestamptz
    END,
    remind_at = CASE
      WHEN NOT (p_patch ? 'remind_at') THEN t.remind_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'remind_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'remind_at')::timestamptz
    END,
    snoozed_until = CASE
      WHEN NOT (p_patch ? 'snoozed_until') THEN t.snoozed_until
      WHEN NULLIF(trim(COALESCE(p_patch->>'snoozed_until', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'snoozed_until')::timestamptz
    END,
    linked_type = CASE WHEN p_patch ? 'linked_type' THEN trim(p_patch->>'linked_type') ELSE t.linked_type END,
    linked_id = CASE
      WHEN NOT (p_patch ? 'linked_id') THEN t.linked_id
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_id', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_id')
    END,
    linked_label = CASE
      WHEN NOT (p_patch ? 'linked_label') THEN t.linked_label
      WHEN NULLIF(trim(COALESCE(p_patch->>'linked_label', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'linked_label')
    END,
    recurrence_pattern = CASE WHEN p_patch ? 'recurrence_pattern' THEN trim(p_patch->>'recurrence_pattern') ELSE t.recurrence_pattern END,
    meeting_with = CASE
      WHEN NOT (p_patch ? 'meeting_with') THEN t.meeting_with
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_with', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_with')
    END,
    meeting_at = CASE
      WHEN NOT (p_patch ? 'meeting_at') THEN t.meeting_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'meeting_at')::timestamptz
    END,
    meeting_minutes = CASE
      WHEN NOT (p_patch ? 'meeting_minutes') THEN t.meeting_minutes
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_minutes', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_minutes')
    END,
    meeting_follow_up = CASE
      WHEN NOT (p_patch ? 'meeting_follow_up') THEN t.meeting_follow_up
      WHEN NULLIF(trim(COALESCE(p_patch->>'meeting_follow_up', '')), '') IS NULL THEN NULL
      ELSE trim(p_patch->>'meeting_follow_up')
    END,
    completed_at = CASE
      WHEN NOT (p_patch ? 'completed_at') THEN t.completed_at
      WHEN NULLIF(trim(COALESCE(p_patch->>'completed_at', '')), '') IS NULL THEN NULL
      ELSE (p_patch->>'completed_at')::timestamptz
    END,
    updated_at = now()
  WHERE t.id = p_task_id;
END;
$$;
-- employee_update_pa_task_status
CREATE OR REPLACE FUNCTION public.employee_update_pa_task_status(
  p_company_id uuid,
  p_employee_id uuid,
  p_task_id uuid,
  p_status text,
  p_snoozed_until timestamptz DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.pa_tasks%ROWTYPE;
  recurrence text;
  next_due timestamptz;
  base_due timestamptz;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  SELECT * INTO rec FROM public.pa_tasks t
  WHERE t.id = p_task_id
    AND t.company_id = p_company_id
    AND (t.owner_employee_id = p_employee_id OR t.assigned_employee_id = p_employee_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;

  UPDATE public.pa_tasks SET
    status = p_status,
    snoozed_until = p_snoozed_until,
    completed_at = CASE WHEN p_status IN ('done', 'completed') THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id;

  recurrence := COALESCE(rec.recurrence_pattern, 'none');

  IF p_status IN ('done', 'completed') AND recurrence <> 'none' THEN
    base_due := COALESCE(rec.due_at, now());
    next_due := CASE recurrence
      WHEN 'daily' THEN base_due + interval '1 day'
      WHEN 'weekly' THEN base_due + interval '7 days'
      WHEN 'monthly' THEN base_due + interval '1 month'
      ELSE base_due + interval '1 day'
    END;

    INSERT INTO public.pa_tasks (
      company_id, title, description, notes, due_at, priority, status,
      linked_type, linked_id, linked_label, recurrence_pattern,
      assigned_employee_id, owner_employee_id, updated_at
    ) VALUES (
      rec.company_id, rec.title, rec.description, rec.notes, next_due,
      COALESCE(rec.priority, 'medium'), 'todo',
      COALESCE(rec.linked_type, 'none'), rec.linked_id, rec.linked_label, recurrence,
      p_employee_id, p_employee_id, now()
    );
  END IF;
END;
$$;
-- employee_update_profile
CREATE OR REPLACE FUNCTION public.employee_update_profile(
    p_employee_id uuid,
    p_company_id uuid,
    p_first_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_id_number text DEFAULT NULL,
    p_bank_account text DEFAULT NULL,
    p_bank_name text DEFAULT NULL,
    p_bank_branch_code text DEFAULT NULL,
  p_session_token text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old employees%rowtype;
    v_emp employees%rowtype;
    v_bank_changed boolean := false;
    v_name text;
    r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

    SELECT * INTO v_old
    FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;

    v_bank_changed := (
        (p_bank_account IS NOT NULL AND p_bank_account IS DISTINCT FROM v_old.bank_account)
        OR (p_bank_name IS NOT NULL AND p_bank_name IS DISTINCT FROM v_old.bank_name)
        OR (p_bank_branch_code IS NOT NULL AND p_bank_branch_code IS DISTINCT FROM v_old.bank_branch_code)
    );

    UPDATE employees SET
        name            = coalesce(p_first_name,     name),
        surname         = coalesce(p_last_name,      surname),
        phone           = coalesce(p_phone,          phone),
        id_number       = coalesce(p_id_number,      id_number),
        bank_account    = coalesce(p_bank_account,   bank_account),
        bank_name       = coalesce(p_bank_name,      bank_name),
        bank_branch_code = coalesce(p_bank_branch_code, bank_branch_code),
        bank_details_updated_at = CASE WHEN v_bank_changed THEN now() ELSE bank_details_updated_at END,
        bank_details_updated_by = CASE WHEN v_bank_changed THEN 'employee' ELSE bank_details_updated_by END
    WHERE id = p_employee_id
    RETURNING * INTO v_emp;

    IF v_bank_changed THEN
        v_name := trim(coalesce(v_emp.name, '') || ' ' || coalesce(v_emp.surname, ''));

        FOR r IN
            SELECT DISTINCT hr.user_id AS auth_user_id
            FROM employees hr
            WHERE hr.company_id = p_company_id
              AND hr.user_id IS NOT NULL
              AND hr.is_active = true
              AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'hr')
              AND hr.id <> p_employee_id
        LOOP
            INSERT INTO app_notifications (
                company_id, audience, recipient_auth_user_id, recipient_employee_id,
                type, title, body, ref_type, ref_id, dedupe_key, data
            ) VALUES (
                p_company_id,
                'hr',
                r.auth_user_id,
                NULL,
                'bank_details_updated',
                'Banking details updated',
                v_name || ' updated their banking details for payroll.',
                'employee',
                p_employee_id::text,
                'bank_details_updated:' || p_employee_id::text || ':' || r.auth_user_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
                jsonb_build_object(
                    'employee_id', p_employee_id,
                    'company_id', p_company_id,
                    'employee_name', v_name
                )
            );
        END LOOP;
    END IF;

    RETURN row_to_json(v_emp);
END;
$$;
-- employee_update_punch_address
create or replace function public.employee_update_punch_address(
  p_company_id  uuid,
  p_employee_id uuid,
  p_punch_id    uuid,
  p_address     text,
  p_session_token text DEFAULT NULL)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if trim(coalesce(p_address, '')) = '' then
    return;
  end if;

  update public.time_punches tp
  set address = trim(p_address)
  where tp.id = p_punch_id
    and tp.company_id = p_company_id
    and tp.employee_id = p_employee_id
    and public._employee_valid(p_company_id, p_employee_id);

  if not found then
    raise exception 'punch not found or not allowed';
  end if;
end;
$$;
-- employee_upsert_job_card
create or replace function public.employee_upsert_job_card(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_work_performed text default null,
  p_materials_used text default null,
  p_photo_urls text[] default '{}',
  p_is_completed boolean default false,
  p_client_signature_url text default null,
  p_session_token text DEFAULT NULL)
returns json
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.job_cards%rowtype;
begin
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  if not public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) then
    raise exception 'NOT_ASSIGNED_TO_JOB';
  end if;

  insert into public.job_cards (
    company_id, job_id, employee_id,
    start_time, end_time, work_performed, materials_used,
    photo_urls, is_completed, client_signature_url, updated_at
  )
  values (
    p_company_id, p_job_id, p_employee_id,
    p_start_time, p_end_time, p_work_performed, p_materials_used,
    coalesce(p_photo_urls, '{}'), coalesce(p_is_completed, false),
    p_client_signature_url, now()
  )
  on conflict (company_id, job_id)
  do update set
    employee_id = excluded.employee_id,
    start_time = coalesce(excluded.start_time, job_cards.start_time),
    end_time = coalesce(excluded.end_time, job_cards.end_time),
    work_performed = coalesce(excluded.work_performed, job_cards.work_performed),
    materials_used = coalesce(excluded.materials_used, job_cards.materials_used),
    photo_urls = case
      when coalesce(array_length(excluded.photo_urls, 1), 0) > 0 then excluded.photo_urls
      else job_cards.photo_urls
    end,
    is_completed = excluded.is_completed,
    client_signature_url = coalesce(excluded.client_signature_url, job_cards.client_signature_url),
    updated_at = now()
  returning * into v_row;

  if coalesce(p_is_completed, false) then
    update public.jobs
    set status = 'completed',
        closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where id = p_job_id
      and company_id = p_company_id
      and status not in ('completed', 'cancelled');
  end if;

  return row_to_json(v_row);
end;
$$;
-- enqueue_pa_task_notifications
CREATE OR REPLACE FUNCTION public.enqueue_pa_task_notifications(p_company_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_window text := to_char(now(), 'YYYYMMDDHH24');
BEGIN
  PERFORM public._assert_worker_access(
    p_company_id,
    (SELECT s.employee_id FROM public.employee_code_sessions s
     WHERE s.session_token = p_session_token AND s.company_id = p_company_id
       AND s.revoked_at IS NULL AND s.expires_at > now() LIMIT 1),
    p_session_token
  );

  FOR r IN
    SELECT t.id, t.title, t.due_date, t.owner_employee_id, t.assigned_employee_id
    FROM public.pa_tasks t
    WHERE t.company_id = p_company_id
      AND t.status NOT IN ('completed', 'cancelled', 'done')
      AND (
        (t.due_date IS NOT NULL AND t.due_date <= current_date + 1)
      )
    LIMIT 50
  LOOP
    DECLARE
      v_emp_id uuid := coalesce(r.owner_employee_id, r.assigned_employee_id);
      v_user_id uuid;
    BEGIN
      IF v_emp_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT e.user_id INTO v_user_id
      FROM public.employees e
      WHERE e.id = v_emp_id AND e.company_id = p_company_id;

      IF v_user_id IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.app_notifications (
        company_id, audience, recipient_auth_user_id, recipient_employee_id,
        type, title, body, ref_type, ref_id, dedupe_key, data
      ) VALUES (
        p_company_id,
        'employee',
        v_user_id,
        v_emp_id,
        'pa_task_due',
        'My PA — due soon',
        coalesce(r.title, 'Task') || ' is due soon. Open My PA to review.',
        'pa_task',
        r.id::text,
        'pa_task_due:' || r.id::text || ':' || v_window,
        jsonb_build_object('pa_task_id', r.id)
      )
      ;

      v_count := v_count + 1;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;
-- message_company_feed_unread_count
CREATE OR REPLACE FUNCTION public.message_company_feed_unread_count(
  p_company_id uuid,
  p_employee_id uuid,
  p_session_token text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN (SELECT coalesce((
    SELECT unread_count
    FROM public.message_unread_counts_for_threads(
      p_company_id,
      p_employee_id,
      ARRAY[public._company_feed_thread_id(p_company_id, p_session_token)]
    )
  ), 0));
END;
$$;
-- message_unread_counts_for_threads
CREATE OR REPLACE FUNCTION public.message_unread_counts_for_threads(
  p_company_id uuid,
  p_employee_id uuid,
  p_thread_ids uuid[],
  p_session_token text DEFAULT NULL)
RETURNS TABLE(thread_id uuid, unread_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT m.thread_id,
         count(*)::bigint AS unread_count
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id = ANY(p_thread_ids)
    AND m.sender_id <> p_employee_id
    AND NOT (p_employee_id = ANY(m.read_by_ids))
  GROUP BY m.thread_id;
END;
$$;
-- sync_operational_pa_tasks
CREATE OR REPLACE FUNCTION public.sync_operational_pa_tasks(
  p_company_id uuid,
  p_scope_employee_id uuid DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_created integer := 0;
  v_now timestamptz := now();
  v_sid text;
  v_due timestamptz;
  v_title text;
  v_emp uuid;
BEGIN
  IF p_scope_employee_id IS NOT NULL THEN
    PERFORM public._assert_worker_access(p_company_id, p_scope_employee_id, p_session_token);
  ELSIF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  -- Job assignment todos (one per assignee per active job).
  FOR r IN
    SELECT j.id, j.title, j.status, j.assignee_employee_id, j.assigned_employee_ids, j.scheduled_end
    FROM public.jobs j
    WHERE j.company_id = p_company_id
      AND coalesce(j.status, '') NOT IN ('completed', 'cancelled')
    LIMIT 500
  LOOP
    v_title := coalesce(nullif(trim(r.title), ''), 'Job');
    v_due := coalesce(r.scheduled_end, v_now + interval '1 day');

    FOR v_emp IN
      SELECT DISTINCT eid FROM (
        SELECT r.assignee_employee_id AS eid
        UNION ALL
        SELECT unnest(coalesce(r.assigned_employee_ids, '{}'::uuid[]))
      ) x
      WHERE eid IS NOT NULL
        AND (p_scope_employee_id IS NULL OR eid = p_scope_employee_id)
    LOOP
      v_sid := r.id::text || '_' || v_emp::text;
      IF EXISTS (
        SELECT 1 FROM public.pa_tasks t
        WHERE t.company_id = p_company_id
          AND t.source_type = 'job_assignment'
          AND t.source_id = v_sid
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.pa_tasks (
        company_id, title, notes, due_at, priority, status,
        linked_type, linked_id, linked_label,
        source_type, source_id, owner_employee_id, assigned_employee_id
      ) VALUES (
        p_company_id,
        'Job assigned: ' || v_title,
        'You are assigned to this job. Open Jobs to work it; mark this done when your part is complete.',
        v_due,
        'medium',
        'todo',
        'job',
        r.id::text,
        v_title,
        'job_assignment',
        v_sid,
        v_emp,
        v_emp
      );
      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  -- Project / deal due for manager or scoped employee.
  FOR r IN
    SELECT d.id, d.title, d.expected_close_date, d.manager_employee_id, d.status
    FROM public.client_deals d
    WHERE d.company_id = p_company_id
      AND d.status IN ('draft', 'sent', 'negotiation', 'won')
      AND d.expected_close_date IS NOT NULL
      AND d.expected_close_date <= (current_date + 3)
      AND (
        p_scope_employee_id IS NULL
        OR d.manager_employee_id = p_scope_employee_id
      )
    LIMIT 120
  LOOP
    v_sid := 'deal_' || r.id::text;
    IF p_scope_employee_id IS NOT NULL THEN
      v_sid := v_sid || '_' || p_scope_employee_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.pa_tasks t
      WHERE t.company_id = p_company_id
        AND t.source_type = 'project_assignment'
        AND t.source_id = v_sid
    ) THEN
      CONTINUE;
    END IF;

    v_emp := coalesce(p_scope_employee_id, r.manager_employee_id);
    v_due := (r.expected_close_date::timestamp AT TIME ZONE 'UTC') + interval '9 hours';

    INSERT INTO public.pa_tasks (
      company_id, title, notes, due_at, priority, status,
      linked_type, linked_id, linked_label,
      source_type, source_id, owner_employee_id, assigned_employee_id
    ) VALUES (
      p_company_id,
      'Project due: ' || coalesce(nullif(trim(r.title), ''), 'Project'),
      'Expected close ' || to_char(r.expected_close_date, 'DD Mon YYYY') || '. Follow up with the client.',
      v_due,
      'high',
      'todo',
      'deal',
      r.id::text,
      r.title,
      'project_assignment',
      v_sid,
      v_emp,
      v_emp
    );
    v_created := v_created + 1;
  END LOOP;

  -- Open jobs ending within 48h (SLA risk) for assignees.
  FOR r IN
    SELECT j.id, j.title, j.scheduled_end, j.assignee_employee_id
    FROM public.jobs j
    WHERE j.company_id = p_company_id
      AND j.status IN ('scheduled', 'inProgress', 'in_progress')
      AND j.scheduled_end IS NOT NULL
      AND j.scheduled_end <= v_now + interval '48 hours'
    LIMIT 200
  LOOP
    v_emp := r.assignee_employee_id;
    IF v_emp IS NULL THEN CONTINUE; END IF;
    IF p_scope_employee_id IS NOT NULL AND v_emp <> p_scope_employee_id THEN CONTINUE; END IF;

    v_sid := 'sla_' || r.id::text || '_' || v_emp::text;
    IF EXISTS (
      SELECT 1 FROM public.pa_tasks t
      WHERE t.company_id = p_company_id AND t.source_type = 'job_sla_risk' AND t.source_id = v_sid
    ) THEN CONTINUE; END IF;

    INSERT INTO public.pa_tasks (
      company_id, title, notes, due_at, priority, status,
      linked_type, linked_id, linked_label, source_type, source_id,
      owner_employee_id, assigned_employee_id
    ) VALUES (
      p_company_id,
      CASE WHEN r.scheduled_end < v_now THEN 'Job overdue window: ' ELSE 'Job ending soon: ' END
        || coalesce(nullif(trim(r.title), ''), 'Job'),
      'Scheduled end ' || to_char(r.scheduled_end AT TIME ZONE 'UTC', 'DD Mon YYYY HH24:MI') || '. Confirm status or reschedule.',
      CASE WHEN r.scheduled_end < v_now THEN v_now + interval '4 hours' ELSE r.scheduled_end END,
      CASE WHEN r.scheduled_end < v_now THEN 'high' ELSE 'medium' END,
      'todo',
      'job', r.id::text, r.title, 'job_sla_risk', v_sid, v_emp, v_emp
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN v_created;
END;
$$;
-- upsert_employee_pa_settings
CREATE OR REPLACE FUNCTION public.upsert_employee_pa_settings(
  p_employee_id uuid,
  p_company_id uuid,
  p_briefing_enabled boolean DEFAULT NULL,
  p_focus_mode_enabled boolean DEFAULT NULL,
  p_manager_digest_enabled boolean DEFAULT NULL,
  p_session_token text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);

  INSERT INTO public.employee_pa_settings (employee_id, company_id, briefing_enabled, focus_mode_enabled, manager_digest_enabled)
  VALUES (
    p_employee_id,
    p_company_id,
    COALESCE(p_briefing_enabled, true),
    COALESCE(p_focus_mode_enabled, false),
    COALESCE(p_manager_digest_enabled, true)
  )
  ON CONFLICT (employee_id) DO UPDATE SET
    briefing_enabled = COALESCE(p_briefing_enabled, employee_pa_settings.briefing_enabled),
    focus_mode_enabled = COALESCE(p_focus_mode_enabled, employee_pa_settings.focus_mode_enabled),
    manager_digest_enabled = COALESCE(p_manager_digest_enabled, employee_pa_settings.manager_digest_enabled),
    updated_at = now();
END;
$$;
-- ─── Re-grant anon + authenticated ─────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.employee_add_incident_comment(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_append_incident_photos(uuid, uuid, uuid, text[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_append_job_photo(uuid, uuid, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_consume_media_upload(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_create_job(uuid, uuid, text, text, text, timestamptz, timestamptz, uuid, uuid, uuid, uuid[], uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_delete_pa_task(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_find_direct_thread_peer(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_calendar_events_for_worker(uuid, uuid, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_checklist_for_job(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_approved_leave(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_feed_thread(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_messages_for_worker(uuid, uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_daily_absences(uuid, uuid, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_direct_peer_thread_map(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_incident(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_incident_comments(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_incident_status_history(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_incidents(uuid, uuid, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_inventory_items(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_inventory_usage_for_job(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_card_for_employee(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_card_for_job(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_documents(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_feedback(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_for_employee(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_photo_urls(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_job_thread(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_jobs_for_employee(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_leave_requests(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_linked_contractors(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_message_threads_for_worker(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_my_notifications_for_employee(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_or_create_direct_thread_peer(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_own_incidents(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_settings(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_pa_tasks(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_thread_messages_for_worker(uuid, uuid, uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_work_teams(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_workflow_form_submissions(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_workflow_form_templates(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_checklist_item(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_incident(uuid, uuid, text, text, uuid, uuid, uuid, text[], text, text, text, timestamptz, double precision, double precision, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_job_document(uuid, uuid, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_pa_task(uuid, uuid, text, text, date, text, timestamptz, timestamptz, text, text, text, text, text, timestamptz, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_insert_punch(uuid, uuid, text, timestamptz, double precision, double precision, text, uuid, text, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_open_visit(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_in(uuid, uuid, uuid, double precision, double precision, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_out(uuid, uuid, uuid, double precision, double precision, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_sign_out_open_visit(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_job_site_switch_to_job(uuid, uuid, uuid, double precision, double precision, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_list_company_peers(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_log_app_event(uuid, uuid, text, text, text, text, jsonb, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_company_feed_read_for_worker(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_notification_read_for_employee(uuid, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_thread_read_for_worker(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_notify_manager_job_created(uuid, uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_prepare_media_upload(uuid, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_report_absence(uuid, uuid, date, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_company_feed_message(uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_thread_message(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_set_inventory_usage_for_job(uuid, uuid, uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_set_open_punch_job(bigint, bigint, bigint, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_job_feedback(uuid, uuid, uuid, int, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(uuid, uuid, text, date, date, float, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_workflow_form(uuid, uuid, uuid, jsonb, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_calendar_event_attendance(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_checklist_item(uuid, uuid, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_document(uuid, uuid, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_incident(uuid, uuid, uuid, text, text, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_job_status(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_leave_request(uuid, uuid, text, date, date, float, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task(uuid, uuid, uuid, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_pa_task_status(uuid, uuid, uuid, text, timestamptz, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_profile(uuid, uuid, text, text, text, text, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_update_punch_address(uuid, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_upsert_job_card(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text[], boolean, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pa_task_notifications(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_company_feed_unread_count(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_unread_counts_for_threads(uuid, uuid, uuid[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_operational_pa_tasks(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_employee_pa_settings(uuid, uuid, boolean, boolean, boolean, text) TO anon, authenticated;
-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK NOTES (manual)
--   1. DROP each (... , text) overload above; redeploy prior bodies from source migrations.
--   2. Revert client RPC calls that pass p_session_token.
--   3. _assert_worker_access helpers from foundation migration may remain.
-- ════════════════════════════════════════════════════════════════════════════;
