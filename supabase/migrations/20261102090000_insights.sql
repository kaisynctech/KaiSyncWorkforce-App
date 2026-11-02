-- Insights (approved 30 Oct 2026; applied 2 Nov 2026): dashboards for People & attendance, Jobs & operations,
-- Sales & money and Payroll, an Insights home summary, and detail reports.
-- Every public function checks the caller first (_reports_office: owner, admin, HR or manager of
-- that company — the same people who can open Reports today). Times are South African time.
-- A "work day" runs 05:00–05:00 so night shifts that end after midnight count on the day they start.
-- No scratch tables (they also made the database tool ask for an extra confirmation).

-- ── Indexes: these tables had no company/date index, so every report read the whole table ──────
CREATE INDEX IF NOT EXISTS idx_time_punches_company_time ON public.time_punches (company_id, date_time);
CREATE INDEX IF NOT EXISTS idx_time_punches_employee_time ON public.time_punches (employee_id, date_time);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_dates ON public.leave_requests (company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_payment_approvals_company_period ON public.payment_approvals (company_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_jobs_company_created ON public.jobs (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_company_closed ON public.jobs (company_id, closed_at) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incident_reports_company_occurred ON public.incident_reports (company_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_company_created ON public.commercial_quotes (company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finance_transactions_company_date ON public.finance_transactions (company_id, transaction_date);

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ins_day_start(p_day date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_day::timestamp + interval '5 hours') AT TIME ZONE 'Africa/Johannesburg'
$$;

CREATE OR REPLACE FUNCTION public._ins_prev(p_from date, p_to date)
RETURNS TABLE (prev_from date, prev_to date) LANGUAGE sql IMMUTABLE AS $$
  -- Whole calendar months compare with the same number of months before (October with September);
  -- any other range compares with the same number of days immediately before.
  SELECT CASE WHEN extract(day FROM p_from) = 1 AND p_to + 1 = date_trunc('month', p_to + 1)::date
              THEN (p_from - ((date_part('year', age(p_to + 1, p_from)) * 12 + date_part('month', age(p_to + 1, p_from)))::int
                     * interval '1 month'))::date
              ELSE p_from - (p_to - p_from + 1) END,
         p_from - 1
$$;

-- ── People & attendance ──────────────────────────────────────────────────────────────────
-- Per person, per work day: first clock-in, last clock-out, lateness (5-minute grace) and hours.
CREATE OR REPLACE FUNCTION public._ins_person_days(p_co uuid, p_from date, p_to date, p_branch text, p_dept text)
RETURNS TABLE (employee_id uuid, d date, first_in timestamptz, last_out timestamptz, late boolean, minutes_late int,
               hours numeric, overtime numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH emp AS (
    SELECT e.id, coalesce(t.start_time, time '07:00') st, coalesce(t.end_time, time '16:00') et, coalesce(t.break_minutes, 0) brk
    FROM employees e LEFT JOIN employee_shift_templates t ON t.id = e.shift_template_id
    WHERE e.company_id = p_co AND e.is_active
      AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
  ), pd AS (
    SELECT p.employee_id, ((p.date_time AT TIME ZONE 'Africa/Johannesburg') - interval '5 hours')::date d,
           min(p.date_time) FILTER (WHERE p.type = 'in') first_in, max(p.date_time) FILTER (WHERE p.type = 'out') last_out
    FROM time_punches p JOIN emp ON emp.id = p.employee_id
    WHERE p.company_id = p_co AND p.date_time >= _ins_day_start(p_from) AND p.date_time < _ins_day_start(p_to + 1)
    GROUP BY 1, 2
  )
  SELECT pd.employee_id, pd.d, pd.first_in, pd.last_out,
         coalesce(m.after_start BETWEEN 6 AND 360, false),
         CASE WHEN m.after_start BETWEEN 6 AND 360 THEN m.after_start ELSE 0 END,
         h.hours,
         greatest(h.hours - (extract(epoch FROM (emp.et - emp.st + CASE WHEN emp.et < emp.st THEN interval '24 hours' ELSE interval '0' END)) / 3600
                             - emp.brk / 60.0), 0)::numeric
  FROM pd JOIN emp ON emp.id = pd.employee_id
  -- Minutes between shift start and clock-in, wrapped to 0–1439 so evening/night shifts work too.
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NULL THEN NULL ELSE
           ((extract(epoch FROM ((pd.first_in AT TIME ZONE 'Africa/Johannesburg')::time - emp.st)) / 60)::int + 1440) % 1440 END after_start) m
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NOT NULL AND pd.last_out > pd.first_in
                                       AND pd.last_out - pd.first_in < interval '20 hours'
                                  THEN round((extract(epoch FROM pd.last_out - pd.first_in) / 3600 - emp.brk / 60.0)::numeric, 2)
                                  ELSE 0 END hours) h
  WHERE pd.d BETWEEN p_from AND p_to
$$;

-- Approved leave, one row per person per weekday inside the range.
CREATE OR REPLACE FUNCTION public._ins_leave_days(p_co uuid, p_from date, p_to date, p_branch text, p_dept text)
RETURNS TABLE (employee_id uuid, d date, leave_type text)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT l.employee_id, g::date, l.leave_type
  FROM leave_requests l
  JOIN employees e ON e.id = l.employee_id AND e.is_active
       AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
  CROSS JOIN LATERAL generate_series(greatest(l.start_date, p_from), least(l.end_date, p_to), interval '1 day') g
  WHERE l.company_id = p_co AND l.status = 'approved' AND l.start_date <= p_to AND l.end_date >= p_from
    AND extract(isodow FROM g) < 6
$$;

-- The People numbers for one period (no access check; callers check).
-- Attendance = people present on company work days (Mon–Fri days with at least 20% clocked in),
-- divided by headcount × work days minus approved leave on those days.
CREATE OR REPLACE FUNCTION public._ins_people(p_co uuid, p_from date, p_to date, p_branch text, p_dept text, p_full boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_head int;
BEGIN
  SELECT count(*) INTO v_head FROM employees e
   WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept);
  RETURN (
    WITH pd AS MATERIALIZED (SELECT * FROM _ins_person_days(p_co, p_from, p_to, p_branch, p_dept)),
    ld AS MATERIALIZED (SELECT * FROM _ins_leave_days(p_co, p_from, p_to, p_branch, p_dept)),
    -- A company work day: at least 20% of people clocked in.
    workdays AS (SELECT d FROM pd WHERE extract(isodow FROM d) < 6 GROUP BY d HAVING count(*) >= greatest(1, ceil(v_head * 0.2))),
    k AS (
      SELECT count(*) FILTER (WHERE pd.d IN (SELECT d FROM workdays)) present_days,
             count(*) FILTER (WHERE pd.late) late_days, count(*) all_days,
             coalesce(sum(pd.hours), 0) hours, coalesce(sum(pd.overtime), 0) overtime,
             coalesce(sum(pd.minutes_late), 0) minutes_late
      FROM pd),
    lv AS (SELECT count(*) leave_days, count(*) FILTER (WHERE d IN (SELECT d FROM workdays)) leave_on_workdays FROM ld),
    ex AS (SELECT greatest((SELECT count(*) FROM workdays) * v_head - (SELECT leave_on_workdays FROM lv), 0) expected),
    kp AS (
      SELECT jsonb_build_object(
        'headcount', v_head,
        'work_days', (SELECT count(*) FROM workdays),
        'present_days', k.present_days,
        'expected_days', ex.expected,
        'attendance_rate', CASE WHEN ex.expected > 0 THEN round(least(k.present_days::numeric / ex.expected, 1) * 100, 1) END,
        'absent_days', greatest(ex.expected - k.present_days, 0),
        'late_days', k.late_days,
        'late_rate', CASE WHEN k.all_days > 0 THEN round(k.late_days::numeric / k.all_days * 100, 1) END,
        'avg_minutes_late', CASE WHEN k.late_days > 0 THEN round(k.minutes_late::numeric / k.late_days) END,
        'hours', round(k.hours, 1),
        'overtime_hours', round(k.overtime, 1),
        'leave_days', lv.leave_days) j
      FROM k, lv, ex)
    SELECT CASE WHEN NOT p_full THEN jsonb_build_object('kpis', (SELECT j FROM kp)) ELSE jsonb_build_object(
      'kpis', (SELECT j FROM kp),
      'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('d', d, 'present', present, 'late', late, 'hours', round(hours, 1),
                                                              'overtime', round(overtime, 1)) ORDER BY d)
        FROM (SELECT d, count(*) present, count(*) FILTER (WHERE late) late, sum(hours) hours, sum(overtime) overtime
              FROM pd GROUP BY d) x), '[]'::jsonb),
      'by_department', coalesce((SELECT jsonb_agg(x ORDER BY x.hours DESC) FROM (
         SELECT coalesce(nullif(btrim(e.department), ''), 'No department') AS name, count(DISTINCT e.id) headcount,
                count(pd.employee_id) present_days, count(pd.employee_id) FILTER (WHERE pd.late) late_days,
                round(coalesce(sum(pd.hours), 0), 1) hours, round(coalesce(sum(pd.overtime), 0), 1) overtime
         FROM employees e LEFT JOIN pd ON pd.employee_id = e.id
         WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
         GROUP BY 1) x), '[]'::jsonb),
      'by_branch', coalesce((SELECT jsonb_agg(x ORDER BY x.hours DESC) FROM (
         SELECT coalesce(nullif(btrim(e.branch), ''), 'No site') AS name, count(DISTINCT e.id) headcount,
                count(pd.employee_id) present_days, count(pd.employee_id) FILTER (WHERE pd.late) late_days,
                round(coalesce(sum(pd.hours), 0), 1) hours, round(coalesce(sum(pd.overtime), 0), 1) overtime
         FROM employees e LEFT JOIN pd ON pd.employee_id = e.id
         WHERE e.company_id = p_co AND e.is_active AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)
         GROUP BY 1) x), '[]'::jsonb),
      'leave_by_type', coalesce((SELECT jsonb_agg(jsonb_build_object('type', leave_type, 'days', n) ORDER BY n DESC)
         FROM (SELECT leave_type, count(*) n FROM ld GROUP BY 1) x), '[]'::jsonb),
      'top_late', coalesce((SELECT jsonb_agg(x ORDER BY x.late_days DESC, x.minutes_late DESC) FROM (
         SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department,
                count(*) late_days, sum(pd.minutes_late) minutes_late
         FROM pd JOIN employees e ON e.id = pd.employee_id WHERE pd.late
         GROUP BY 1, 2, 3 ORDER BY 4 DESC, 5 DESC LIMIT 10) x), '[]'::jsonb),
      'top_overtime', coalesce((SELECT jsonb_agg(x ORDER BY x.overtime DESC) FROM (
         SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department,
                round(sum(pd.overtime), 1) overtime
         FROM pd JOIN employees e ON e.id = pd.employee_id
         GROUP BY 1, 2, 3 HAVING sum(pd.overtime) > 0 ORDER BY 4 DESC LIMIT 10) x), '[]'::jsonb)) END);
