-- ============================================================
-- Properties Wave C: maintenance & light contractors
-- jobs.unit_id already exists (FK → units). Add indexes + profile_tier.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_jobs_unit
  ON public.jobs (unit_id)
  WHERE unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_site_unit
  ON public.jobs (company_id, site_id, unit_id)
  WHERE site_id IS NOT NULL;

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS profile_tier text NOT NULL DEFAULT 'full';

ALTER TABLE public.contractors DROP CONSTRAINT IF EXISTS contractors_profile_tier_check;
ALTER TABLE public.contractors
  ADD CONSTRAINT contractors_profile_tier_check
  CHECK (profile_tier = ANY (ARRAY['light'::text, 'full'::text]));

COMMENT ON COLUMN public.contractors.profile_tier IS
  'light = trade contact (name/phone, no compliance pack required). full = standard contractor profile.';

CREATE INDEX IF NOT EXISTS idx_contractors_profile_tier
  ON public.contractors (company_id, profile_tier)
  WHERE is_active = true;
