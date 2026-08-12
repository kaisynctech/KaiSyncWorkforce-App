-- ============================================================
-- KaiSync Commercial Engine — Phase 6: Intelligence
-- 2026-08-11
--
-- Adds: cash flow forecast view, client payment intelligence
--       view, quote win/loss analytics view.
--
-- No new tables — pure analytical views built on Phases 1–5 data.
-- All views return empty sets gracefully when data is sparse.
-- ============================================================


-- ============================================================
-- 1. CASH FLOW FORECAST VIEW
--    12-week rolling projection per company.
--    Inflows: outstanding invoices + upcoming milestone invoices
--    Outflows: approved POs + unpaid supplier invoices
-- ============================================================
CREATE OR REPLACE VIEW public.cash_flow_forecast AS
WITH weeks AS (
  SELECT
    gs AS week_offset,
    date_trunc('week', CURRENT_DATE)::date
      + (gs * 7) AS week_start,
    (date_trunc('week', CURRENT_DATE)::date + (gs * 7) + 6) AS week_end
  FROM generate_series(0, 11) AS gs
),

invoice_inflows AS (
  SELECT
    fi.company_id,
    date_trunc('week', fi.due_date)::date AS week_start,
    SUM(fi.balance_due)                   AS amount
  FROM public.finance_invoices fi
  WHERE fi.status IN ('sent', 'partial')
    AND fi.balance_due > 0
    AND fi.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 84
  GROUP BY fi.company_id, date_trunc('week', fi.due_date)::date
),

milestone_inflows AS (
  SELECT
    pm.company_id,
    date_trunc('week', pm.due_date)::date AS week_start,
    SUM(
      CASE WHEN pm.invoice_percentage > 0
        THEN ROUND(cd.offer_amount * pm.invoice_percentage / 100, 2)
        ELSE pm.invoice_amount
      END
    ) AS amount
  FROM public.project_milestones pm
  JOIN public.client_deals cd ON cd.id = pm.deal_id
  WHERE pm.status IN ('pending', 'in_progress')
    AND pm.triggers_invoice
    AND pm.invoice_id IS NULL    -- not yet invoiced
    AND pm.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 84
  GROUP BY pm.company_id, date_trunc('week', pm.due_date)::date
),

po_outflows AS (
  SELECT
    po.company_id,
    date_trunc('week', po.required_delivery_date)::date AS week_start,
    SUM(po.total_amount - po.amount_received_value)     AS amount
  FROM public.purchase_orders po
  WHERE po.status IN ('approved', 'sent', 'partially_received')
    AND po.required_delivery_date IS NOT NULL
    AND po.required_delivery_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 84
  GROUP BY po.company_id, date_trunc('week', po.required_delivery_date)::date
),

supplier_outflows AS (
  SELECT
    si.company_id,
    date_trunc('week', si.due_date)::date AS week_start,
    SUM(si.balance_due)                   AS amount
  FROM public.supplier_invoices si
  WHERE si.status IN ('received', 'approved')
    AND si.balance_due > 0
    AND si.due_date IS NOT NULL
    AND si.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 84
  GROUP BY si.company_id, date_trunc('week', si.due_date)::date
)

SELECT
  c.id                                                           AS company_id,
  w.week_offset,
  w.week_start,
  w.week_end,
  to_char(w.week_start, 'DD Mon')                                AS week_label,
  COALESCE(ii.amount, 0) + COALESCE(mi.amount, 0)               AS projected_inflow,
  COALESCE(po.amount, 0) + COALESCE(si.amount, 0)               AS projected_outflow,
  (COALESCE(ii.amount, 0) + COALESCE(mi.amount, 0))
    - (COALESCE(po.amount, 0) + COALESCE(si.amount, 0))         AS net_cash_flow,
  COALESCE(ii.amount, 0)                                         AS invoice_inflow,
  COALESCE(mi.amount, 0)                                         AS milestone_inflow,
  COALESCE(po.amount, 0)                                         AS po_outflow,
  COALESCE(si.amount, 0)                                         AS supplier_invoice_outflow
FROM public.companies c
CROSS JOIN weeks w
LEFT JOIN invoice_inflows   ii ON ii.company_id = c.id AND ii.week_start = w.week_start
LEFT JOIN milestone_inflows mi ON mi.company_id = c.id AND mi.week_start = w.week_start
LEFT JOIN po_outflows        po ON po.company_id = c.id AND po.week_start = w.week_start
LEFT JOIN supplier_outflows  si ON si.company_id = c.id AND si.week_start = w.week_start
ORDER BY c.id, w.week_start;


