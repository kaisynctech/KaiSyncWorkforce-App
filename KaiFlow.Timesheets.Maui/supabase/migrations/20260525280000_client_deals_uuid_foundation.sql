-- Client projects (client_deals) for UUID schema v2 + job link column.
-- Remote still had a legacy bigint client_deals table (pre-uuid-v2 orphan).
-- Drop and recreate as uuid so the MAUI app (Guid models) can use it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'client_deals'
      AND column_name = 'id' AND udt_name = 'int8'
  ) THEN
    DROP TABLE public.client_deals CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.client_deals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title               text NOT NULL,
  status              text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'sent', 'negotiation', 'won', 'lost')),
  offer_amount        numeric(12,2) NOT NULL DEFAULT 0,
  expected_close_date date,
  notes               text,
  job_id              uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  visibility          text NOT NULL DEFAULT 'all'
                      CHECK (visibility IN ('all', 'restricted', 'private')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_deals_company_client
  ON public.client_deals(company_id, client_id);

CREATE INDEX IF NOT EXISTS idx_client_deals_company_job
  ON public.client_deals(company_id, job_id);

CREATE INDEX IF NOT EXISTS idx_client_deals_visibility
  ON public.client_deals(company_id, visibility);

-- jobs.deal_id may exist as bigint from legacy migrations on dropped jobs tables; normalize to uuid.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'deal_id'
  ) THEN
    ALTER TABLE public.jobs DROP COLUMN deal_id;
  END IF;
END $$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.client_deals(id) ON DELETE SET NULL;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'inherit';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_visibility_chk'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_visibility_chk
      CHECK (visibility IN ('inherit', 'all', 'restricted', 'private'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_deal_id
  ON public.jobs(deal_id) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_visibility
  ON public.jobs(company_id, visibility);

ALTER TABLE public.client_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_deals_all" ON public.client_deals;
CREATE POLICY "client_deals_all" ON public.client_deals FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()))
  WITH CHECK (company_id = ANY(user_company_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_deals TO authenticated;
