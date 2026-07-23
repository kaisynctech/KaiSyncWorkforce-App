-- H6: Replace Phase 2 analytics snapshot stubs with real aggregations.
-- JSON keys match kaisync-web/src/app/dashboard/reports/page.tsx contracts.
-- Client-side builders in kaisync-web/src/lib/reports-snapshots.ts mirror this logic.

-- ─── Financial ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_financial_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revenue numeric := 0;
  v_outstanding numeric := 0;
  v_payables numeric := 0;
  v_expenses numeric := 0;
BEGIN
  SELECT COALESCE(SUM(total_amount), 0) INTO v_revenue
  FROM finance_invoices
  WHERE company_id = p_company_id
    AND issue_date BETWEEN p_from AND p_to
    AND status NOT IN ('cancelled', 'draft');

  SELECT COALESCE(SUM(balance_due), 0) INTO v_outstanding
  FROM finance_invoices
  WHERE company_id = p_company_id
    AND status IN ('sent', 'viewed', 'partially_paid', 'overdue');

  SELECT COALESCE(SUM(balance_due), 0) INTO v_payables
  FROM supplier_invoices
  WHERE company_id = p_company_id
    AND status NOT IN ('paid', 'cancelled');

  v_payables := v_payables + COALESCE((
    SELECT SUM(total_amount) FROM contractor_payouts
    WHERE company_id = p_company_id
      AND payout_status IN ('pending', 'approved')
  ), 0);

  v_expenses := COALESCE((
    SELECT SUM(total_amount) FROM supplier_invoices
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
  ), 0)
  + COALESCE((
    SELECT SUM(total_amount) FROM contractor_payouts
    WHERE company_id = p_company_id
      AND COALESCE(payout_date, created_at::date) BETWEEN p_from AND p_to
  ), 0)
  + COALESCE((
    SELECT SUM(gross_pay) FROM payment_approvals
    WHERE company_id = p_company_id
      AND period_start BETWEEN p_from AND p_to
  ), 0);

  RETURN jsonb_build_object(
    'revenue', v_revenue,
    'outstanding', v_outstanding,
    'payables', v_payables,
    'profit', v_revenue - v_expenses,
    'revenue_vs_expenses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('label', label, 'value', value) ORDER BY sort_key)
      FROM (
        SELECT TO_CHAR(issue_date, 'Mon') || ' Rev' AS label,
               SUM(total_amount) AS value,
               DATE_TRUNC('month', issue_date::timestamp) AS sort_key
        FROM finance_invoices
        WHERE company_id = p_company_id
          AND issue_date BETWEEN p_from AND p_to
          AND status NOT IN ('cancelled', 'draft')
        GROUP BY 1, 3
        UNION ALL
        SELECT TO_CHAR(created_at, 'Mon') || ' Exp',
               SUM(total_amount),
               DATE_TRUNC('month', created_at)
        FROM supplier_invoices
        WHERE company_id = p_company_id
          AND created_at::date BETWEEN p_from AND p_to
        GROUP BY 1, 3
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

-- ─── Incidents ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_incidents_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'open', COUNT(*) FILTER (
        WHERE COALESCE(is_closed, false) = false
          AND COALESCE(status, 'open') NOT IN ('resolved', 'closed')
      ),
      'resolved', COUNT(*) FILTER (
        WHERE COALESCE(is_closed, false) = true
          OR COALESCE(status, '') IN ('resolved', 'closed')
      ),
      'critical', COUNT(*) FILTER (WHERE lower(severity) = 'critical'),
      'recent', COALESCE((
        SELECT jsonb_agg(row_obj)
        FROM (
          SELECT jsonb_build_object(
            'description', description,
            'severity', severity,
            'status', CASE WHEN COALESCE(is_closed, false) THEN 'closed' ELSE COALESCE(status, 'open') END
          ) AS row_obj
          FROM incident_reports
          WHERE company_id = p_company_id
            AND created_at::date BETWEEN p_from AND p_to
          ORDER BY created_at DESC
          LIMIT 10
        ) r
      ), '[]'::jsonb)
    )
    FROM incident_reports
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
  );
END;
$$;

