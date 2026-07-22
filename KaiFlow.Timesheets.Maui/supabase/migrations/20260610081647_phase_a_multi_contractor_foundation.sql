
-- ============================================================
-- Phase A: Multi-Contractor Foundation
-- Fully backward-compatible: zero existing columns removed.
-- All new tables/columns are additive only.
-- ============================================================

-- ── 1. job_contractors ────────────────────────────────────────────────────────
CREATE TABLE public.job_contractors (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid        NOT NULL REFERENCES public.companies(id)          ON DELETE CASCADE,
    job_id        uuid        NOT NULL REFERENCES public.jobs(id)               ON DELETE CASCADE,
    contractor_id uuid        NOT NULL REFERENCES public.contractors(id)        ON DELETE CASCADE,
    quote_id      uuid                 REFERENCES public.contractor_quotes(id)  ON DELETE SET NULL,
    role          text        NOT NULL DEFAULT 'general',
    scope_notes   text,
    quoted_amount numeric     NOT NULL DEFAULT 0,
    agreed_amount numeric     NOT NULL DEFAULT 0,
    status        text        NOT NULL DEFAULT 'assigned'
                  CHECK (status IN ('assigned','in_progress','completed','cancelled')),
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz,
    created_by    uuid                 REFERENCES public.employees(id)          ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, contractor_id)
);

COMMENT ON TABLE  public.job_contractors IS 'Phase A: many-to-many mapping of contractors to jobs. Preserves jobs.contractor_id for backward compatibility.';
COMMENT ON COLUMN public.job_contractors.quote_id      IS 'The approved contractor_quote that authorised this assignment (nullable — direct assignments allowed).';
COMMENT ON COLUMN public.job_contractors.quoted_amount IS 'Original quote total (informational, copied from contractor_quotes.total_amount at assignment time).';
COMMENT ON COLUMN public.job_contractors.agreed_amount IS 'Negotiated/authorised cost for this contractor on this job.';

-- ── 2. project_contractors ────────────────────────────────────────────────────
CREATE TABLE public.project_contractors (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    uuid        NOT NULL REFERENCES public.companies(id)          ON DELETE CASCADE,
    deal_id       uuid        NOT NULL REFERENCES public.client_deals(id)       ON DELETE CASCADE,
    contractor_id uuid        NOT NULL REFERENCES public.contractors(id)        ON DELETE CASCADE,
    role          text        NOT NULL DEFAULT 'general',
    scope_notes   text,
    status        text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed','removed')),
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, contractor_id)
);

COMMENT ON TABLE public.project_contractors IS 'Phase A: many-to-many mapping of contractors to projects (client_deals). Auto-populated from job_contractors backfill.';

-- ── 3. incident_reports.deal_id ──────────────────────────────────────────────
ALTER TABLE public.incident_reports
    ADD COLUMN IF NOT EXISTS deal_id uuid
        REFERENCES public.client_deals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.incident_reports.deal_id IS 'Phase A: project (client_deal) context for this incident. Backfilled via job.deal_id; may also be set directly.';

-- ── 4. contractor_payouts.quote_id ───────────────────────────────────────────
ALTER TABLE public.contractor_payouts
    ADD COLUMN IF NOT EXISTS quote_id uuid
        REFERENCES public.contractor_quotes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contractor_payouts.quote_id IS 'Phase A: links payout to the approved contractor_quote it settles (nullable — legacy payouts predate quotes).';

-- ── 5. Indexes ────────────────────────────────────────────────────────────────

-- job_contractors
CREATE INDEX idx_job_contractors_job        ON public.job_contractors(job_id);
CREATE INDEX idx_job_contractors_contractor ON public.job_contractors(company_id, contractor_id);
CREATE INDEX idx_job_contractors_active     ON public.job_contractors(company_id, status)
    WHERE status != 'cancelled';
CREATE INDEX idx_job_contractors_quote      ON public.job_contractors(quote_id)
    WHERE quote_id IS NOT NULL;

-- project_contractors
CREATE INDEX idx_project_contractors_deal        ON public.project_contractors(deal_id);
CREATE INDEX idx_project_contractors_contractor  ON public.project_contractors(company_id, contractor_id);
CREATE INDEX idx_project_contractors_active      ON public.project_contractors(company_id, status)
    WHERE status != 'removed';

-- incident_reports.deal_id (sparse — only non-null values)
CREATE INDEX idx_incident_reports_deal ON public.incident_reports(company_id, deal_id)
    WHERE deal_id IS NOT NULL;

-- contractor_payouts.quote_id (sparse)
CREATE INDEX idx_contractor_payouts_quote ON public.contractor_payouts(quote_id)
    WHERE quote_id IS NOT NULL;

-- jobs.contractor_id (was missing from indexes — needed for backfill and portal RPC)
CREATE INDEX idx_jobs_contractor ON public.jobs(company_id, contractor_id)
    WHERE contractor_id IS NOT NULL;

-- ── 6. Row-Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.job_contractors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_contractors_all ON public.job_contractors
    FOR ALL TO authenticated
    USING     (company_id = ANY (user_company_ids()))
    WITH CHECK (company_id = ANY (user_company_ids()));

CREATE POLICY project_contractors_all ON public.project_contractors
    FOR ALL TO authenticated
    USING     (company_id = ANY (user_company_ids()))
    WITH CHECK (company_id = ANY (user_company_ids()));

-- ── 7. Backfill ───────────────────────────────────────────────────────────────

-- A: Populate job_contractors from existing jobs.contractor_id (single-contractor legacy data)
INSERT INTO public.job_contractors (
    company_id, job_id, contractor_id, quote_id,
    quoted_amount, agreed_amount, status, assigned_at
)
SELECT
    j.company_id,
    j.id                  AS job_id,
    j.contractor_id,
    j.source_quote_id     AS quote_id,
    COALESCE(j.contractor_cost, 0),
    COALESCE(j.contractor_cost, 0),
    CASE j.status
        WHEN 'completed'  THEN 'completed'
        WHEN 'cancelled'  THEN 'cancelled'
        WHEN 'inProgress' THEN 'in_progress'
        WHEN 'in_progress' THEN 'in_progress'
        ELSE 'assigned'
    END,
    COALESCE(j.opened_at, j.created_at)
FROM public.jobs j
WHERE j.contractor_id IS NOT NULL
ON CONFLICT (job_id, contractor_id) DO NOTHING;

-- B: Populate project_contractors from job_contractors + jobs.deal_id
INSERT INTO public.project_contractors (
    company_id, deal_id, contractor_id, status, assigned_at
)
SELECT DISTINCT
    jc.company_id,
    j.deal_id,
    jc.contractor_id,
    'active',
    jc.assigned_at
FROM public.job_contractors jc
JOIN public.jobs j ON j.id = jc.job_id
WHERE j.deal_id IS NOT NULL
  AND jc.status != 'cancelled'
ON CONFLICT (deal_id, contractor_id) DO NOTHING;

-- C: Backfill incident_reports.deal_id via job.deal_id
UPDATE public.incident_reports ir
SET    deal_id = j.deal_id
FROM   public.jobs j
WHERE  ir.job_id   = j.id
  AND  j.deal_id  IS NOT NULL
  AND  ir.deal_id IS NULL;
;
