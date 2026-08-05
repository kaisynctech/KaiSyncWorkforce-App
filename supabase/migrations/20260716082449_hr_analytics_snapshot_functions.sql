
-- ─── Phase 1: Executive snapshot ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_executive_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_employees', (
      SELECT COUNT(*) FROM employees
      WHERE company_id = p_company_id AND is_active = true
    ),
    'on_site_today', (
      -- Employees with an 'in' punch today that has no subsequent 'out'
      SELECT COUNT(DISTINCT tp_in.employee_id)
      FROM time_punches tp_in
      WHERE tp_in.company_id = p_company_id
        AND tp_in.type = 'in'
        AND tp_in.date_time::date = CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM time_punches tp_out
          WHERE tp_out.employee_id  = tp_in.employee_id
            AND tp_out.company_id   = tp_in.company_id
            AND tp_out.type         = 'out'
            AND tp_out.date_time    > tp_in.date_time
        )
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id AND status IN ('open','in_progress')
    ),
    'pending_leave', (
      SELECT COUNT(*) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'pending'
    ),
    'total_hours', (
      -- Pair each 'in' with its nearest subsequent 'out' for the period
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (
          (SELECT tp_out.date_time
           FROM time_punches tp_out
           WHERE tp_out.employee_id = tp_in.employee_id
             AND tp_out.company_id  = tp_in.company_id
             AND tp_out.type        = 'out'
             AND tp_out.date_time   > tp_in.date_time
           ORDER BY tp_out.date_time LIMIT 1)
          - tp_in.date_time
        )) / 3600
      ), 0)
      FROM time_punches tp_in
      WHERE tp_in.company_id = p_company_id
        AND tp_in.type = 'in'
        AND tp_in.date_time::date BETWEEN p_from AND p_to
    ),
    'total_payroll', (
      SELECT COALESCE(SUM(gross_pay), 0) FROM payment_approvals
      WHERE company_id = p_company_id
        AND period_start >= p_from AND period_end <= p_to
    ),
    'revenue_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', month_label, 'value', total))
      FROM (
        SELECT TO_CHAR(period_start, 'Mon') AS month_label,
               SUM(gross_pay) AS total
        FROM payment_approvals
        WHERE company_id = p_company_id
          AND period_start >= p_from AND period_end <= p_to
        GROUP BY TO_CHAR(period_start, 'Mon'), DATE_TRUNC('month', period_start)
        ORDER BY DATE_TRUNC('month', period_start)
      ) t
    ),
    'attendance_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', day_label, 'value', cnt))
      FROM (
        SELECT TO_CHAR(date_time::date, 'DD Mon') AS day_label,
               COUNT(DISTINCT employee_id) AS cnt
        FROM time_punches
        WHERE company_id = p_company_id
          AND type = 'in'
          AND date_time::date BETWEEN p_from AND p_to
        GROUP BY date_time::date
        ORDER BY date_time::date
        LIMIT 30
      ) t
    )
  ) INTO v;
  RETURN v;
END;
$$;

-- ─── Phase 1: Payroll snapshot ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_payroll_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'total_gross',        COALESCE(SUM(gross_pay), 0),
      'total_net',          COALESCE(SUM(net_pay), 0),
      'total_deductions',   COALESCE(SUM(deductions), 0),
      'total_hours',        COALESCE(SUM(COALESCE(regular_hours, 0) + COALESCE(overtime_hours, 0)), 0),
      'payslip_count',      COUNT(*),
      'approved_count',     COUNT(*) FILTER (WHERE status = 'approved'),
      'draft_count',        COUNT(*) FILTER (WHERE status = 'pending'),
      'payroll_by_employee', (
        SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'gross')::numeric DESC)
        FROM (
          SELECT jsonb_build_object(
            'employee_name', e.name || ' ' || e.surname,
            'gross',  p.gross_pay,
            'net',    p.net_pay,
            'hours',  COALESCE(p.regular_hours, 0) + COALESCE(p.overtime_hours, 0)
          ) AS row_obj
          FROM payment_approvals p
          JOIN employees e ON e.id = p.employee_id
          WHERE p.company_id  = p_company_id
            AND p.period_start >= p_from
            AND p.period_end   <= p_to
          LIMIT 10
        ) sub
      )
    )
    FROM payment_approvals
    WHERE company_id  = p_company_id
      AND period_start >= p_from
      AND period_end   <= p_to
  );
END;
$$;

-- ─── Phase 1: Workforce snapshot ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_workforce_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_employees', (
      SELECT COUNT(*) FROM employees
      WHERE company_id = p_company_id AND is_active = true
    ),
    'by_access_level', (
      SELECT jsonb_object_agg(access_level, cnt)
      FROM (
        SELECT access_level, COUNT(*) AS cnt
        FROM employees
        WHERE company_id = p_company_id AND is_active = true
        GROUP BY access_level
      ) t
    ),
    'leave_days_taken', (
      SELECT COALESCE(SUM(days_requested), 0) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'approved'
        AND start_date >= p_from AND end_date <= p_to
    ),
    'leave_pending', (
      SELECT COUNT(*) FROM leave_requests
      WHERE company_id = p_company_id AND status = 'pending'
    ),
    'attendance_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT date_time::date::text AS d, COUNT(DISTINCT employee_id) AS cnt
        FROM time_punches
        WHERE company_id = p_company_id
          AND type = 'in'
          AND date_time::date BETWEEN p_from AND p_to
        GROUP BY date_time::date
        ORDER BY date_time::date
        LIMIT 30
      ) t
    ),
    'leave_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', m, 'value', cnt))
      FROM (
        SELECT TO_CHAR(start_date, 'Mon YYYY') AS m, COUNT(*) AS cnt
        FROM leave_requests
        WHERE company_id = p_company_id AND status = 'approved'
          AND start_date >= p_from AND end_date <= p_to
        GROUP BY TO_CHAR(start_date, 'Mon YYYY'), DATE_TRUNC('month', start_date)
        ORDER BY DATE_TRUNC('month', start_date)
      ) t
    )
  );
END;
$$;

-- ─── Phase 1: Operational snapshot ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_operational_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'completed_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND status = 'completed'
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM jobs
      WHERE company_id = p_company_id
        AND status IN ('open','in_progress')
    ),
    'total_incidents', (
      SELECT COUNT(*) FROM incident_reports
      WHERE company_id = p_company_id
        AND created_at::date BETWEEN p_from AND p_to
    ),
    'completion_trend', (
      SELECT jsonb_agg(jsonb_build_object('label', d, 'value', cnt))
      FROM (
        SELECT closed_at::date::text AS d, COUNT(*) AS cnt
        FROM jobs
        WHERE company_id = p_company_id
          AND status = 'completed'
          AND closed_at IS NOT NULL
          AND closed_at::date BETWEEN p_from AND p_to
        GROUP BY closed_at::date
        ORDER BY closed_at::date
        LIMIT 30
      ) t
    )
  );
END;
$$;

-- ─── Phase 2 stubs (return empty object — no crashes on those tabs) ───────────
CREATE OR REPLACE FUNCTION public.hr_get_financial_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_incidents_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_inventory_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_property_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.hr_get_telemetry_snapshot(
  p_company_id uuid, p_from date, p_to date
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
;
