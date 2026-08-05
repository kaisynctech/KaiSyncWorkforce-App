-- Worker app (company-code login = anon JWT): RPCs bypass RLS that depends on auth.uid() / profile_id.
-- Also: authenticated employees can read peer rows in the same company (directory / messaging).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employees'
      AND policyname = 'p_employees_company_peer_select'
  ) THEN
    CREATE POLICY p_employees_company_peer_select ON public.employees
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.employees me
          WHERE me.profile_id = auth.uid()
            AND me.company_id = employees.company_id
        )
      );
  END IF;
END $$;
-- Unread helpers: must not rely on INVOKER RLS on app_messages (anon workers).
CREATE OR REPLACE FUNCTION public.message_unread_counts_for_threads(
  p_company_id bigint,
  p_employee_id bigint,
  p_thread_ids bigint[]
)
RETURNS TABLE(thread_id bigint, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.thread_id, COUNT(*)::bigint
  FROM app_messages m
  LEFT JOIN app_message_thread_reads r
    ON r.company_id = m.company_id
   AND r.thread_id = m.thread_id
   AND r.employee_id = p_employee_id
  WHERE m.company_id = p_company_id
    AND m.thread_id IS NOT NULL
    AND m.thread_id = ANY(p_thread_ids)
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
    )
    AND (
      m.sender_employee_id IS DISTINCT FROM p_employee_id
      OR (m.sender_employee_id IS NULL AND m.sender_hr_user_id IS NOT NULL)
    )
    AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz)
  GROUP BY m.thread_id;
$$;
CREATE OR REPLACE FUNCTION public.message_company_feed_unread_count(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM app_messages m
  LEFT JOIN app_message_company_feed_reads r
    ON r.company_id = m.company_id
   AND r.employee_id = p_employee_id
  WHERE m.company_id = p_company_id
    AND m.thread_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
    )
    AND (
      m.sender_employee_id IS DISTINCT FROM p_employee_id
      OR (m.sender_employee_id IS NULL AND m.sender_hr_user_id IS NOT NULL)
    )
    AND m.created_at > COALESCE(r.last_read_at, '-infinity'::timestamptz);
$$;
GRANT EXECUTE ON FUNCTION public.message_unread_counts_for_threads(bigint, bigint, bigint[])
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_company_feed_unread_count(bigint, bigint)
  TO anon, authenticated;
-- Company employee directory (same trust model as employee_get_jobs_for_employee).
CREATE OR REPLACE FUNCTION public.employee_list_company_peers(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS SETOF public.employees
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.*
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND EXISTS (
      SELECT 1 FROM public.employees self
      WHERE self.id = p_employee_id AND self.company_id = p_company_id
    )
  ORDER BY e.name NULLS LAST, e.surname NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.employee_list_company_peers(bigint, bigint) TO anon, authenticated;
-- Leave (table may exist only on hosted DB).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leave_requests'
  ) THEN
    EXECUTE $f$
