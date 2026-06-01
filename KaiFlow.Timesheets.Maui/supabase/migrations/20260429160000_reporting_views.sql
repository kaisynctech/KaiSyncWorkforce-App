-- ============================================================
-- BI reporting views — power Power BI / Metabase / Looker etc.
-- All views are scoped by company_id via underlying RLS so HR users
-- only see their own company's rows. A future bi_reader role with
-- BYPASSRLS can be added per-customer if cross-company aggregation
-- is ever needed.
-- ============================================================

-- 1. Foundation: every job enriched with computed SLA & cost metrics
CREATE OR REPLACE VIEW public.v_jobs_enriched AS
SELECT
  j.id                                AS job_id,
  j.company_id,
  j.title,
  j.description,
  j.status,
  j.priority,
  j.opened_at,
  j.first_response_at,
  j.closed_at,
  j.scheduled_start,
  j.scheduled_end,
  j.estimated_cost,
  j.actual_cost,
  j.is_callback,
  j.is_preventive,
  j.parent_job_id,
  j.external_ref,

  j.site_id,
  s.name                              AS site_name,
  s.address                           AS site_address,

  j.unit_id,
  u.unit_number                       AS unit_number,

  j.client_id,
  c.name                              AS client_name,

  j.issue_category_id,
  ic.name                             AS issue_category_name,
  ic.slug                             AS issue_category_slug,

  j.assignee_employee_id,
  emp_a.name || ' ' || emp_a.surname  AS assignee_name,
  j.contractor_employee_id,
  emp_c.name || ' ' || emp_c.surname  AS contractor_name,
  emp_c.worker_type                   AS contractor_worker_type,

  j.reporter_resident_id,
  r.full_name                         AS reporter_name,

  CASE
    WHEN j.status IN ('completed','cancelled') THEN 'closed'
    ELSE 'open'
  END                                 AS open_or_closed,

  st.response_minutes                 AS sla_response_minutes,
  st.resolution_hours                 AS sla_resolution_hours,

  CASE
    WHEN j.first_response_at IS NOT NULL AND j.opened_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.first_response_at - j.opened_at)) / 60.0
  END                                 AS actual_response_minutes,

  CASE
    WHEN j.closed_at IS NOT NULL AND j.opened_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (j.closed_at - j.opened_at)) / 3600.0
  END                                 AS actual_resolution_hours,

  CASE
    WHEN st.response_minutes IS NULL THEN NULL
    WHEN j.first_response_at IS NULL THEN false
    WHEN EXTRACT(EPOCH FROM (j.first_response_at - j.opened_at)) / 60.0 <= st.response_minutes THEN true
    ELSE false
  END                                 AS sla_response_met,

  CASE
    WHEN st.resolution_hours IS NULL OR j.closed_at IS NULL THEN NULL
    WHEN EXTRACT(EPOCH FROM (j.closed_at - j.opened_at)) / 3600.0 <= st.resolution_hours THEN true
    ELSE false
  END                                 AS sla_resolution_met,

  COALESCE(j.actual_cost, 0) - COALESCE(j.estimated_cost, 0)
                                      AS cost_variance,
  CASE
    WHEN j.estimated_cost IS NULL OR j.estimated_cost = 0 THEN NULL
    ELSE (COALESCE(j.actual_cost,0) - j.estimated_cost) / j.estimated_cost * 100
  END                                 AS cost_variance_pct,

  date_trunc('month', COALESCE(j.opened_at, j.scheduled_start))::date AS month_bucket,
  date_trunc('week',  COALESCE(j.opened_at, j.scheduled_start))::date AS week_bucket,
  EXTRACT(YEAR  FROM COALESCE(j.opened_at, j.scheduled_start))::int   AS year_int

FROM public.jobs j
LEFT JOIN public.sites              s     ON s.id    = j.site_id
LEFT JOIN public.units              u     ON u.id    = j.unit_id
LEFT JOIN public.clients            c     ON c.id    = j.client_id
LEFT JOIN public.issue_categories   ic    ON ic.id   = j.issue_category_id
LEFT JOIN public.employees          emp_a ON emp_a.id = j.assignee_employee_id
LEFT JOIN public.employees          emp_c ON emp_c.id = j.contractor_employee_id
LEFT JOIN public.residents          r     ON r.id    = j.reporter_resident_id
LEFT JOIN LATERAL (
  SELECT response_minutes, resolution_hours
  FROM public.sla_targets st_inner
  WHERE st_inner.id = j.sla_target_id
     OR (j.sla_target_id IS NULL
         AND st_inner.priority = j.priority
         AND st_inner.company_id = j.company_id)
  LIMIT 1
) st ON true;
-- 2. Page 1: Maintenance Overview (per company, monthly)
CREATE OR REPLACE VIEW public.v_maintenance_overview AS
SELECT
  company_id,
  month_bucket,
  COUNT(*)                                  AS jobs_total,
  COUNT(*) FILTER (WHERE open_or_closed = 'open')   AS jobs_open,
  COUNT(*) FILTER (WHERE open_or_closed = 'closed') AS jobs_closed,
  COUNT(*) FILTER (WHERE priority = 'critical')     AS jobs_critical,
  COUNT(*) FILTER (WHERE priority = 'high')         AS jobs_high,
  COUNT(*) FILTER (WHERE priority = 'medium')       AS jobs_medium,
  COUNT(*) FILTER (WHERE priority = 'low')          AS jobs_low,
  COUNT(*) FILTER (WHERE is_callback)               AS jobs_callback,
  COUNT(*) FILTER (WHERE is_preventive)             AS jobs_preventive,
  COUNT(*) FILTER (WHERE NOT is_preventive)         AS jobs_reactive,
  ROUND(AVG(actual_response_minutes)::numeric, 1)   AS avg_response_minutes,
  ROUND(AVG(actual_resolution_hours)::numeric, 2)   AS avg_resolution_hours,
  ROUND(
    100.0 * SUM(CASE WHEN sla_response_met THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN sla_response_met IS NOT NULL THEN 1 ELSE 0 END), 0),
    1
  )                                                 AS sla_response_compliance_pct,
  ROUND(
    100.0 * SUM(CASE WHEN sla_resolution_met THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN sla_resolution_met IS NOT NULL THEN 1 ELSE 0 END), 0),
    1
  )                                                 AS sla_resolution_compliance_pct
