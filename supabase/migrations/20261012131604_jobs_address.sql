-- The New Job form stores a free-text location on the job.
-- The detail page already reads jobs.address when no site is linked.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS address text;

COMMENT ON COLUMN public.jobs.address IS
  'Free-text job location from the job form. Site address is preferred when site_id is set.';
