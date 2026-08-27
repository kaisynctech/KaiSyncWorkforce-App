-- Link client invoices to jobs (Money ↔ Jobs discoverability).
ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_job
  ON public.finance_invoices (company_id, job_id)
  WHERE job_id IS NOT NULL;

COMMENT ON COLUMN public.finance_invoices.job_id IS
  'Optional link to a job for Money ↔ Jobs discoverability.';
