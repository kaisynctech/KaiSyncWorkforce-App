-- ============================================================
-- Properties Wave H1: checkout bill links a stay to one Money invoice
-- Reuses finance_invoices (invoice_type = 'stay'). Rent stays on lease_id.
-- ============================================================

ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS stay_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_invoices_stay_id_fkey'
      AND conrelid = 'public.finance_invoices'::regclass
  ) THEN
    ALTER TABLE public.finance_invoices
      ADD CONSTRAINT finance_invoices_stay_id_fkey
      FOREIGN KEY (stay_id)
      REFERENCES public.property_stays(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_finance_invoices_stay
  ON public.finance_invoices (stay_id)
  WHERE stay_id IS NOT NULL;

-- One live stay invoice per stay. Voided/cancelled rows do not hold the slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_invoices_one_open_stay
  ON public.finance_invoices (stay_id)
  WHERE stay_id IS NOT NULL
    AND invoice_type = 'stay'
    AND status NOT IN ('cancelled', 'voided');

COMMENT ON COLUMN public.finance_invoices.stay_id IS
  'Guest-house stay billed at check-out. Distinct from lease_id (monthly rent).';

NOTIFY pgrst, 'reload schema';
