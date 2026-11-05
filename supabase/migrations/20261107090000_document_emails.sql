-- One log of every document emailed from KaiSync (invoices, credit notes, receipts, purchase orders,
-- remittance advice). Written only by the send_document_email function (service role). Read by the
-- company's office staff (any active role except plain employees).

CREATE TABLE IF NOT EXISTS public.document_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'receipt', 'purchase_order', 'remittance_supplier', 'remittance_contractor')),
  doc_id uuid NOT NULL,
  recipient_email text NOT NULL,
  subject text,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  provider_message_id text,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_emails_doc_idx ON public.document_emails (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_emails_company_idx ON public.document_emails (company_id, created_at DESC);
ALTER TABLE public.document_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_emails_read ON public.document_emails FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND coalesce(public.get_my_role(company_id), 'employee') <> 'employee');
GRANT SELECT ON public.document_emails TO authenticated;