END $$;

CREATE OR REPLACE FUNCTION public.insights_people(p_company_id uuid, p_from date, p_to date,
  p_branch text DEFAULT NULL, p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pv record;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  RETURN _ins_people(p_company_id, p_from, p_to, nullif(p_branch, ''), nullif(p_department, ''), true) || jsonb_build_object(
    'previous', _ins_people(p_company_id, pv.prev_from, pv.prev_to, nullif(p_branch, ''), nullif(p_department, ''), false) -> 'kpis',
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'on_site_now', (SELECT count(*) FROM (
        SELECT DISTINCT ON (p.employee_id) p.type FROM time_punches p JOIN employees e ON e.id = p.employee_id AND e.is_active
          AND (nullif(p_branch, '') IS NULL OR e.branch = p_branch) AND (nullif(p_department, '') IS NULL OR e.department = p_department)
        WHERE p.company_id = p_company_id AND p.date_time >= now() - interval '16 hours'
        ORDER BY p.employee_id, p.date_time DESC) x WHERE x.type = 'in'),
    'pending_leave', (SELECT count(*) FROM leave_requests WHERE company_id = p_company_id AND status = 'pending'),
    'branches', coalesce((SELECT jsonb_agg(b ORDER BY b) FROM (SELECT DISTINCT branch b FROM employees
        WHERE company_id = p_company_id AND is_active AND btrim(branch) <> '') x), '[]'::jsonb),
    'departments', coalesce((SELECT jsonb_agg(b ORDER BY b) FROM (SELECT DISTINCT department b FROM employees
        WHERE company_id = p_company_id AND is_active AND btrim(department) <> '') x), '[]'::jsonb));
END $$;

-- Attendance register: one row per person for the period.
CREATE OR REPLACE FUNCTION public.insights_attendance_register(p_company_id uuid, p_from date, p_to date,
  p_branch text DEFAULT NULL, p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_head int;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  p_branch := nullif(p_branch, ''); p_department := nullif(p_department, '');
  SELECT count(*) INTO v_head FROM employees e WHERE e.company_id = p_company_id AND e.is_active
    AND (p_branch IS NULL OR e.branch = p_branch) AND (p_department IS NULL OR e.department = p_department);
  RETURN coalesce((
    WITH pd AS MATERIALIZED (SELECT * FROM _ins_person_days(p_company_id, p_from, p_to, p_branch, p_department)),
    ld AS MATERIALIZED (SELECT * FROM _ins_leave_days(p_company_id, p_from, p_to, p_branch, p_department)),
    workdays AS MATERIALIZED (SELECT d FROM pd WHERE extract(isodow FROM d) < 6 GROUP BY d HAVING count(*) >= greatest(1, ceil(v_head * 0.2))),
    per AS (SELECT employee_id, count(*) present_days, count(*) FILTER (WHERE late) late_days, sum(minutes_late) minutes_late,
                   round(sum(hours), 1) hours, round(sum(overtime), 1) overtime FROM pd GROUP BY 1),
    lper AS (SELECT employee_id, count(*) leave_days FROM ld GROUP BY 1),
    absent AS (SELECT e.id employee_id, count(*) absent_days
               FROM employees e CROSS JOIN workdays w
               WHERE e.company_id = p_company_id AND e.is_active
                 AND (p_branch IS NULL OR e.branch = p_branch) AND (p_department IS NULL OR e.department = p_department)
                 AND NOT EXISTS (SELECT 1 FROM pd WHERE pd.employee_id = e.id AND pd.d = w.d)
                 AND NOT EXISTS (SELECT 1 FROM ld WHERE ld.employee_id = e.id AND ld.d = w.d)
               GROUP BY 1)
    SELECT jsonb_agg(x ORDER BY x.name) FROM (
      SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name,
             coalesce(e.employee_number, e.employee_code) AS code, e.department, e.branch,
             coalesce(per.present_days, 0) present_days, coalesce(per.late_days, 0) late_days,
             coalesce(per.minutes_late, 0) minutes_late, coalesce(per.hours, 0) hours, coalesce(per.overtime, 0) overtime,
             coalesce(lper.leave_days, 0) leave_days, coalesce(absent.absent_days, 0) absent_days
      FROM employees e
      LEFT JOIN per ON per.employee_id = e.id LEFT JOIN lper ON lper.employee_id = e.id LEFT JOIN absent ON absent.employee_id = e.id
      WHERE e.company_id = p_company_id AND e.is_active
        AND (p_branch IS NULL OR e.branch = p_branch) AND (p_department IS NULL OR e.department = p_department)
    ) x), '[]'::jsonb);
END $$;

-- Late arrivals: every late clock-in in the period (newest first, up to 2,000).
CREATE OR REPLACE FUNCTION public.insights_late_arrivals(p_company_id uuid, p_from date, p_to date,
  p_branch text DEFAULT NULL, p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.d DESC, x.minutes_late DESC) FROM (
    SELECT pd.d, e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department, e.branch,
           to_char(coalesce(t.start_time, time '07:00'), 'HH24:MI') AS shift_start,
           to_char(pd.first_in AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') AS clocked_in, pd.minutes_late
    FROM _ins_person_days(p_company_id, p_from, p_to, nullif(p_branch, ''), nullif(p_department, '')) pd
    JOIN employees e ON e.id = pd.employee_id
    LEFT JOIN employee_shift_templates t ON t.id = e.shift_template_id
    WHERE pd.late ORDER BY pd.d DESC, pd.minutes_late DESC LIMIT 2000) x), '[]'::jsonb);
END $$;

-- ── Jobs & operations ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ins_jobs(p_co uuid, p_from date, p_to date, p_full boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v jsonb; f timestamptz := _ins_day_start(p_from) - interval '5 hours'; t timestamptz := _ins_day_start(p_to + 1) - interval '5 hours';
BEGIN
  WITH opened AS (SELECT * FROM jobs WHERE company_id = p_co AND coalesce(opened_at, created_at) >= f AND coalesce(opened_at, created_at) < t),
  done AS (SELECT * FROM jobs WHERE company_id = p_co AND status = 'completed' AND closed_at >= f AND closed_at < t)
  SELECT jsonb_build_object(
    'opened', (SELECT count(*) FROM opened),
    'completed', (SELECT count(*) FROM done),
    'cancelled', (SELECT count(*) FROM jobs WHERE company_id = p_co AND status = 'cancelled' AND closed_at >= f AND closed_at < t),
    'avg_days_to_complete', (SELECT round(avg(extract(epoch FROM closed_at - coalesce(opened_at, created_at)) / 86400)::numeric, 1) FROM done),
    'avg_hours_to_respond', (SELECT round(avg(extract(epoch FROM first_response_at - coalesce(opened_at, created_at)) / 3600)::numeric, 1)
                               FROM opened WHERE first_response_at IS NOT NULL AND first_response_at >= coalesce(opened_at, created_at)),
    'on_time_rate', (SELECT CASE WHEN count(*) FILTER (WHERE scheduled_end IS NOT NULL) > 0 THEN
                        round(count(*) FILTER (WHERE closed_at <= scheduled_end)::numeric / count(*) FILTER (WHERE scheduled_end IS NOT NULL) * 100, 1) END FROM done),
    'callback_rate', (SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE is_callback)::numeric / count(*) * 100, 1) END FROM opened),
    'completed_value', (SELECT coalesce(sum(coalesce(nullif(actual_cost, 0), estimated_cost)), 0) FROM done))
  INTO v;
  IF NOT p_full THEN RETURN jsonb_build_object('kpis', v); END IF;
  RETURN jsonb_build_object('kpis', v,
    'weekly', coalesce((SELECT jsonb_agg(jsonb_build_object('week', w, 'opened', o, 'completed', c) ORDER BY w) FROM (
        SELECT w, sum(o) o, sum(c) c FROM (
          SELECT date_trunc('week', coalesce(opened_at, created_at) AT TIME ZONE 'Africa/Johannesburg')::date w, 1 o, 0 c
            FROM jobs WHERE company_id = p_co AND coalesce(opened_at, created_at) >= f AND coalesce(opened_at, created_at) < t
          UNION ALL
          SELECT date_trunc('week', closed_at AT TIME ZONE 'Africa/Johannesburg')::date, 0, 1
            FROM jobs WHERE company_id = p_co AND status = 'completed' AND closed_at >= f AND closed_at < t) u GROUP BY w) x), '[]'::jsonb),
    'by_client', coalesce((SELECT jsonb_agg(x ORDER BY x.opened DESC) FROM (
        SELECT coalesce(c.name, 'No client') AS name, count(*) opened, count(*) FILTER (WHERE j.status = 'completed') completed,
               round(coalesce(sum(j.estimated_cost), 0)::numeric, 2) value
        FROM jobs j LEFT JOIN clients c ON c.id = j.client_id
        WHERE j.company_id = p_co AND coalesce(j.opened_at, j.created_at) >= f AND coalesce(j.opened_at, j.created_at) < t
        GROUP BY 1 ORDER BY 2 DESC LIMIT 12) x), '[]'::jsonb),
    'by_service', coalesce((SELECT jsonb_agg(x ORDER BY x.opened DESC) FROM (
        SELECT coalesce(s.name, 'Not set') AS name, count(*) opened, count(*) FILTER (WHERE j.status = 'completed') completed
        FROM jobs j LEFT JOIN job_services s ON s.id = j.service_id
        WHERE j.company_id = p_co AND coalesce(j.opened_at, j.created_at) >= f AND coalesce(j.opened_at, j.created_at) < t
        GROUP BY 1) x), '[]'::jsonb),
    'by_priority', coalesce((SELECT jsonb_agg(x ORDER BY x.opened DESC) FROM (
        SELECT coalesce(nullif(j.priority, ''), 'none') AS name, count(*) opened,
               round(avg(extract(epoch FROM j.closed_at - coalesce(j.opened_at, j.created_at)) / 86400)
                     FILTER (WHERE j.status = 'completed' AND j.closed_at IS NOT NULL)::numeric, 1) avg_days
        FROM jobs j WHERE j.company_id = p_co AND coalesce(j.opened_at, j.created_at) >= f AND coalesce(j.opened_at, j.created_at) < t
        GROUP BY 1) x), '[]'::jsonb),
    'by_technician', coalesce((SELECT jsonb_agg(x ORDER BY x.completed DESC) FROM (
        SELECT e.id employee_id, trim(e.name || ' ' || coalesce(e.surname, '')) AS name, e.department, count(*) completed,
               round(avg(extract(epoch FROM j.closed_at - coalesce(j.opened_at, j.created_at)) / 86400)::numeric, 1) avg_days,
               count(*) FILTER (WHERE j.is_callback) callbacks,
               round(coalesce(sum(coalesce(nullif(j.actual_cost, 0), j.estimated_cost)), 0)::numeric, 2) value
        FROM jobs j JOIN employees e ON e.id = j.assignee_employee_id
        WHERE j.company_id = p_co AND j.status = 'completed' AND j.closed_at >= f AND j.closed_at < t
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 25) x), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.insights_jobs(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pv record;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  RETURN _ins_jobs(p_company_id, p_from, p_to, true) || jsonb_build_object(
    'previous', _ins_jobs(p_company_id, pv.prev_from, pv.prev_to, false) -> 'kpis',
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'open_now', (SELECT count(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress')),
    'unassigned_now', (SELECT count(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress')
                        AND assignee_employee_id IS NULL AND cardinality(assigned_employee_ids) = 0),
    'overdue_now', (SELECT count(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress')
                     AND scheduled_end < now()),
    'status_now', coalesce((SELECT jsonb_agg(jsonb_build_object('name', status, 'count', n) ORDER BY n DESC) FROM (
        SELECT status, count(*) n FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress')
        GROUP BY 1) x), '[]'::jsonb));
END $$;

-- Completed jobs list for the job completion report (newest first, up to 5,000).
CREATE OR REPLACE FUNCTION public.insights_jobs_completed(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f timestamptz := _ins_day_start(p_from) - interval '5 hours'; t timestamptz := _ins_day_start(p_to + 1) - interval '5 hours';
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.closed DESC) FROM (
    SELECT j.id, j.job_code AS code, j.title, c.name AS client, s.name AS service, j.priority,
           trim(e.name || ' ' || coalesce(e.surname, '')) AS technician,
           (coalesce(j.opened_at, j.created_at) AT TIME ZONE 'Africa/Johannesburg')::date AS opened,
           (j.closed_at AT TIME ZONE 'Africa/Johannesburg')::date AS closed,
           round((extract(epoch FROM j.closed_at - coalesce(j.opened_at, j.created_at)) / 86400)::numeric, 1) AS days,
           CASE WHEN j.scheduled_end IS NULL THEN NULL ELSE j.closed_at <= j.scheduled_end END AS on_time,
           j.is_callback AS callback, round(coalesce(nullif(j.actual_cost, 0), j.estimated_cost)::numeric, 2) AS value
    FROM jobs j LEFT JOIN clients c ON c.id = j.client_id LEFT JOIN job_services s ON s.id = j.service_id
    LEFT JOIN employees e ON e.id = j.assignee_employee_id
    WHERE j.company_id = p_company_id AND j.status = 'completed' AND j.closed_at >= f AND j.closed_at < t
    ORDER BY j.closed_at DESC LIMIT 5000) x), '[]'::jsonb);
END $$;

-- ── Sales & money ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ins_money(p_co uuid, p_from date, p_to date, p_full boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v jsonb; f timestamptz := _ins_day_start(p_from) - interval '5 hours'; t timestamptz := _ins_day_start(p_to + 1) - interval '5 hours';
BEGIN
  WITH inv AS (SELECT * FROM finance_invoices WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to
                 AND status NOT IN ('draft', 'cancelled', 'voided') AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')),
  q AS (SELECT * FROM commercial_quotes WHERE company_id = p_co)
  SELECT jsonb_build_object(
    'quotes_sent', (SELECT count(*) FROM q WHERE sent_at >= f AND sent_at < t),
    'quotes_sent_value', (SELECT coalesce(sum(total_amount), 0) FROM q WHERE sent_at >= f AND sent_at < t),
    'quotes_won', (SELECT count(*) FROM q WHERE accepted_at >= f AND accepted_at < t),
    'quotes_won_value', (SELECT coalesce(sum(total_amount), 0) FROM q WHERE accepted_at >= f AND accepted_at < t),
    'quotes_lost', (SELECT count(*) FROM q WHERE declined_at >= f AND declined_at < t),
    'win_rate', (SELECT CASE WHEN count(*) > 0 THEN round(count(*) FILTER (WHERE accepted_at IS NOT NULL)::numeric / count(*) * 100, 1) END
                   FROM q WHERE (accepted_at >= f AND accepted_at < t) OR (declined_at >= f AND declined_at < t)),
    'invoiced', (SELECT coalesce(sum(total_amount), 0) FROM inv),
    'invoices', (SELECT count(*) FROM inv),
    'collected', (SELECT coalesce(sum(amount), 0) FROM finance_transactions WHERE company_id = p_co AND transaction_type = 'invoice'
                    AND direction = 'incoming' AND source_table = 'finance_invoices' AND transaction_date BETWEEN p_from AND p_to),
    'avg_days_to_pay', (SELECT round(avg(paid_date - issue_date)::numeric, 1) FROM finance_invoices WHERE company_id = p_co
                          AND status = 'paid' AND paid_date BETWEEN p_from AND p_to AND paid_date >= issue_date))
  INTO v;
  IF NOT p_full THEN RETURN jsonb_build_object('kpis', v); END IF;
  RETURN jsonb_build_object('kpis', v,
    'monthly', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'invoiced', i, 'collected', c, 'won', w) ORDER BY m) FROM (
        SELECT m, sum(i) i, sum(c) c, sum(w) w FROM (
          SELECT date_trunc('month', issue_date)::date m, total_amount i, 0 c, 0 w FROM finance_invoices
            WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to AND status NOT IN ('draft', 'cancelled', 'voided')
              AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')
          UNION ALL SELECT date_trunc('month', transaction_date)::date, 0, amount, 0 FROM finance_transactions
            WHERE company_id = p_co AND transaction_type = 'invoice' AND direction = 'incoming' AND source_table = 'finance_invoices'
              AND transaction_date BETWEEN p_from AND p_to
          UNION ALL SELECT date_trunc('month', accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, 0, 0, total_amount FROM commercial_quotes
            WHERE company_id = p_co AND accepted_at >= f AND accepted_at < t) u GROUP BY m) x), '[]'::jsonb),
    'weekly', coalesce((SELECT jsonb_agg(jsonb_build_object('week', m, 'invoiced', i, 'collected', c, 'won', w) ORDER BY m) FROM (
        SELECT m, sum(i) i, sum(c) c, sum(w) w FROM (
          SELECT date_trunc('week', issue_date)::date m, total_amount i, 0 c, 0 w FROM finance_invoices
            WHERE company_id = p_co AND issue_date BETWEEN p_from AND p_to AND status NOT IN ('draft', 'cancelled', 'voided')
              AND coalesce(invoice_type, 'standard') NOT IN ('rent', 'stay')
          UNION ALL SELECT date_trunc('week', transaction_date)::date, 0, amount, 0 FROM finance_transactions
            WHERE company_id = p_co AND transaction_type = 'invoice' AND direction = 'incoming' AND source_table = 'finance_invoices'
              AND transaction_date BETWEEN p_from AND p_to
          UNION ALL SELECT date_trunc('week', accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, 0, 0, total_amount FROM commercial_quotes
            WHERE company_id = p_co AND accepted_at >= f AND accepted_at < t) u GROUP BY m) x), '[]'::jsonb),
    'by_client', coalesce((SELECT jsonb_agg(x ORDER BY x.invoiced DESC) FROM (
        SELECT coalesce(c.name, 'No client') AS name, round(sum(i.total_amount), 2) invoiced, count(*) invoices,
               round(sum(i.amount_paid), 2) paid
        FROM finance_invoices i LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.company_id = p_co AND i.issue_date BETWEEN p_from AND p_to AND i.status NOT IN ('draft', 'cancelled', 'voided')
          AND coalesce(i.invoice_type, 'standard') NOT IN ('rent', 'stay')
        GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x), '[]'::jsonb),
    'quote_status', coalesce((SELECT jsonb_agg(jsonb_build_object('name', status, 'count', n, 'value', qv) ORDER BY n DESC) FROM (
        SELECT status, count(*) n, round(sum(total_amount), 2) qv FROM commercial_quotes
        WHERE company_id = p_co AND created_at >= f AND created_at < t GROUP BY 1) x), '[]'::jsonb),
    'lost_reasons', coalesce((SELECT jsonb_agg(jsonb_build_object('name', r, 'count', n) ORDER BY n DESC) FROM (
        SELECT coalesce(nullif(trim(declined_reason), ''), 'No reason given') r, count(*) n FROM commercial_quotes
        WHERE company_id = p_co AND declined_at >= f AND declined_at < t GROUP BY 1) x), '[]'::jsonb));
END $$;

-- Who owes what right now, by how late (customer invoices; rent and stays have their own screens).
CREATE OR REPLACE FUNCTION public._ins_ageing(p_co uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH o AS (
    SELECT i.client_id, i.balance_due b, current_date - coalesce(i.due_date, i.issue_date) late
    FROM finance_invoices i
    WHERE i.company_id = p_co AND i.status IN ('sent', 'viewed', 'partially_paid', 'overdue') AND i.balance_due > 0.009
      AND coalesce(i.invoice_type, 'standard') NOT IN ('rent', 'stay'))
  SELECT jsonb_build_object(
    'outstanding', coalesce((SELECT sum(b) FROM o), 0),
    'overdue', coalesce((SELECT sum(b) FROM o WHERE late > 0), 0),
    'buckets', jsonb_build_array(
      jsonb_build_object('name', 'Not yet due', 'amount', coalesce((SELECT sum(b) FROM o WHERE late <= 0), 0)),
      jsonb_build_object('name', '1–30 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 1 AND 30), 0)),
      jsonb_build_object('name', '31–60 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 31 AND 60), 0)),
      jsonb_build_object('name', '61–90 days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late BETWEEN 61 AND 90), 0)),
      jsonb_build_object('name', '90+ days', 'amount', coalesce((SELECT sum(b) FROM o WHERE late > 90), 0))),
    'debtors', coalesce((SELECT jsonb_agg(x ORDER BY x.total DESC) FROM (
      SELECT c.id client_id, coalesce(c.name, 'No client') AS name, round(sum(b), 2) total,
             round(coalesce(sum(b) FILTER (WHERE late <= 0), 0), 2) current,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 1 AND 30), 0), 2) d30,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 31 AND 60), 0), 2) d60,
             round(coalesce(sum(b) FILTER (WHERE late BETWEEN 61 AND 90), 0), 2) d90,
             round(coalesce(sum(b) FILTER (WHERE late > 90), 0), 2) d90plus,
             count(*) invoices, max(late) oldest_days
      FROM o LEFT JOIN clients c ON c.id = o.client_id GROUP BY 1, 2) x), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.insights_money(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pv record;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  RETURN _ins_money(p_company_id, p_from, p_to, true) || jsonb_build_object(
    'previous', _ins_money(p_company_id, pv.prev_from, pv.prev_to, false) -> 'kpis',
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'ageing', _ins_ageing(p_company_id),
    'pipeline_now', (SELECT coalesce(sum(total_amount), 0) FROM commercial_quotes WHERE company_id = p_company_id
                       AND status IN ('sent', 'viewed') AND (valid_until IS NULL OR valid_until >= current_date)));
END $$;

-- ── Payroll ──────────────────────────────────────────────────────────────────────────────
-- Payslips whose pay period ENDS inside the range (the old report needed the whole period inside it,
-- so a 1–31 October payslip never showed in "last 30 days"; counting overlap instead double-counted
-- a month next to the range). Each payslip belongs to the month its period ends.
CREATE OR REPLACE FUNCTION public._ins_payroll(p_co uuid, p_from date, p_to date, p_branch text, p_dept text, p_full boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH pay AS MATERIALIZED (
    SELECT p.employee_id, p.period_end, p.status, p.gross_pay::numeric gross, p.net_pay::numeric net, p.deductions::numeric deductions,
           p.overtime_pay::numeric overtime_pay, p.overtime_hours::numeric overtime_hours,
           coalesce(nullif(btrim(e.department), ''), 'No department') department, coalesce(nullif(btrim(e.branch), ''), 'No site') branch
    FROM payment_approvals p JOIN employees e ON e.id = p.employee_id
    WHERE p.company_id = p_co AND p.status <> 'rejected' AND p.period_end BETWEEN p_from AND p_to
      AND (p_branch IS NULL OR e.branch = p_branch) AND (p_dept IS NULL OR e.department = p_dept)),
  k AS (SELECT jsonb_build_object(
    'gross', round(coalesce(sum(gross), 0), 2), 'net', round(coalesce(sum(net), 0), 2),
    'deductions', round(coalesce(sum(deductions), 0), 2), 'overtime_pay', round(coalesce(sum(overtime_pay), 0), 2),
    'overtime_hours', round(coalesce(sum(overtime_hours), 0), 1), 'payslips', count(*), 'people', count(DISTINCT employee_id),
    'avg_gross', CASE WHEN count(*) > 0 THEN round(sum(gross) / count(*), 2) END,
    'pending', count(*) FILTER (WHERE status = 'pending'), 'approved', count(*) FILTER (WHERE status = 'approved'),
    'paid', count(*) FILTER (WHERE status = 'paid')) j FROM pay)
  SELECT CASE WHEN NOT p_full THEN jsonb_build_object('kpis', (SELECT j FROM k)) ELSE jsonb_build_object(
    'kpis', (SELECT j FROM k),
    'monthly', coalesce((SELECT jsonb_agg(jsonb_build_object('month', m, 'gross', g, 'net', n, 'deductions', dd, 'overtime_pay', o, 'people', pp) ORDER BY m) FROM (
        SELECT date_trunc('month', period_end)::date m, round(sum(gross), 2) g, round(sum(net), 2) n, round(sum(deductions), 2) dd,
               round(sum(overtime_pay), 2) o, count(DISTINCT employee_id) pp FROM pay GROUP BY 1) x), '[]'::jsonb),
    'by_department', coalesce((SELECT jsonb_agg(x ORDER BY x.gross DESC) FROM (
        SELECT department AS name, count(DISTINCT employee_id) people, round(sum(gross), 2) gross, round(sum(net), 2) net,
               round(sum(overtime_pay), 2) overtime_pay, round(sum(overtime_hours), 1) overtime_hours
        FROM pay GROUP BY 1) x), '[]'::jsonb),
    'by_branch', coalesce((SELECT jsonb_agg(x ORDER BY x.gross DESC) FROM (
        SELECT branch AS name, count(DISTINCT employee_id) people, round(sum(gross), 2) gross, round(sum(overtime_pay), 2) overtime_pay
        FROM pay GROUP BY 1) x), '[]'::jsonb)) END
$$;

CREATE OR REPLACE FUNCTION public.insights_payroll(p_company_id uuid, p_from date, p_to date,
  p_branch text DEFAULT NULL, p_department text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pv record;
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  RETURN _ins_payroll(p_company_id, p_from, p_to, nullif(p_branch, ''), nullif(p_department, ''), true) || jsonb_build_object(
    'previous', _ins_payroll(p_company_id, pv.prev_from, pv.prev_to, nullif(p_branch, ''), nullif(p_department, ''), false) -> 'kpis',
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'branches', coalesce((SELECT jsonb_agg(b ORDER BY b) FROM (SELECT DISTINCT branch b FROM employees
        WHERE company_id = p_company_id AND is_active AND btrim(branch) <> '') x), '[]'::jsonb),
    'departments', coalesce((SELECT jsonb_agg(b ORDER BY b) FROM (SELECT DISTINCT department b FROM employees
        WHERE company_id = p_company_id AND is_active AND btrim(department) <> '') x), '[]'::jsonb));
END $$;

-- ── Insights home ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insights_home(p_company_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pv record; v_people jsonb; v_jobs jsonb; v_money jsonb; v_pay jsonb;
  f timestamptz := _ins_day_start(p_from) - interval '5 hours'; t timestamptz := _ins_day_start(p_to + 1) - interval '5 hours';
BEGIN
  PERFORM public._reports_office(p_company_id);
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN RAISE EXCEPTION 'BAD_RANGE'; END IF;
  SELECT * INTO pv FROM _ins_prev(p_from, p_to);
  v_people := _ins_people(p_company_id, p_from, p_to, NULL, NULL, true);
  v_jobs := _ins_jobs(p_company_id, p_from, p_to, true);
  v_money := _ins_money(p_company_id, p_from, p_to, true);
  v_pay := _ins_payroll(p_company_id, p_from, p_to, NULL, NULL, true);
  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', pv.prev_from, 'prev_to', pv.prev_to),
    'people', jsonb_build_object('kpis', v_people -> 'kpis', 'daily', v_people -> 'daily', 'by_department', v_people -> 'by_department',
       'previous', _ins_people(p_company_id, pv.prev_from, pv.prev_to, NULL, NULL, false) -> 'kpis'),
    'jobs', jsonb_build_object('kpis', v_jobs -> 'kpis', 'weekly', v_jobs -> 'weekly', 'by_client', v_jobs -> 'by_client',
       'previous', _ins_jobs(p_company_id, pv.prev_from, pv.prev_to, false) -> 'kpis',
       'open_now', (SELECT count(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress')),
       'overdue_now', (SELECT count(*) FROM jobs WHERE company_id = p_company_id AND status IN ('open', 'scheduled', 'in_progress') AND scheduled_end < now())),
    'money', jsonb_build_object('kpis', v_money -> 'kpis', 'monthly', v_money -> 'monthly',
       'previous', _ins_money(p_company_id, pv.prev_from, pv.prev_to, false) -> 'kpis', 'ageing', _ins_ageing(p_company_id) - 'debtors'),
    'payroll', jsonb_build_object('kpis', v_pay -> 'kpis', 'monthly', v_pay -> 'monthly',
       'previous', _ins_payroll(p_company_id, pv.prev_from, pv.prev_to, NULL, NULL, false) -> 'kpis'),
    'incidents', jsonb_build_object(
       'reported', (SELECT count(*) FROM incident_reports WHERE company_id = p_company_id AND occurred_at >= f AND occurred_at < t),
       'previous', (SELECT count(*) FROM incident_reports WHERE company_id = p_company_id
                      AND occurred_at >= _ins_day_start(pv.prev_from) - interval '5 hours' AND occurred_at < f),
       'open_now', (SELECT count(*) FROM incident_reports WHERE company_id = p_company_id AND NOT is_closed),
       'by_severity', coalesce((SELECT jsonb_agg(jsonb_build_object('name', severity, 'count', n) ORDER BY n DESC) FROM (
          SELECT severity, count(*) n FROM incident_reports WHERE company_id = p_company_id AND occurred_at >= f AND occurred_at < t
          GROUP BY 1) x), '[]'::jsonb)),
    'on_site_now', (SELECT count(*) FROM (
        SELECT DISTINCT ON (p.employee_id) p.type FROM time_punches p JOIN employees e ON e.id = p.employee_id AND e.is_active
        WHERE p.company_id = p_company_id AND p.date_time >= now() - interval '16 hours'
        ORDER BY p.employee_id, p.date_time DESC) x WHERE x.type = 'in'));
END $$;

-- Permissions (run separately): _ins_* → no direct calls (revoked from PUBLIC, anon, authenticated);
-- insights_* → revoked from PUBLIC and anon, granted to authenticated.
