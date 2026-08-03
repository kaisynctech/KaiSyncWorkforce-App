-- Align Xero payroll journals with live payment_approvals (payslips table does not exist).
ALTER TABLE public.xero_journal_links
  ADD COLUMN IF NOT EXISTS payment_approval_id uuid REFERENCES public.payment_approvals(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS xero_journal_status text;

UPDATE public.xero_journal_links j
SET payment_approval_id = j.payslip_id
WHERE j.payment_approval_id IS NULL
  AND j.payslip_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.payment_approvals pa WHERE pa.id = j.payslip_id);

ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS paye_payable_code text DEFAULT '825',
  ADD COLUMN IF NOT EXISTS wages_payable_code text DEFAULT '814',
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

UPDATE public.xero_connections
SET token_expires_at = expires_at
WHERE token_expires_at IS NULL AND expires_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_xero_journal_links_payment_approval
  ON public.xero_journal_links (company_id, payment_approval_id)
  WHERE payment_approval_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xero_journal_links_company_period
  ON public.xero_journal_links (company_id, pushed_at DESC);
