-- Insights: people/attendance reports ~2.5–4× faster (Ironvale, 6 months: people 1.6 s → 0.62 s,
-- overview 1.75 s → 0.74 s, attendance register 1.5 s → 0.41 s, late arrivals 1.5 s → 0.35 s).
-- Cause: _ins_person_days was a SQL function with SET search_path, so it was never inlined and ran a
-- cached generic plan. Now plpgsql with dynamic SQL, planned per call; results identical (checked
-- row-for-row against the old version: 38 662 person-days, 0 differences).
-- (_ins_person_days_v2 was the side-by-side copy used for that check; it is not called by anything.)

CREATE OR REPLACE FUNCTION public._ins_person_days(p_co uuid, p_from date, p_to date, p_branch text, p_dept text)
RETURNS TABLE (employee_id uuid, d date, first_in timestamptz, last_out timestamptz, late boolean, minutes_late int,
               hours numeric, overtime numeric)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_lo timestamptz := _ins_day_start(p_from); v_hi timestamptz := _ins_day_start(p_to + 1);
BEGIN
  -- Dynamic SQL so each call is planned for its own company and dates (the cached generic plan of the
  -- old SQL version took about 4x longer).
  RETURN QUERY EXECUTE $q$
  WITH emp AS MATERIALIZED (
    SELECT e.id, coalesce(t.start_time, time '07:00') st, coalesce(t.end_time, time '16:00') et, coalesce(t.break_minutes, 0) brk
    FROM employees e LEFT JOIN employee_shift_templates t ON t.id = e.shift_template_id
    WHERE e.company_id = $1 AND e.is_active
      AND ($4::text IS NULL OR e.branch = $4) AND ($5::text IS NULL OR e.department = $5)
  ), pd AS MATERIALIZED (
    SELECT p.employee_id, ((p.date_time AT TIME ZONE 'Africa/Johannesburg') - interval '5 hours')::date d,
           min(p.date_time) FILTER (WHERE p.type = 'in') first_in, max(p.date_time) FILTER (WHERE p.type = 'out') last_out
    FROM time_punches p
    WHERE p.company_id = $1 AND p.date_time >= $2 AND p.date_time < $3
      AND p.employee_id IN (SELECT id FROM emp)
    GROUP BY 1, 2
  )
  SELECT pd.employee_id, pd.d, pd.first_in, pd.last_out,
         coalesce(m.after_start BETWEEN 6 AND 360, false),
         CASE WHEN m.after_start BETWEEN 6 AND 360 THEN m.after_start ELSE 0 END,
         h.hours,
         greatest(h.hours - (extract(epoch FROM (emp.et - emp.st + CASE WHEN emp.et < emp.st THEN interval '24 hours' ELSE interval '0' END)) / 3600
                             - emp.brk / 60.0), 0)::numeric
  FROM pd JOIN emp ON emp.id = pd.employee_id
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NULL THEN NULL ELSE
           ((extract(epoch FROM ((pd.first_in AT TIME ZONE 'Africa/Johannesburg')::time - emp.st)) / 60)::int + 1440) % 1440 END after_start) m
  CROSS JOIN LATERAL (SELECT CASE WHEN pd.first_in IS NOT NULL AND pd.last_out > pd.first_in
                                       AND pd.last_out - pd.first_in < interval '20 hours'
                                  THEN round((extract(epoch FROM pd.last_out - pd.first_in) / 3600 - emp.brk / 60.0)::numeric, 2)
                                  ELSE 0 END hours) h
  $q$ USING p_co, v_lo, v_hi, p_branch, p_dept;
END $$;