CREATE OR REPLACE FUNCTION public.employee_get_leave_requests(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS SETOF public.leave_requests
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT lr.*
  FROM public.leave_requests lr
  WHERE lr.company_id = p_company_id
    AND lr.employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
    )
  ORDER BY lr.created_at DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.employee_submit_leave_request(
  p_company_id bigint,
  p_employee_id bigint,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_half_day_start boolean,
  p_half_day_end boolean,
  p_total_days integer,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id bigint;
  v_name text;
  r public.hr_users%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees ex
    WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date cannot be before start date.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.company_id = p_company_id
      AND lr.employee_id = p_employee_id
      AND lr.status IN ('pending', 'approved')
      AND lr.start_date <= p_end_date
      AND lr.end_date >= p_start_date
  ) THEN
    RAISE EXCEPTION 'You already have a pending/approved leave request in this range.';
  END IF;

  SELECT trim(both concat_ws(' ', nullif(trim(e.name), ''), nullif(trim(e.surname), '')))
  INTO v_name
  FROM public.employees e
  WHERE e.id = p_employee_id;

  IF v_name IS NULL OR v_name = '' THEN
    v_name := 'Employee #' || p_employee_id::text;
  END IF;

  INSERT INTO public.leave_requests (
    company_id,
    employee_id,
    leave_type,
    start_date,
    end_date,
    half_day_start,
    half_day_end,
    total_days,
    reason,
    status
  ) VALUES (
    p_company_id,
    p_employee_id,
    coalesce(nullif(trim(p_leave_type), ''), 'annual'),
    p_start_date,
    p_end_date,
    coalesce(p_half_day_start, false),
    coalesce(p_half_day_end, false),
    greatest(1, coalesce(p_total_days, 1)),
    nullif(trim(coalesce(p_reason, '')), ''),
    'pending'
  )
  RETURNING id INTO v_id;

  FOR r IN
    SELECT * FROM public.hr_users h
    WHERE h.company_id = p_company_id AND h.is_active = true
  LOOP
    IF r.auth_user_id IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.app_notifications n
      WHERE n.dedupe_key =
            'leave_submitted:' || v_id::text || ':' || r.auth_user_id::text
    ) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.app_notifications (
      company_id,
      audience,
      recipient_auth_user_id,
      type,
      title,
      body,
      ref_type,
      ref_id,
      dedupe_key
    ) VALUES (
      p_company_id,
      'hr',
      r.auth_user_id,
      'leave_submitted',
      'Leave request submitted',
      format(
        '%s requested %s leave (%s - %s).',
        v_name,
        lower(trim(coalesce(nullif(trim(p_leave_type), ''), 'annual'))),
        to_char(p_start_date, 'DD Mon'),
        to_char(p_end_date, 'DD Mon')
      ),
      'leave_request',
      v_id::text,
      'leave_submitted:' || v_id::text || ':' || r.auth_user_id::text
    );
  END LOOP;

  RETURN v_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.employee_get_leave_requests(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_submit_leave_request(
  bigint, bigint, text, date, date, boolean, boolean, integer, text
) TO anon, authenticated;

$f$;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.employee_find_direct_thread_peer(
  p_company_id bigint,
  p_from_id bigint,
  p_to_id bigint
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.app_message_threads t
  WHERE t.company_id = p_company_id
    AND t.thread_type = 'direct'
    AND EXISTS (
      SELECT 1 FROM public.app_message_thread_members m1
      WHERE m1.thread_id = t.id AND m1.company_id = p_company_id
        AND m1.member_employee_id = p_from_id
    )
    AND EXISTS (
      SELECT 1 FROM public.app_message_thread_members m2
      WHERE m2.thread_id = t.id AND m2.company_id = p_company_id
        AND m2.member_employee_id = p_to_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.app_message_thread_members hr
      WHERE hr.thread_id = t.id AND hr.member_hr_user_id IS NOT NULL
    )
    AND (
      SELECT count(*) FROM public.app_message_thread_members m
      WHERE m.thread_id = t.id AND m.member_employee_id IS NOT NULL
    ) = 2
  ORDER BY t.id DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.employee_find_direct_thread_peer(bigint, bigint, bigint)
  TO anon, authenticated;
-- Messaging (threads / feed / chat) for workers.
CREATE OR REPLACE FUNCTION public.employee_get_message_threads_for_worker(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS SETOF public.app_message_threads
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.*
  FROM public.app_message_threads t
  INNER JOIN public.app_message_thread_members m
    ON m.thread_id = t.id AND m.company_id = t.company_id
  WHERE t.company_id = p_company_id
    AND m.member_employee_id = p_employee_id
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
    )
  ORDER BY t.created_at DESC;
$$;
CREATE OR REPLACE FUNCTION public.employee_get_direct_peer_thread_map(
  p_company_id bigint,
  p_my_employee_id bigint
)
RETURNS TABLE(peer_employee_id bigint, thread_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT other.member_employee_id AS peer_employee_id, t.id AS thread_id
  FROM public.app_message_threads t
  INNER JOIN public.app_message_thread_members me
    ON me.thread_id = t.id AND me.company_id = t.company_id
   AND me.member_employee_id = p_my_employee_id
  INNER JOIN public.app_message_thread_members other
    ON other.thread_id = t.id AND other.company_id = t.company_id
   AND other.member_employee_id IS NOT NULL
   AND other.member_employee_id <> p_my_employee_id
  WHERE t.company_id = p_company_id
    AND t.thread_type = 'direct'
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_my_employee_id AND ex.company_id = p_company_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.app_message_thread_members hr
      WHERE hr.thread_id = t.id AND hr.member_hr_user_id IS NOT NULL
    );
$$;
CREATE OR REPLACE FUNCTION public.employee_get_or_create_direct_thread_peer(
  p_company_id bigint,
  p_creator_id bigint,
  p_peer_id bigint,
  p_title text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid bigint;
BEGIN
  IF p_creator_id = p_peer_id THEN
    RAISE EXCEPTION 'invalid peers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_creator_id AND e.company_id = p_company_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.employees e WHERE e.id = p_peer_id AND e.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  SELECT t.id INTO v_tid
  FROM public.app_message_threads t
  WHERE t.company_id = p_company_id AND t.thread_type = 'direct'
    AND EXISTS (
      SELECT 1 FROM public.app_message_thread_members m1
      WHERE m1.thread_id = t.id AND m1.company_id = p_company_id AND m1.member_employee_id = p_creator_id
    )
    AND EXISTS (
      SELECT 1 FROM public.app_message_thread_members m2
      WHERE m2.thread_id = t.id AND m2.company_id = p_company_id AND m2.member_employee_id = p_peer_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.app_message_thread_members hr
      WHERE hr.thread_id = t.id AND hr.member_hr_user_id IS NOT NULL
    )
    AND (
      SELECT count(*) FROM public.app_message_thread_members m
      WHERE m.thread_id = t.id AND m.member_employee_id IS NOT NULL
    ) = 2
  ORDER BY t.id DESC
  LIMIT 1;

  IF v_tid IS NOT NULL THEN
    RETURN v_tid;
  END IF;

  INSERT INTO public.app_message_threads (
    company_id, title, thread_type, created_by_employee_id, created_by_hr_user_id
  ) VALUES (
    p_company_id,
    trim(coalesce(nullif(trim(p_title), ''), 'Direct chat')),
    'direct',
    p_creator_id,
    NULL
  )
  RETURNING id INTO v_tid;

  INSERT INTO public.app_message_thread_members (company_id, thread_id, member_employee_id, role)
  VALUES
    (p_company_id, v_tid, p_creator_id, 'manager'),
    (p_company_id, v_tid, p_peer_id, 'member');

  RETURN v_tid;
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_get_company_messages_for_worker(
  p_company_id bigint,
  p_employee_id bigint,
  p_limit integer DEFAULT 120
)
RETURNS SETOF public.app_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.*
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.employees ex
      WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
    )
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 120), 500));
$$;
CREATE OR REPLACE FUNCTION public.employee_get_thread_messages_for_worker(
  p_company_id bigint,
  p_thread_id bigint,
  p_employee_id bigint,
  p_limit integer DEFAULT 200
)
RETURNS SETOF public.app_messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.*
  FROM public.app_messages m
  WHERE m.company_id = p_company_id
    AND m.thread_id = p_thread_id
    AND EXISTS (
      SELECT 1 FROM public.app_message_thread_members mem
      WHERE mem.company_id = p_company_id
        AND mem.thread_id = p_thread_id
        AND mem.member_employee_id = p_employee_id
    )
  ORDER BY m.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
