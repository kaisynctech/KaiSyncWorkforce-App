-- W5 (Nyarie approved 23 Oct 2026): Team punch repair, safe work-team membership changes,
-- medical aid dependants for the PAYE medical credit.

-- 1) Medical aid dependants (people on the employee's medical aid besides themselves).
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS medical_aid_dependants smallint NOT NULL DEFAULT 0
  CHECK (medical_aid_dependants BETWEEN 0 AND 20);

-- 2) Team punch.
-- Before: hr_team_clock_in / hr_team_clock_out / hr_team_latest_punches referenced the dropped table
-- hr_users, so every call failed ("relation public.hr_users does not exist"); nobody has managed a
-- team punch since 25 May. They also let ANY active employee of the company clock anyone in or out,
-- and never recorded who did the punch.
-- Now: the caller needs attendance.view_team (owner, admin, HR, manager by default). Owner/admin/HR
-- (attendance.view_all) may punch anyone in the company; others only people they can see
-- (employee_can_view: their reports and teams). The punch records punched_by_manager_id (the caller's login).
-- Clock-in skips people on approved leave today (same rule as a self clock-in).

CREATE OR REPLACE FUNCTION public._team_punch_actor(p_company_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_company_id IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission(p_company_id, 'attendance.view_team') THEN
    RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: you cannot punch for a team' USING ERRCODE = '42501';
  END IF;
  -- time_punches.punched_by_manager_id references auth.users, so this is the caller's login id.
  RETURN auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public._team_punch_may_target(p_company_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id = p_employee_id AND e.company_id = p_company_id) THEN
    RETURN false;
  END IF;
  IF public.user_has_permission(p_company_id, 'attendance.view_all') THEN RETURN true; END IF;
  RETURN coalesce(public.employee_can_view(p_company_id, p_employee_id), false);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_team_clock_in(p_company_id uuid, p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision,
  p_address text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := public._team_punch_actor(p_company_id);
  v_employee_id uuid;
  v_last_type text;
  v_today date;
  v_clocked uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  SELECT (now() AT TIME ZONE coalesce(nullif(trim(cs.timezone), ''), 'Africa/Johannesburg'))::date INTO v_today
    FROM public.company_settings cs WHERE cs.company_id = p_company_id;
  v_today := coalesce(v_today, (now() AT TIME ZONE 'Africa/Johannesburg')::date);

  FOREACH v_employee_id IN ARRAY COALESCE(p_employee_ids, ARRAY[]::uuid[]) LOOP
    IF NOT public._team_punch_may_target(p_company_id, v_employee_id) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('employee_id', v_employee_id, 'reason', 'not_allowed'));
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.leave_requests lr
               WHERE lr.company_id = p_company_id AND lr.employee_id = v_employee_id
                 AND lr.status = 'approved' AND v_today BETWEEN lr.start_date AND lr.end_date) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('employee_id', v_employee_id, 'reason', 'on_leave'));
      CONTINUE;
    END IF;
    SELECT tp.type INTO v_last_type FROM public.time_punches tp
     WHERE tp.company_id = p_company_id AND tp.employee_id = v_employee_id
     ORDER BY tp.date_time DESC, tp.created_at DESC LIMIT 1;
    IF v_last_type = 'in' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('employee_id', v_employee_id, 'reason', 'already_in'));
      CONTINUE;
    END IF;
    INSERT INTO public.time_punches (company_id, employee_id, type, date_time, latitude, longitude, address, punched_by_manager_id)
    VALUES (p_company_id, v_employee_id, 'in', now(), p_latitude, p_longitude, p_address, v_actor);
    v_clocked := array_append(v_clocked, v_employee_id);
  END LOOP;
  RETURN jsonb_build_object('clocked', to_jsonb(v_clocked), 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_team_clock_out(p_company_id uuid, p_employee_ids uuid[],
  p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision,
  p_address text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid := public._team_punch_actor(p_company_id);
  v_employee_id uuid;
  v_last_type text;
  v_clocked uuid[] := ARRAY[]::uuid[];
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  FOREACH v_employee_id IN ARRAY COALESCE(p_employee_ids, ARRAY[]::uuid[]) LOOP
    IF NOT public._team_punch_may_target(p_company_id, v_employee_id) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('employee_id', v_employee_id, 'reason', 'not_allowed'));
      CONTINUE;
    END IF;
    SELECT tp.type INTO v_last_type FROM public.time_punches tp
     WHERE tp.company_id = p_company_id AND tp.employee_id = v_employee_id
     ORDER BY tp.date_time DESC, tp.created_at DESC LIMIT 1;
    IF v_last_type IS DISTINCT FROM 'in' THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('employee_id', v_employee_id, 'reason', 'not_in'));
      CONTINUE;
    END IF;
    INSERT INTO public.time_punches (company_id, employee_id, type, date_time, latitude, longitude, address, punched_by_manager_id)
    VALUES (p_company_id, v_employee_id, 'out', now(), p_latitude, p_longitude, p_address, v_actor);
    v_clocked := array_append(v_clocked, v_employee_id);
  END LOOP;
  RETURN jsonb_build_object('clocked', to_jsonb(v_clocked), 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_team_latest_punches(p_company_id uuid, p_employee_ids uuid[])
RETURNS TABLE(employee_id uuid, punch_type text, punched_at timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._team_punch_actor(p_company_id);
  RETURN QUERY
  SELECT DISTINCT ON (tp.employee_id) tp.employee_id, tp.type, tp.date_time
  FROM public.time_punches tp
  WHERE tp.company_id = p_company_id
    AND tp.employee_id = ANY(COALESCE(p_employee_ids, ARRAY[]::uuid[]))
    AND public._team_punch_may_target(p_company_id, tp.employee_id)
  ORDER BY tp.employee_id, tp.date_time DESC, tp.created_at DESC;
END;
$$;

-- 3) Work team membership: add/remove in one statement on the server.
-- Before: the page sent the whole member list from its own (sometimes out-of-date) copy, so adding
-- people quickly, or two people editing one team, silently lost members (25 added, 15 saved).
-- SECURITY INVOKER: the existing work_teams row-level security still decides who may change a team.
CREATE OR REPLACE FUNCTION public.work_team_add_members(p_team_id uuid, p_employee_ids uuid[])
RETURNS uuid[] LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$
  UPDATE public.work_teams w
     SET member_ids = (
       SELECT coalesce(array_agg(x ORDER BY ord), ARRAY[]::uuid[]) FROM (
         SELECT x, min(ord) ord FROM unnest(coalesce(w.member_ids, ARRAY[]::uuid[]) || coalesce(p_employee_ids, ARRAY[]::uuid[]))
           WITH ORDINALITY AS t(x, ord)
         WHERE x IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = t.x AND e.company_id = w.company_id)
         GROUP BY x) d)
   WHERE w.id = p_team_id
  RETURNING member_ids;
$$;

CREATE OR REPLACE FUNCTION public.work_team_remove_member(p_team_id uuid, p_employee_id uuid)
RETURNS uuid[] LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$
  UPDATE public.work_teams w
     SET member_ids = array_remove(coalesce(w.member_ids, ARRAY[]::uuid[]), p_employee_id),
         leader_employee_id = CASE WHEN w.leader_employee_id = p_employee_id THEN NULL ELSE w.leader_employee_id END
   WHERE w.id = p_team_id
  RETURNING member_ids;
$$;

-- Access (applied as separate statements).
GRANT SELECT, INSERT, UPDATE (medical_aid_dependants) ON public.employees TO authenticated;
REVOKE ALL ON FUNCTION public._team_punch_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._team_punch_may_target(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.work_team_add_members(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.work_team_remove_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_in(uuid, uuid[], double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_team_clock_out(uuid, uuid[], double precision, double precision, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_team_latest_punches(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.work_team_add_members(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.work_team_remove_member(uuid, uuid) TO authenticated;
