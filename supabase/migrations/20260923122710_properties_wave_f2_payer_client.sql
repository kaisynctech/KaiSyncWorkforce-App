-- ============================================================
-- Properties Wave F2: bursary / sponsor bill-to client
-- ============================================================

ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS payer_client_id uuid
    REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_property_leases_payer_client
  ON public.property_leases (payer_client_id)
  WHERE payer_client_id IS NOT NULL;

COMMENT ON COLUMN public.property_leases.payer_client_id IS
  'Money bill-to client for rent when payer_type is bursary/sponsor (e.g. NSFAS). Falls back to tenant_client_id for self/cash/eft.';

NOTIFY pgrst, 'reload schema';
