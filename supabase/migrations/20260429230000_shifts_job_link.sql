-- ============================================================
-- Link shifts to jobs/deals planning
-- - Adds optional shifts.job_id
-- - Enables scheduling rows to reference concrete jobs
-- ============================================================

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS job_id bigint NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shifts_job_id_fkey'
      AND conrelid = 'public.shifts'::regclass
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT shifts_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_company_job
  ON public.shifts(company_id, job_id)
  WHERE job_id IS NOT NULL;
