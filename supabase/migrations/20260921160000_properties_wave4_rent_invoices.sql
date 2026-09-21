-- ============================================================
-- Properties Wave 4: link Money invoices to leases / sites
-- Reuses finance_invoices — no parallel rent billing engine.
-- ============================================================

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS lease_id uuid
    REFERENCES public.property_leases(id) ON DELETE SET NULL;

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS site_id uuid
    REFERENCES public.sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_lease
  ON public.finance_invoices (lease_id)
  WHERE lease_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_site
  ON public.finance_invoices (site_id)
  WHERE site_id IS NOT NULL;

COMMENT ON COLUMN public.finance_invoices.lease_id IS
  'Optional property lease this invoice bills (rent / deposit).';
COMMENT ON COLUMN public.finance_invoices.site_id IS
  'Optional property site for portfolio arrears filters; usually derived from lease.';

NOTIFY pgrst, 'reload schema';
