ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS contractor_id bigint NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_contractor_id_fkey'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES public.contractors(id)
      ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_jobs_company_contractor
  ON public.jobs(company_id, contractor_id)
  WHERE contractor_id IS NOT NULL;
