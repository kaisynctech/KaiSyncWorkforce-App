-- Phase D: job-level contractor documents
-- Documents scoped to a specific contractor's assignment on a specific job.

CREATE TABLE public.job_contractor_documents (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        uuid        NOT NULL,
    job_id            uuid        NOT NULL REFERENCES public.jobs(id)             ON DELETE CASCADE,
    contractor_id     uuid        NOT NULL REFERENCES public.contractors(id)      ON DELETE CASCADE,
    job_contractor_id uuid        NOT NULL REFERENCES public.job_contractors(id)  ON DELETE CASCADE,
    document_type     text        NOT NULL DEFAULT 'other',
    document_name     text        NOT NULL,
    file_url          text        NOT NULL,
    storage_path      text,
    notes             text,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_contractor_documents IS
    'Phase D: documents tied to a contractor''s assignment on a job '
    '(method statement, risk assessment, permit, completion certificate).';

ALTER TABLE public.job_contractor_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p_job_contractor_documents_company"
    ON public.job_contractor_documents
    FOR ALL TO authenticated
    USING  (company_id = ANY(user_company_ids()))
    WITH CHECK (company_id = ANY(user_company_ids()));

CREATE INDEX ix_jcd_company_jc
    ON public.job_contractor_documents (company_id, job_contractor_id);
