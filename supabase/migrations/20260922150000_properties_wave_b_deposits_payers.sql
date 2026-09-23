-- ============================================================
-- Properties Wave B: deposits, payer types, notice period
-- ============================================================

ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS deposit_paid_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS deposit_paid_at date,
  ADD COLUMN IF NOT EXISTS payer_type text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS sponsor_name text,
  ADD COLUMN IF NOT EXISTS notice_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS property_leases_deposit_status_check;
ALTER TABLE public.property_leases
  ADD CONSTRAINT property_leases_deposit_status_check
  CHECK (deposit_status = ANY (ARRAY[
    'none'::text,
    'due'::text,
    'paid'::text,
    'partially_held'::text,
    'refunded'::text
  ]));

ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS property_leases_payer_type_check;
ALTER TABLE public.property_leases
  ADD CONSTRAINT property_leases_payer_type_check
  CHECK (payer_type = ANY (ARRAY[
    'self'::text,
    'bursary'::text,
    'sponsor'::text,
    'cash'::text,
    'eft'::text
  ]));

ALTER TABLE public.property_leases DROP CONSTRAINT IF EXISTS property_leases_notice_days_check;
ALTER TABLE public.property_leases
  ADD CONSTRAINT property_leases_notice_days_check
  CHECK (notice_days >= 0 AND notice_days <= 365);

-- Backfill: if deposit_amount > 0 and still 'none', mark as due
UPDATE public.property_leases
SET deposit_status = 'due'
WHERE deposit_amount IS NOT NULL
  AND deposit_amount > 0
  AND deposit_status = 'none';

COMMENT ON COLUMN public.property_leases.deposit_status IS
  'Deposit lifecycle: none, due, paid, partially_held, refunded.';
COMMENT ON COLUMN public.property_leases.deposit_paid_amount IS
  'Amount of deposit received to date.';
COMMENT ON COLUMN public.property_leases.payer_type IS
  'Who funds rent: self, bursary, sponsor, cash, eft.';
COMMENT ON COLUMN public.property_leases.sponsor_name IS
  'Bursary / sponsor organisation or person name when payer_type is bursary or sponsor.';
COMMENT ON COLUMN public.property_leases.notice_days IS
  'Configured notice period in days (default 30). Not legal advice.';
