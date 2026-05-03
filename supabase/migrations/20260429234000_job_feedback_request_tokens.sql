-- ============================================================
-- Client feedback request tokens
-- - Adds request token metadata on job_feedback
-- - Lets HR generate a unique feedback link per job
-- ============================================================

ALTER TABLE public.job_feedback
  ADD COLUMN IF NOT EXISTS request_token text,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_feedback_request_token
  ON public.job_feedback(request_token)
  WHERE request_token IS NOT NULL;