$$;
CREATE OR REPLACE FUNCTION public.employee_send_company_feed_message(
  p_company_id bigint,
  p_sender_employee_id bigint,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.employees ex
    WHERE ex.id = p_sender_employee_id AND ex.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid sender';
  END IF;

  INSERT INTO public.app_messages (
    company_id, thread_id, sender_employee_id, sender_hr_user_id, body
  ) VALUES (
    p_company_id, NULL, p_sender_employee_id, NULL, trim(p_body)
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_send_thread_message(
  p_company_id bigint,
  p_thread_id bigint,
  p_sender_employee_id bigint,
  p_body text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF trim(coalesce(p_body, '')) = '' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_message_thread_members m
    WHERE m.company_id = p_company_id
      AND m.thread_id = p_thread_id
      AND m.member_employee_id = p_sender_employee_id
  ) THEN
    RAISE EXCEPTION 'not a thread member';
  END IF;

  INSERT INTO public.app_messages (
    company_id, thread_id, sender_employee_id, sender_hr_user_id, body
  ) VALUES (
    p_company_id, p_thread_id, p_sender_employee_id, NULL, trim(p_body)
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_mark_thread_read_for_worker(
  p_company_id bigint,
  p_thread_id bigint,
  p_employee_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_message_thread_members m
    WHERE m.company_id = p_company_id
      AND m.thread_id = p_thread_id
      AND m.member_employee_id = p_employee_id
  ) THEN
    RAISE EXCEPTION 'not a thread member';
  END IF;

  INSERT INTO public.app_message_thread_reads (
    company_id, thread_id, employee_id, last_read_at
  ) VALUES (
    p_company_id, p_thread_id, p_employee_id, now()
  )
  ON CONFLICT (thread_id, employee_id)
  DO UPDATE SET last_read_at = excluded.last_read_at;
END;
$$;
CREATE OR REPLACE FUNCTION public.employee_mark_company_feed_read_for_worker(
  p_company_id bigint,
  p_employee_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employees ex
    WHERE ex.id = p_employee_id AND ex.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'invalid employee';
  END IF;

  INSERT INTO public.app_message_company_feed_reads (
    company_id, employee_id, last_read_at
  ) VALUES (
    p_company_id, p_employee_id, now()
  )
  ON CONFLICT (company_id, employee_id)
  DO UPDATE SET last_read_at = excluded.last_read_at;
END;
$$;
GRANT EXECUTE ON FUNCTION public.employee_get_message_threads_for_worker(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_direct_peer_thread_map(bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_or_create_direct_thread_peer(bigint, bigint, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_company_messages_for_worker(bigint, bigint, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_get_thread_messages_for_worker(bigint, bigint, bigint, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_company_feed_message(bigint, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_send_thread_message(bigint, bigint, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_thread_read_for_worker(bigint, bigint, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employee_mark_company_feed_read_for_worker(bigint, bigint) TO anon, authenticated;