-- ============================================================
-- 2. CLIENT PAYMENT INTELLIGENCE VIEW
--    Per-client payment behaviour metrics.
--    Reliability score: 0–100 (100 = always pays on time)
-- ============================================================
CREATE OR REPLACE VIEW public.client_payment_intelligence AS
SELECT
  fi.company_id,
  fi.client_id,
  c.name                                                          AS client_name,
  COUNT(*)                                                        AS total_invoices,
  COUNT(*) FILTER (WHERE fi.status = 'paid')                     AS paid_invoices,
  COUNT(*) FILTER (WHERE fi.status IN ('sent','partial')
    AND fi.balance_due > 0)                                       AS outstanding_invoices,
  COUNT(*) FILTER (WHERE fi.status IN ('sent','partial')
    AND fi.due_date < CURRENT_DATE AND fi.balance_due > 0)       AS overdue_invoices,
  COALESCE(SUM(fi.total_amount), 0)                              AS total_invoiced,
  COALESCE(SUM(fi.amount_paid), 0)                               AS total_paid,
  COALESCE(SUM(fi.balance_due), 0)                               AS total_outstanding,
  COALESCE(SUM(fi.balance_due) FILTER (
    WHERE fi.due_date < CURRENT_DATE AND fi.balance_due > 0), 0) AS overdue_amount,

  -- Average days from issue_date to paid_date
  ROUND(AVG(fi.paid_date - fi.issue_date)
    FILTER (WHERE fi.paid_date IS NOT NULL), 1)                   AS avg_days_to_pay,

  -- Average days early/late (negative = early, positive = late)
  ROUND(AVG(fi.paid_date - fi.due_date)
    FILTER (WHERE fi.paid_date IS NOT NULL), 1)                   AS avg_days_vs_due,

  -- On-time payment rate %
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE fi.paid_date IS NOT NULL AND fi.paid_date <= fi.due_date)
    / NULLIF(COUNT(*) FILTER (WHERE fi.paid_date IS NOT NULL), 0),
    1
  )                                                               AS on_time_rate_percent,

  -- Payment reliability score 0–100
  -- 100 = always on time, deducted for late payments proportionally
  CASE
    WHEN COUNT(*) FILTER (WHERE fi.paid_date IS NOT NULL) = 0 THEN NULL
    ELSE GREATEST(0, LEAST(100, ROUND(
      100.0
      * COUNT(*) FILTER (WHERE fi.paid_date IS NOT NULL AND fi.paid_date <= fi.due_date)
      / NULLIF(COUNT(*) FILTER (WHERE fi.paid_date IS NOT NULL), 0)
    , 0)))
  END                                                             AS reliability_score,

  -- Risk flag
  CASE
    WHEN COUNT(*) FILTER (WHERE fi.status IN ('sent','partial')
      AND fi.due_date < CURRENT_DATE AND fi.balance_due > 0) > 1  THEN 'high'
    WHEN COUNT(*) FILTER (WHERE fi.status IN ('sent','partial')
      AND fi.due_date < CURRENT_DATE AND fi.balance_due > 0) = 1  THEN 'medium'
    WHEN ROUND(
      100.0 * COUNT(*) FILTER (
        WHERE fi.paid_date IS NOT NULL AND fi.paid_date <= fi.due_date)
      / NULLIF(COUNT(*) FILTER (WHERE fi.paid_date IS NOT NULL), 0),
      1
    ) < 70                                                         THEN 'medium'
    ELSE 'low'
  END                                                             AS payment_risk

FROM public.finance_invoices fi
LEFT JOIN public.clients c ON c.id = fi.client_id
WHERE fi.status NOT IN ('draft', 'void')
GROUP BY fi.company_id, fi.client_id, c.name;


