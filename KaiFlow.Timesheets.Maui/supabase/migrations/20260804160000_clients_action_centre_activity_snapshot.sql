-- Clients ops: Action Centre, activity feed, reports snapshot.

-- ── Activity index + feed ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_app_events_client_id
  ON public.app_events ( (meta->>'client_id') )
  WHERE meta IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_client_activity_feed(
  p_company_id uuid,
  p_client_id uuid,
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
    AND meta @> jsonb_build_object('client_id', p_client_id::text)
    AND level IN ('info', 'warning')
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_client_activity_feed(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_client_activity_feed(uuid, uuid, int) TO authenticated;

COMMENT ON FUNCTION public.get_client_activity_feed(uuid, uuid, int) IS
  'Returns client-specific app_events newest-first for HR Client Details → Activity.';

-- ── Action Centre ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_client_action_items(
  p_company_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'clients.view');

  RETURN coalesce((
    SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
    FROM (
      -- Outstanding / overdue AR
      SELECT
        fi.id::text              AS ref_id,
        fi.client_id::text       AS client_id,
        c.name                   AS client_name,
        coalesce(c.client_code, '') AS client_code,
        CASE
          WHEN fi.status = 'overdue' OR (fi.due_date IS NOT NULL AND fi.due_date < CURRENT_DATE)
            THEN 'invoice_overdue'
          ELSE 'invoice_outstanding'
        END                      AS action_type,
        coalesce(fi.invoice_number, 'Invoice') ||
          ' · balance R' || to_char(coalesce(fi.balance_due, 0), 'FM999999990.00') AS summary,
        fi.balance_due           AS amount,
        fi.status                AS status,
        coalesce(fi.due_date::timestamptz, fi.created_at) AS created_at,
        CASE
          WHEN fi.status = 'overdue' OR (fi.due_date IS NOT NULL AND fi.due_date < CURRENT_DATE)
            THEN 1 ELSE 2
        END                      AS priority
      FROM public.finance_invoices fi
      JOIN public.clients c ON c.id = fi.client_id AND c.company_id = fi.company_id
      WHERE fi.company_id = p_company_id
        AND fi.client_id IS NOT NULL
        AND fi.status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(fi.balance_due, 0) > 0

      UNION ALL

      -- Deals awaiting response
      SELECT
        d.id::text               AS ref_id,
        d.client_id::text        AS client_id,
        c.name                   AS client_name,
        coalesce(c.client_code, '') AS client_code,
        'deal_attention'         AS action_type,
        coalesce(d.title, 'Project') || ' · ' || replace(coalesce(d.status, ''), '_', ' ') AS summary,
        d.offer_amount           AS amount,
        d.status                 AS status,
        coalesce(d.updated_at, d.created_at) AS created_at,
        3                        AS priority
      FROM public.client_deals d
      JOIN public.clients c ON c.id = d.client_id AND c.company_id = d.company_id
      WHERE d.company_id = p_company_id
        AND d.client_id IS NOT NULL
        AND d.status IN ('sent', 'negotiation')

      UNION ALL

      -- Recent portal messages from clients (last 14 days, latest per client)
      SELECT
        msg.ref_id,
        msg.client_id,
        msg.client_name,
        msg.client_code,
        msg.action_type,
        msg.summary,
        msg.amount,
        msg.status,
        msg.created_at,
        msg.priority
      FROM (
        SELECT DISTINCT ON (m.sender_client_id)
          m.id::text               AS ref_id,
          m.sender_client_id::text AS client_id,
          c.name                   AS client_name,
          coalesce(c.client_code, '') AS client_code,
          'portal_message'         AS action_type,
          left(coalesce(m.body, 'Portal message'), 80) AS summary,
          NULL::numeric            AS amount,
          'message'                AS status,
          m.created_at             AS created_at,
          2                        AS priority
        FROM public.app_messages m
        JOIN public.clients c ON c.id = m.sender_client_id AND c.company_id = m.company_id
        WHERE m.company_id = p_company_id
          AND m.sender_client_id IS NOT NULL
          AND m.created_at >= now() - INTERVAL '14 days'
        ORDER BY m.sender_client_id, m.created_at DESC
      ) msg
    ) a
  ), '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_get_client_action_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_client_action_items(uuid) TO authenticated;

COMMENT ON FUNCTION public.hr_get_client_action_items(uuid) IS
  'HR Clients Action Centre: outstanding invoices, deals needing attention, recent portal messages.';

-- ── Reports snapshot ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_clients_snapshot(
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
  PERFORM public.require_user_permission(p_company_id, 'clients.view');

  RETURN jsonb_build_object(
    'total', (
      SELECT COUNT(*) FROM public.clients WHERE company_id = p_company_id
    ),
    'portal_enabled', (
      SELECT COUNT(*) FROM public.clients
      WHERE company_id = p_company_id AND coalesce(portal_enabled, false)
    ),
    'active_deals', (
      SELECT COUNT(*) FROM public.client_deals
      WHERE company_id = p_company_id
        AND status IN ('sent', 'negotiation', 'in_progress', 'won')
    ),
    'open_jobs', (
      SELECT COUNT(*) FROM public.jobs
      WHERE company_id = p_company_id
        AND status IN ('open', 'scheduled', 'in_progress')
        AND client_id IS NOT NULL
    ),
    'outstanding_balance', (
      SELECT coalesce(SUM(balance_due), 0) FROM public.finance_invoices
      WHERE company_id = p_company_id
        AND client_id IS NOT NULL
        AND status IN ('sent', 'viewed', 'partially_paid', 'overdue')
        AND coalesce(balance_due, 0) > 0
    ),
    'top_clients', coalesce((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'balance')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'balance', coalesce((
            SELECT SUM(fi.balance_due) FROM public.finance_invoices fi
            WHERE fi.company_id = p_company_id
              AND fi.client_id = c.id
              AND coalesce(fi.balance_due, 0) > 0
          ), 0),
          'jobs', coalesce((
            SELECT COUNT(*) FROM public.jobs j
            WHERE j.company_id = p_company_id AND j.client_id = c.id
          ), 0)
        ) AS row_obj
        FROM public.clients c
        WHERE c.company_id = p_company_id
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_get_clients_snapshot(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hr_get_clients_snapshot(uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.hr_get_clients_snapshot(uuid, date, date) IS
  'HR Reports → Clients snapshot KPIs.';
