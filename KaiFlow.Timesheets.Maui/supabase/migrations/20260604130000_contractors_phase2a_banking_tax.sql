-- Phase 2A: Contractor banking & tax enterprise readiness.
-- Adds account holder, account type, Swift/BIC, tax number, payment terms,
-- preferred payment method, and three control flags (payment hold, compliance hold,
-- banking verified) to support EFT payouts and accounting integration.

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS account_holder_name  text,
  ADD COLUMN IF NOT EXISTS account_type         text
      CHECK (account_type IN ('cheque','savings','transmission','credit')),
  ADD COLUMN IF NOT EXISTS swift_bic            text,
  ADD COLUMN IF NOT EXISTS tax_number           text,
  ADD COLUMN IF NOT EXISTS payment_terms        text DEFAULT '30_days'
      CHECK (payment_terms IN ('immediate','7_days','14_days','30_days','60_days','90_days')),
  ADD COLUMN IF NOT EXISTS preferred_payment_method text DEFAULT 'eft'
      CHECK (preferred_payment_method IN ('eft','cash','cheque','card')),
  ADD COLUMN IF NOT EXISTS payment_hold         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_hold      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banking_verified     boolean NOT NULL DEFAULT false;

-- Indexes for common filter queries (hold dashboards, compliance lists).
CREATE INDEX IF NOT EXISTS idx_contractors_payment_hold
  ON public.contractors(company_id, payment_hold)
  WHERE payment_hold = true;

CREATE INDEX IF NOT EXISTS idx_contractors_compliance_hold
  ON public.contractors(company_id, compliance_hold)
  WHERE compliance_hold = true;

CREATE INDEX IF NOT EXISTS idx_contractors_banking_verified
  ON public.contractors(company_id, banking_verified);

COMMENT ON COLUMN public.contractors.account_holder_name IS
  'Legal name of bank account holder — must match bank records for EFT verification.';
COMMENT ON COLUMN public.contractors.account_type IS
  'SA bank account type: cheque | savings | transmission | credit';
COMMENT ON COLUMN public.contractors.swift_bic IS
  'SWIFT/BIC code for international or cross-bank wire transfers.';
COMMENT ON COLUMN public.contractors.tax_number IS
  'SARS income tax reference number — required for contractor payment reporting.';
COMMENT ON COLUMN public.contractors.payment_terms IS
  'Default payment terms: immediate | 7_days | 14_days | 30_days | 60_days | 90_days';
COMMENT ON COLUMN public.contractors.preferred_payment_method IS
  'Preferred disbursement method: eft | cash | cheque | card';
COMMENT ON COLUMN public.contractors.payment_hold IS
  'When true, payouts to this contractor are blocked pending resolution.';
COMMENT ON COLUMN public.contractors.compliance_hold IS
  'When true, compliance documents are missing or expired — blocks payments.';
COMMENT ON COLUMN public.contractors.banking_verified IS
  'Indicates that banking details have been manually verified against bank statements or portal proof.';