FROM public.v_jobs_enriched
GROUP BY company_id, month_bucket;
-- 3. Page 2: Cost & Financial Analysis (per site, monthly)
CREATE OR REPLACE VIEW public.v_cost_financial AS
SELECT
  company_id,
  month_bucket,
  site_id,
  site_name,
  COUNT(*)                                          AS jobs_with_cost,
  SUM(estimated_cost)                               AS estimated_total,
  SUM(actual_cost)                                  AS actual_total,
  SUM(cost_variance)                                AS variance_total,
  ROUND(AVG(cost_variance_pct)::numeric, 1)         AS avg_variance_pct,
  COUNT(*) FILTER (WHERE cost_variance_pct >= 20)   AS jobs_over_budget_20pct
FROM public.v_jobs_enriched
WHERE estimated_cost IS NOT NULL OR actual_cost IS NOT NULL
GROUP BY company_id, month_bucket, site_id, site_name;
-- 4. Page 3: Contractor / Service Provider Scorecard
CREATE OR REPLACE VIEW public.v_contractor_scorecard AS
SELECT
  company_id,
  COALESCE(contractor_employee_id, assignee_employee_id) AS provider_id,
  COALESCE(contractor_name,       assignee_name)         AS provider_name,
  CASE WHEN contractor_employee_id IS NOT NULL
       THEN 'contractor' ELSE 'employee' END             AS provider_kind,
  COUNT(*)                                               AS jobs_total,
  COUNT(*) FILTER (WHERE open_or_closed = 'closed')      AS jobs_closed,
  COUNT(*) FILTER (WHERE is_callback)                    AS jobs_callback,
  ROUND(AVG(actual_response_minutes)::numeric, 1)        AS avg_response_minutes,
  ROUND(AVG(actual_resolution_hours)::numeric, 2)        AS avg_resolution_hours,
  ROUND(
    100.0 * SUM(CASE WHEN sla_response_met THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN sla_response_met IS NOT NULL THEN 1 ELSE 0 END), 0),
    1
  )                                                       AS sla_response_compliance_pct,
  ROUND(
    100.0 * SUM(CASE WHEN sla_resolution_met THEN 1 ELSE 0 END)::numeric
    / NULLIF(SUM(CASE WHEN sla_resolution_met IS NOT NULL THEN 1 ELSE 0 END), 0),
    1
  )                                                       AS sla_resolution_compliance_pct,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE is_callback)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE open_or_closed = 'closed'), 0),
    1
  )                                                       AS callback_rate_pct
FROM public.v_jobs_enriched
WHERE COALESCE(contractor_employee_id, assignee_employee_id) IS NOT NULL
GROUP BY 1, 2, 3, 4;
-- 5. Page 5: Resident & Unit Intelligence
CREATE OR REPLACE VIEW public.v_resident_unit AS
SELECT
  je.company_id,
  je.unit_id,
  je.site_id,
  je.site_name,
  je.unit_number,
  COUNT(*)                                                 AS tickets_total,
  COUNT(*) FILTER (
    WHERE COALESCE(je.opened_at, je.scheduled_start) >= NOW() - INTERVAL '30 days'
  )                                                        AS tickets_last_30d,
  COUNT(DISTINCT je.issue_category_slug)                   AS distinct_categories,
  EXISTS (
    SELECT 1
    FROM public.v_jobs_enriched j2
    WHERE j2.company_id = je.company_id
      AND j2.unit_id    = je.unit_id
      AND j2.issue_category_id IS NOT NULL
      AND COALESCE(j2.opened_at, j2.scheduled_start) >= NOW() - INTERVAL '90 days'
    GROUP BY j2.issue_category_id
    HAVING COUNT(*) >= 2
  )                                                        AS has_repeat_issue_90d,
  ROUND(AVG(jf.rating_1_to_5)::numeric, 2)                 AS avg_satisfaction,
  COUNT(jf.id)                                             AS feedback_count,
  ROUND(
    100.0 * COUNT(jf.id)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE je.open_or_closed = 'closed'), 0),
    1
  )                                                        AS feedback_coverage_pct
FROM public.v_jobs_enriched je
LEFT JOIN public.job_feedback jf ON jf.job_id = je.job_id
WHERE je.unit_id IS NOT NULL
GROUP BY je.company_id, je.unit_id, je.site_id, je.site_name, je.unit_number;