-- ============================================================
-- 3. QUOTE WIN/LOSS SUMMARY VIEW
--    Conversion analytics per company.
-- ============================================================
CREATE OR REPLACE VIEW public.quote_win_loss_summary AS
SELECT
  company_id,
  COUNT(*)                                                        AS total_quotes,
  COUNT(*) FILTER (WHERE status NOT IN ('draft'))                 AS total_sent_or_decided,
  COUNT(*) FILTER (WHERE status = 'sent')                        AS currently_open,
  COUNT(*) FILTER (WHERE status = 'accepted')                    AS total_won,
  COUNT(*) FILTER (WHERE status = 'declined')                    AS total_lost,

  -- Win rate (accepted / (accepted + declined))
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'accepted')
    / NULLIF(COUNT(*) FILTER (WHERE status IN ('accepted','declined')), 0),
    1
  )                                                               AS win_rate_percent,

  -- Quote values
  ROUND(AVG(total_amount), 2)                                     AS avg_quote_value,
  ROUND(AVG(total_amount) FILTER (WHERE status = 'accepted'), 2) AS avg_won_value,
  ROUND(AVG(total_amount) FILTER (WHERE status = 'declined'), 2) AS avg_lost_value,
  COALESCE(SUM(total_amount) FILTER (WHERE status = 'accepted'), 0) AS total_won_value,
  COALESCE(SUM(total_amount) FILTER (WHERE status = 'sent'), 0)     AS pipeline_value,

  -- Average days to decision (sent → accepted or declined)
  ROUND(AVG(
    CASE
      WHEN accepted_at IS NOT NULL AND sent_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM accepted_at - sent_at) / 86400
      WHEN declined_at IS NOT NULL AND sent_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM declined_at - sent_at) / 86400
    END
  ), 1)                                                           AS avg_days_to_decision,

  -- Average margin on won quotes
  ROUND(AVG(gross_margin_percent) FILTER (WHERE status = 'accepted'), 1)
                                                                  AS avg_won_margin_percent

FROM public.commercial_quotes
GROUP BY company_id;


-- ============================================================
-- 4. PROJECT COST VARIANCE VIEW
--    Early warning: projects trending over estimated cost
-- ============================================================
CREATE OR REPLACE VIEW public.project_cost_variance AS
SELECT
  d.id                                                            AS deal_id,
  d.company_id,
  d.title,
  d.status,
  d.offer_amount                                                  AS contract_value,
  d.estimated_cost,
  d.committed_cost,
  d.actual_cost,

  -- Variance: actual vs estimated
  CASE WHEN d.estimated_cost > 0
    THEN ROUND((d.actual_cost - d.estimated_cost) / d.estimated_cost * 100, 1)
    ELSE NULL
  END                                                             AS cost_overrun_percent,

  -- Burn rate: how much of estimated cost is committed
  CASE WHEN d.estimated_cost > 0
    THEN ROUND(d.committed_cost / d.estimated_cost * 100, 1)
    ELSE NULL
  END                                                             AS commitment_rate_percent,

  -- Projected final margin (if actual_cost stays on current trajectory)
  CASE WHEN d.offer_amount > 0
    THEN ROUND((d.offer_amount - GREATEST(d.actual_cost, d.committed_cost))
      / d.offer_amount * 100, 1)
    ELSE NULL
  END                                                             AS projected_margin_percent,

  -- Risk level
  CASE
    WHEN d.estimated_cost > 0
      AND (d.actual_cost - d.estimated_cost) / d.estimated_cost > 0.10  THEN 'high'
    WHEN d.estimated_cost > 0
      AND (d.actual_cost - d.estimated_cost) / d.estimated_cost > 0.05  THEN 'medium'
    ELSE 'low'
  END                                                             AS cost_risk,

  -- How much of the project has been invoiced
  COALESCE((
    SELECT SUM(total_amount)
    FROM public.finance_invoices fi
    WHERE fi.deal_id = d.id AND fi.status NOT IN ('draft', 'void')
  ), 0)                                                           AS total_invoiced,

  d.progress_percent,
  d.site_start_date,
  d.expected_completion_date

FROM public.client_deals d
WHERE d.status IN ('in_progress', 'won');


-- ============================================================
-- 5. INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_finance_inv_due_date   ON public.finance_invoices(company_id, due_date) WHERE status IN ('sent','partial');
CREATE INDEX IF NOT EXISTS idx_finance_inv_paid_date  ON public.finance_invoices(company_id, paid_date) WHERE paid_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_inv_due       ON public.supplier_invoices(company_id, due_date) WHERE status IN ('received','approved');
CREATE INDEX IF NOT EXISTS idx_po_delivery_date       ON public.purchase_orders(company_id, required_delivery_date) WHERE status IN ('approved','sent','partially_received');
CREATE INDEX IF NOT EXISTS idx_milestones_due_date    ON public.project_milestones(company_id, due_date) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_quotes_status          ON public.commercial_quotes(company_id, status);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
