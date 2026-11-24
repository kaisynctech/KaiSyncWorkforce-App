-- Email CC and RFQ emails.
-- Every email log keeps who was copied in; RFQs can now be emailed to each supplier (one email per supplier,
-- doc_id = rfq_recipients.id) from send_document_email.

ALTER TABLE public.document_emails ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.statement_reminders ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.commercial_quote_sends ADD COLUMN IF NOT EXISTS cc text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.document_emails DROP CONSTRAINT IF EXISTS document_emails_kind_check;
ALTER TABLE public.document_emails ADD CONSTRAINT document_emails_kind_check CHECK (kind IN (
  'invoice', 'credit_note', 'receipt', 'purchase_order', 'rfq', 'remittance_supplier', 'remittance_contractor'));
