-- Project + job codes and CRM fields on client_deals.

ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS project_code text,
  ADD COLUMN IF NOT EXISTS agreement_notes text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_update_note text,
  ADD COLUMN IF NOT EXISTS last_update_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_deals_progress_percent_chk'
  ) THEN
    ALTER TABLE public.client_deals
      ADD CONSTRAINT client_deals_progress_percent_chk
      CHECK (progress_percent >= 0 AND progress_percent <= 100);
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_deals_company_project_code
  ON public.client_deals(company_id, upper(project_code))
  WHERE project_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_company_job_code
  ON public.jobs(company_id, upper(job_code))
  WHERE job_code IS NOT NULL;
