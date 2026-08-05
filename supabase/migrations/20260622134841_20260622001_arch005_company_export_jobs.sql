-- ARCH-005 Migration 1: company_export_jobs table + RLS + index
CREATE TABLE public.company_export_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    requested_by    uuid NOT NULL,
    status          text NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing', 'completed', 'failed')),
    storage_path    text,
    download_url    text,
    expires_at      timestamptz,
    error_message   text,
    record_counts   jsonb NOT NULL DEFAULT '{}',
    sensitive_tables jsonb NOT NULL DEFAULT '[]',
    created_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz
);

ALTER TABLE public.company_export_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_export_jobs_select"
    ON public.company_export_jobs
    FOR SELECT
    TO authenticated
    USING (company_id = ANY(user_company_ids()));

CREATE POLICY "company_export_jobs_insert"
    ON public.company_export_jobs
    FOR INSERT
    TO authenticated
    WITH CHECK (company_id = ANY(user_company_ids()));

CREATE INDEX idx_company_export_jobs_company_id
    ON public.company_export_jobs (company_id, created_at DESC);

COMMENT ON TABLE public.company_export_jobs IS
    'Tracks tenant data export requests. Records created by the generate-company-export Edge Function. Status: processing → completed | failed.';;
