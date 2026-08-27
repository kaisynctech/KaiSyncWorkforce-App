-- Allow voided status on finance_invoices (UI + voided_at already exist; check was outdated).
ALTER TABLE public.finance_invoices
  DROP CONSTRAINT IF EXISTS finance_invoices_status_check;

ALTER TABLE public.finance_invoices
  ADD CONSTRAINT finance_invoices_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'sent'::text,
    'viewed'::text,
    'partially_paid'::text,
    'paid'::text,
    'overdue'::text,
    'cancelled'::text,
    'voided'::text
  ]));
