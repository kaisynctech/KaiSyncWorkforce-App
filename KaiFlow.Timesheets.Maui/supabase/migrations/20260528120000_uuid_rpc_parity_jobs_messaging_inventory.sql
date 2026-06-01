-- UUID parity for employee RPCs still on bigint after schema v2.
-- Aligns Flutter/MAUI clients with uuid tenant ids.

-- ─── Jobs ───────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.employee_update_job_status(bigint, bigint, bigint, text);

CREATE OR REPLACE FUNCTION public.employee_update_job_status(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
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

GRANT EXECUTE ON FUNCTION public.employee_update_job_status(uuid, uuid, uuid, text)
  TO anon, authenticated;

-- Legacy name used by older Flutter builds — delegate to uuid implementation.
DROP FUNCTION IF EXISTS public.employee_get_job_card_for_job(bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.employee_get_job_card_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.employee_get_job_card_for_employee(
    p_company_id, p_job_id, p_employee_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.employee_get_job_card_for_job(uuid, uuid, uuid)
  TO anon, authenticated;

-- ─── Inventory (uuid) ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.employee_get_inventory_items(bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_get_inventory_usage_for_job(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_set_inventory_usage_for_job(bigint, bigint, bigint, jsonb);

CREATE OR REPLACE FUNCTION public.employee_get_inventory_items(
  p_company_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS SETOF public.inventory_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT i.*
  FROM public.inventory_items i
  WHERE i.company_id = p_company_id
  ORDER BY i.name;
$$;

CREATE OR REPLACE FUNCTION public.employee_get_inventory_usage_for_job(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid DEFAULT NULL
)
RETURNS SETOF public.inventory_usage
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT u.*
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND (p_employee_id IS NULL OR u.employee_id = p_employee_id);
$$;

CREATE OR REPLACE FUNCTION public.employee_set_inventory_usage_for_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_job_id uuid,
  p_usages jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
BEGIN
  IF NOT public._employee_assigned_to_job(p_company_id, p_employee_id, p_job_id) THEN
    RAISE EXCEPTION 'Not allowed to set usage for this job';
  END IF;

  CREATE TEMPORARY TABLE _old_usage ON COMMIT DROP AS
  SELECT u.inventory_item_id, sum(u.quantity_used) AS qty
  FROM public.inventory_usage u
  WHERE u.company_id = p_company_id
    AND u.job_id = p_job_id
    AND u.employee_id = p_employee_id
  GROUP BY u.inventory_item_id;

  CREATE TEMPORARY TABLE _new_usage ON COMMIT DROP AS
  SELECT (x.inventory_item_id)::uuid AS inventory_item_id,
         coalesce((x.quantity)::numeric, 0) AS qty
  FROM jsonb_to_recordset(coalesce(p_usages, '[]'::jsonb)) AS x(
    inventory_item_id text,
    quantity text
  )
  WHERE coalesce((x.quantity)::numeric, 0) > 0;

  FOR r IN
    SELECT coalesce(n.inventory_item_id, o.inventory_item_id) AS inventory_item_id,
           coalesce(n.qty, 0) - coalesce(o.qty, 0) AS delta
    FROM _new_usage n
    FULL OUTER JOIN _old_usage o ON o.inventory_item_id = n.inventory_item_id
  LOOP
    IF r.delta > 0 THEN
      UPDATE public.inventory_items i
      SET stock_count = i.stock_count - r.delta
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id
        AND i.stock_count >= r.delta;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for item %', r.inventory_item_id;
      END IF;
    ELSIF r.delta < 0 THEN
      UPDATE public.inventory_items i
      SET stock_count = i.stock_count + abs(r.delta)
      WHERE i.company_id = p_company_id
        AND i.id = r.inventory_item_id;
    END IF;
  END LOOP;

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

GRANT EXECUTE ON FUNCTION public.employee_get_inventory_items(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_inventory_usage_for_job(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_set_inventory_usage_for_job(uuid, uuid, uuid, jsonb) TO anon, authenticated;

-- ─── HR delete employee (uuid) ──────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.hr_delete_employee_safe(bigint, bigint);

CREATE OR REPLACE FUNCTION public.hr_delete_employee_safe(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hr_users h
    WHERE h.auth_user_id = auth.uid()
      AND h.company_id = p_company_id
      AND coalesce(h.is_active, true)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.time_punches
  WHERE company_id = p_company_id AND employee_id = p_employee_id;

  DELETE FROM public.employees
  WHERE company_id = p_company_id AND id = p_employee_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_delete_employee_safe(uuid, uuid) TO authenticated;

-- ─── Messaging (uuid / message_threads schema) ───────────────────────────────

DROP FUNCTION IF EXISTS public.employee_get_message_threads_for_worker(bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_get_company_messages_for_worker(bigint, bigint, integer);
DROP FUNCTION IF EXISTS public.employee_send_company_feed_message(bigint, bigint, text);
DROP FUNCTION IF EXISTS public.employee_get_thread_messages_for_worker(bigint, bigint, bigint, integer);
DROP FUNCTION IF EXISTS public.employee_send_thread_message(bigint, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.employee_mark_thread_read_for_worker(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_mark_company_feed_read_for_worker(bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_find_direct_thread_peer(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_get_direct_peer_thread_map(bigint, bigint);
DROP FUNCTION IF EXISTS public.employee_get_or_create_direct_thread_peer(bigint, bigint, bigint, text);
DROP FUNCTION IF EXISTS public.message_unread_counts_for_threads(bigint, bigint, bigint[]);
DROP FUNCTION IF EXISTS public.message_company_feed_unread_count(bigint, bigint);
DROP FUNCTION IF EXISTS public.ensure_job_team_message_thread(bigint, bigint);

CREATE OR REPLACE FUNCTION public._employee_valid(p_company_id uuid, p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id AND e.company_id = p_company_id
  );
$$;

CREATE OR REPLACE FUNCTION public._company_feed_thread_id(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT t.id INTO v_id
  FROM public.message_threads t
  WHERE t.company_id = p_company_id AND t.type_raw = 'company_feed'
  LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.message_threads (company_id, subject, type_raw, participant_ids)
    VALUES (p_company_id, 'Company Feed', 'company_feed', '{}')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_get_message_threads_for_worker(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS SETOF public.message_threads
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT t.*
  FROM public.message_threads t
  WHERE t.company_id = p_company_id
    AND p_employee_id = ANY(t.participant_ids)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY coalesce(t.last_message_at, t.created_at) DESC;
$$;

CREATE OR REPLACE FUNCTION public.employee_get_company_messages_for_worker(
  p_company_id uuid,
  p_employee_id uuid,
  p_limit integer DEFAULT 120
)
RETURNS SETOF public.app_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT m.*
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id = public._company_feed_thread_id(p_company_id)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 120), 500));
$$;

CREATE OR REPLACE FUNCTION public.employee_send_company_feed_message(
  p_company_id uuid,
  p_sender_employee_id uuid,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE v_thread uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION public.employee_get_thread_messages_for_worker(
  p_company_id uuid,
  p_thread_id uuid,
  p_employee_id uuid,
  p_limit integer DEFAULT 200
)
RETURNS SETOF public.app_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT m.*
  FROM public.app_messages m
  INNER JOIN public.message_threads t ON t.id = m.thread_id AND t.company_id = m.company_id
  WHERE m.company_id = p_company_id
    AND m.thread_id = p_thread_id
    AND p_employee_id = ANY(t.participant_ids)
    AND public._employee_valid(p_company_id, p_employee_id)
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
$$;

CREATE OR REPLACE FUNCTION public.employee_send_thread_message(
  p_company_id uuid,
  p_thread_id uuid,
  p_sender_employee_id uuid,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.employee_mark_thread_read_for_worker(
  p_company_id uuid,
  p_thread_id uuid,
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.employee_mark_company_feed_read_for_worker(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  PERFORM public.employee_mark_thread_read_for_worker(
    p_company_id,
    public._company_feed_thread_id(p_company_id),
    p_employee_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.employee_find_direct_thread_peer(
  p_company_id uuid,
  p_from_id uuid,
  p_to_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT t.id
  FROM public.message_threads t
  WHERE t.company_id = p_company_id
    AND t.type_raw = 'direct'
    AND p_from_id = ANY(t.participant_ids)
    AND p_to_id = ANY(t.participant_ids)
    AND cardinality(t.participant_ids) = 2
  ORDER BY t.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.employee_get_direct_peer_thread_map(
  p_company_id uuid,
  p_my_employee_id uuid
)
RETURNS TABLE(peer_employee_id uuid, thread_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.employee_get_or_create_direct_thread_peer(
  p_company_id uuid,
  p_creator_id uuid,
  p_peer_id uuid,
  p_title text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE v_tid uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION public.message_unread_counts_for_threads(
  p_company_id uuid,
  p_employee_id uuid,
  p_thread_ids uuid[]
)
RETURNS TABLE(thread_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT m.thread_id,
         count(*)::bigint AS unread_count
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id = ANY(p_thread_ids)
    AND m.sender_id <> p_employee_id
    AND NOT (p_employee_id = ANY(m.read_by_ids))
  GROUP BY m.thread_id;
$$;

CREATE OR REPLACE FUNCTION public.message_company_feed_unread_count(
  p_company_id uuid,
  p_employee_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT coalesce((
    SELECT unread_count
    FROM public.message_unread_counts_for_threads(
      p_company_id,
      p_employee_id,
      ARRAY[public._company_feed_thread_id(p_company_id)]
    )
  ), 0);
$$;

CREATE OR REPLACE FUNCTION public.ensure_job_team_message_thread(
  p_company_id uuid,
  p_job_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_tid uuid;
  v_title text;
  v_members uuid[];
BEGIN
  SELECT j.title INTO v_title
  FROM public.jobs j
  WHERE j.id = p_job_id AND j.company_id = p_company_id;
  IF v_title IS NULL THEN RAISE EXCEPTION 'job not found'; END IF;

  SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO v_members
  FROM (
    SELECT unnest(coalesce(j.assigned_employee_ids, '{}'::uuid[])) AS x FROM public.jobs j WHERE j.id = p_job_id
    UNION SELECT j.assignee_employee_id FROM public.jobs j WHERE j.id = p_job_id AND j.assignee_employee_id IS NOT NULL
    UNION SELECT j.contractor_employee_id FROM public.jobs j WHERE j.id = p_job_id AND j.contractor_employee_id IS NOT NULL
  ) s
  WHERE x IS NOT NULL;

  SELECT t.id INTO v_tid
  FROM public.message_threads t
  WHERE t.company_id = p_company_id AND t.subject = 'Job:' || p_job_id::text
  LIMIT 1;

  IF v_tid IS NULL THEN
    INSERT INTO public.message_threads (company_id, subject, type_raw, participant_ids)
    VALUES (p_company_id, 'Job:' || p_job_id::text, 'job', coalesce(v_members, '{}'::uuid[]))
    RETURNING id INTO v_tid;
  ELSE
    UPDATE public.message_threads
    SET subject = 'Job:' || p_job_id::text,
        participant_ids = coalesce(v_members, '{}'::uuid[])
    WHERE id = v_tid;
  END IF;
  RETURN v_tid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_get_message_threads_for_worker(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_messages_for_worker(uuid, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_company_feed_message(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_thread_messages_for_worker(uuid, uuid, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_thread_message(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_thread_read_for_worker(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_company_feed_read_for_worker(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_find_direct_thread_peer(uuid, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_direct_peer_thread_map(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_or_create_direct_thread_peer(uuid, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_unread_counts_for_threads(uuid, uuid, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_company_feed_unread_count(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_job_team_message_thread(uuid, uuid) TO authenticated;
