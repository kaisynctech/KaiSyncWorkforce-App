-- 20261016133643_client_document_requests_table
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE TABLE public.client_document_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  request_note text,
  status text NOT NULL DEFAULT 'requested',
  review_note text,
  storage_path text,
  file_url text,
  file_size_bytes bigint,
  mime_type text,
  requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_document_requests_status_check CHECK (
    status = ANY (ARRAY['requested'::text, 'submitted'::text, 'accepted'::text, 'changes_requested'::text])
  ),
  CONSTRAINT client_document_requests_file_check CHECK (
    status = ANY (ARRAY['requested'::text, 'changes_requested'::text])
    OR storage_path IS NOT NULL
  )
);
CREATE INDEX client_document_requests_client_idx ON public.client_document_requests (company_id, client_id, created_at DESC);
ALTER TABLE public.client_document_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_document_requests_select ON public.client_document_requests FOR SELECT TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'clients.view') AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.company_id = client_document_requests.company_id));
CREATE POLICY client_document_requests_insert ON public.client_document_requests FOR INSERT TO authenticated WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'clients.edit') AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.company_id = client_document_requests.company_id));
CREATE POLICY client_document_requests_update ON public.client_document_requests FOR UPDATE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'clients.edit')) WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'clients.edit'));
GRANT SELECT, INSERT, UPDATE ON public.client_document_requests TO authenticated;
ALTER TABLE public.client_deals ADD COLUMN quotation_response text NOT NULL DEFAULT 'pending', ADD COLUMN quotation_response_note text, ADD COLUMN quotation_response_at timestamptz, ADD COLUMN quotation_response_storage_path text;
ALTER TABLE public.client_deals ADD CONSTRAINT client_deals_quotation_response_check CHECK (quotation_response = ANY (ARRAY['pending'::text, 'accepted'::text, 'revision_requested'::text]));