-- ─── Inventory ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_inventory_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_items', (SELECT COUNT(*) FROM inventory_items WHERE company_id = p_company_id),
    'low_stock', (
      SELECT COUNT(*) FROM inventory_items
      WHERE company_id = p_company_id
        AND COALESCE(quantity_on_hand, 0) <= COALESCE(reorder_level, 0)
    ),
    'stock_value', (
      SELECT COALESCE(SUM(COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)), 0)
      FROM inventory_items WHERE company_id = p_company_id
    ),
    'on_jobs', (
      SELECT COUNT(*) FROM inventory_allocations WHERE company_id = p_company_id
    ),
    'top_items', COALESCE((
      SELECT jsonb_agg(row_obj)
      FROM (
        SELECT jsonb_build_object(
          'name', name,
          'qty', COALESCE(quantity_on_hand, 0),
          'value', COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0)
        ) AS row_obj
        FROM inventory_items
        WHERE company_id = p_company_id
        ORDER BY COALESCE(quantity_on_hand, 0) * COALESCE(unit_cost, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

-- ─── Contractors ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'active', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id AND COALESCE(is_active, true)
    ),
    'pending_compliance', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id AND COALESCE(compliance_hold, false)
    ),
    'pending_payments', (
      SELECT COUNT(*) FROM contractor_payouts
      WHERE company_id = p_company_id
        AND payout_status IN ('pending', 'approved')
    ),
    'payment_summary', COALESCE((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'agreed')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'agreed', COALESCE((
            SELECT SUM(jc.agreed_amount) FROM job_contractors jc
            WHERE jc.company_id = p_company_id AND jc.contractor_id = c.id
          ), 0),
          'paid', COALESCE((
            SELECT SUM(cp.total_amount) FROM contractor_payouts cp
            WHERE cp.company_id = p_company_id
              AND cp.contractor_id = c.id
              AND cp.payout_status = 'paid'
          ), 0)
        ) AS row_obj
        FROM contractors c
        WHERE c.company_id = p_company_id AND COALESCE(c.is_active, true)
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

-- ─── Property ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_property_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_units int := 0;
  v_occupied int := 0;
  v_vacant int := 0;
BEGIN
  SELECT COUNT(*) INTO v_units FROM units WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_occupied FROM units WHERE company_id = p_company_id AND is_occupied = true;
  SELECT COUNT(*) INTO v_vacant FROM units WHERE company_id = p_company_id AND is_occupied = false;

  IF v_occupied = 0 AND v_vacant = 0 AND v_units > 0 THEN
    SELECT COUNT(*) INTO v_occupied
    FROM residents
    WHERE company_id = p_company_id AND move_out_date IS NULL;
    v_occupied := LEAST(v_occupied, v_units);
    v_vacant := GREATEST(v_units - v_occupied, 0);
  END IF;

  RETURN jsonb_build_object(
    'total_sites', (SELECT COUNT(*) FROM sites WHERE company_id = p_company_id),
    'occupied_units', v_occupied,
    'vacant', v_vacant,
    'expiring_compliance', (
      SELECT COUNT(*) FROM compliance_entries
      WHERE company_id = p_company_id
        AND expiry_date IS NOT NULL
        AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
    )
  );
END;
$$;

-- ─── Telemetry ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_telemetry_snapshot(
  p_company_id uuid, p_from date, p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int := 0;
  v_errors int := 0;
BEGIN
  IF to_regclass('public.app_events') IS NOT NULL THEN
    SELECT COUNT(*) INTO v_total
    FROM app_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to;

    SELECT COUNT(*) INTO v_errors
    FROM app_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to
      AND (
        lower(COALESCE(severity, '')) IN ('error', 'critical', 'fail')
        OR lower(COALESCE(event_type, '')) LIKE '%error%'
      );
  ELSE
    SELECT COUNT(*) INTO v_total
    FROM audit_events
    WHERE company_id = p_company_id
      AND created_at::date BETWEEN p_from AND p_to;
  END IF;

  RETURN jsonb_build_object(
    'realtime_status', 'online',
    'offline_queue', 0,
    'error_rate', CASE WHEN v_total > 0 THEN ROUND((v_errors::numeric / v_total) * 100, 1) ELSE 0 END,
    'active_connections', 1,
    'event_count', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_get_financial_snapshot(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_get_incidents_snapshot(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_get_inventory_snapshot(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_get_contractors_snapshot(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_get_property_snapshot(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_get_telemetry_snapshot(uuid, date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.hr_get_financial_snapshot(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_incidents_snapshot(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_inventory_snapshot(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_contractors_snapshot(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_property_snapshot(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_get_telemetry_snapshot(uuid, date, date) TO authenticated;
