-- ============================================================
-- Cross-linking jobs to deals
-- A deal (e.g. R20,000 Coca-Cola painting contract) can spawn many
-- jobs. Each job optionally references the deal it belongs to so
-- "References" panels can chain Deal → Client → Site → Unit → Worker.
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS deal_id bigint REFERENCES public.client_deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_deal_id
  ON public.jobs(deal_id) WHERE deal_id IS NOT NULL;
