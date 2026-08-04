-- Projects (client_deals) ops: Action Centre, activity feed, reports snapshot.
-- Mirrors 20260804160000_clients_action_centre_activity_snapshot.sql for the Projects HR module.

-- ── Activity index + feed ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_app_events_project_id
  ON public.app_events ( (meta->>'project_id') )
  WHERE meta IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_project_activity_feed(
  p_company_id uuid,
  p_project_id uuid,
  p_limit int DEFAULT 200
)
RETURNS SETOF public.app_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.app_events
  WHERE company_id = p_company_id
    AND meta @> jsonb_build_object('project_id', p_project_id::text)
    AND level IN ('info', 'warning')
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) IS
  'Returns project-specific app_events newest-first for HR Project Details → Activity.';

-- ── Action Centre ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_project_action_items(
  p_company_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'projects.view');

  RETURN coalesce((
    SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
    FROM (
      -- Overdue AR tied to a project
      SELECT
        fi.id::text                  AS ref_id,
        fi.project_id::text          AS project_id,
        d.title                      AS project_title,
        coalesce(d.project_code, '') AS project_code,
        'invoice_overdue'            AS action_type,
        coalesce(fi.invoice_number, 'Invoice') ||
          ' · balance R' || to_char(coalesce(fi.balance_due, 0), 'FM999999990.00') AS summary,
        fi.balance_due               AS amount,
        fi.status                    AS status,
        coalesce(fi.due_date::timestamptz, fi.created_at) AS created_at,
        1                            AS priority
      FROM public.finance_invoices fi
      JOIN public.client_deals d ON d.id = fi.project_id AND d.company_id = fi.company_id
      WHERE fi.company_id = p_company_id
        AND fi.project_id IS NOT NULL
        AND (fi.status = 'overdue' OR (fi.due_date IS NOT NULL AND fi.due_date < CURRENT_DATE))
        AND coalesce(fi.balance_due, 0) > 0

      UNION ALL

      -- Deposit required but not yet fully paid
      SELECT
        d.id::text                   AS ref_id,
        d.id::text                   AS project_id,
        d.title                      AS project_title,
        coalesce(d.project_code, '') AS project_code,
        'deposit_due'                AS action_type,
        'Deposit R' || to_char(d.deposit_required, 'FM999999990.00') ||
          ' outstanding (paid R' || to_char(coalesce(d.amount_paid, 0), 'FM999999990.00') || ')' AS summary,
        (d.deposit_required - coalesce(d.amount_paid, 0)) AS amount,
        d.status                     AS status,
        coalesce(d.updated_at, d.created_at) AS created_at,
        2                            AS priority
      FROM public.client_deals d
      WHERE d.company_id = p_company_id
        AND d.deposit_required > 0
        AND coalesce(d.amount_paid, 0) < d.deposit_required
        AND d.status NOT IN ('lost', 'won')

      UNION ALL

      -- Quotation ready to send (draft with an offer, never sent)
      SELECT
        d.id::text                   AS ref_id,
        d.id::text                   AS project_id,
        d.title                      AS project_title,
        coalesce(d.project_code, '') AS project_code,
        'quotation_pending'          AS action_type,
        'Quotation ready to send · R' || to_char(coalesce(d.offer_amount, 0), 'FM999999990.00') AS summary,
        d.offer_amount               AS amount,
        d.status                     AS status,
        coalesce(d.updated_at, d.created_at) AS created_at,
        3                            AS priority
      FROM public.client_deals d
      WHERE d.company_id = p_company_id
        AND d.status = 'draft'
        AND coalesce(d.offer_amount, 0) > 0
        AND d.quotation_sent_at IS NULL

      UNION ALL

      -- Deals with no activity in 14+ days while still in an active stage
      SELECT
        d.id::text                   AS ref_id,
        d.id::text                   AS project_id,
        d.title                      AS project_title,
        coalesce(d.project_code, '') AS project_code,
        'deal_stale'                 AS action_type,
        'No activity for ' || extract(day FROM now() - coalesce(d.updated_at, d.created_at))::int ||
          ' days · ' || replace(d.status, '_', ' ') AS summary,
        d.offer_amount               AS amount,
        d.status                     AS status,
        coalesce(d.updated_at, d.created_at) AS created_at,
        4                            AS priority
      FROM public.client_deals d
      WHERE d.company_id = p_company_id
        AND d.status IN ('sent', 'negotiation', 'in_progress')
        AND coalesce(d.updated_at, d.created_at) < now() - INTERVAL '14 days'

      UNION ALL

      -- Recent portal messages from clients on a deal thread (last 14 days, latest per project)
      SELECT
        msg.ref_id,
        msg.project_id,
        msg.project_title,
        msg.project_code,
        msg.action_type,
        msg.summary,
        msg.amount,
        msg.status,
        msg.created_at,
        msg.priority
      FROM (
        SELECT DISTINCT ON (d2.id)
          m.id::text                   AS ref_id,
          d2.id::text                  AS project_id,
          d2.title                     AS project_title,
          coalesce(d2.project_code, '') AS project_code,
          'portal_message'             AS action_type,
          left(coalesce(m.body, 'Portal message'), 80) AS summary,
          NULL::numeric                AS amount,
          'message'                    AS status,
          m.created_at                 AS created_at,
          2                            AS priority
        FROM public.app_messages m
        JOIN public.message_threads t ON t.id = m.thread_id
        JOIN public.client_deals d2 ON t.subject = 'Deal:' || d2.id::text AND d2.company_id = m.company_id
        WHERE m.company_id = p_company_id
          AND m.sender_client_id IS NOT NULL
          AND m.created_at >= now() - INTERVAL '14 days'
        ORDER BY d2.id, m.created_at DESC
      ) msg
    ) a
  ), '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_get_project_action_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_project_action_items(uuid) TO authenticated;

COMMENT ON FUNCTION public.hr_get_project_action_items(uuid) IS
  'HR Projects Action Centre: overdue invoices, deposits due, quotations to send, stale deals, recent portal messages.';

-- ── Reports snapshot ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_projects_snapshot(
  p_company_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'projects.view');

  RETURN jsonb_build_object(
    'total', (
      SELECT COUNT(*) FROM public.client_deals WHERE company_id = p_company_id
    ),
    'active', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress')
    ),
    'draft', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'draft'
    ),
    'won', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'won'
    ),
    'lost', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id AND status = 'lost'
    ),
    'pipeline_value', (
      SELECT coalesce(SUM(offer_amount), 0) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress')
    ),
    'outstanding_balance', (
      SELECT coalesce(SUM(balance_due), 0) FROM public.finance_invoices
      WHERE company_id = p_company_id
        AND project_id IS NOT NULL
        AND status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(balance_due, 0) > 0
    ),
    'top_projects', coalesce((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'offer_amount')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', d.title,
          'offer_amount', coalesce(d.offer_amount, 0),
          'status', d.status
        ) AS row_obj
        FROM public.client_deals d
        WHERE d.company_id = p_company_id
        ORDER BY d.offer_amount DESC NULLS LAST
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_get_projects_snapshot(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_projects_snapshot(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.hr_get_projects_snapshot(uuid, date, date) IS
  'HR Reports → Projects snapshot KPIs.';
