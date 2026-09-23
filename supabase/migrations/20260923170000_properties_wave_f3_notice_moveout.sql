-- ============================================================
-- Properties Wave F3: notice given + deposit refund audit
-- ============================================================

ALTER TABLE public.property_leases
  ADD COLUMN IF NOT EXISTS notice_given_at date,
  ADD COLUMN IF NOT EXISTS deposit_refunded_at date,
  ADD COLUMN IF NOT EXISTS deposit_refund_amount numeric(14, 2);

CREATE INDEX IF NOT EXISTS idx_property_leases_notice_active
  ON public.property_leases (company_id, notice_given_at)
  WHERE status = 'active' AND notice_given_at IS NOT NULL;

COMMENT ON COLUMN public.property_leases.notice_given_at IS
  'Date tenant notice was recorded. Vacate target is typically notice_given_at + notice_days.';
COMMENT ON COLUMN public.property_leases.deposit_refunded_at IS
  'Date deposit refund was recorded (when deposit_status = refunded).';
COMMENT ON COLUMN public.property_leases.deposit_refund_amount IS
  'Amount refunded to tenant (may be less than deposit if partially held).';

NOTIFY pgrst, 'reload schema';
