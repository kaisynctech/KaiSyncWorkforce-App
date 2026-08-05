
-- RLS fixes
DROP POLICY IF EXISTS p_contractor_banking_updates_authenticated ON public.contractor_banking_updates;
CREATE POLICY p_contractor_banking_updates_authenticated
  ON public.contractor_banking_updates
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

DROP POLICY IF EXISTS p_contractor_documents_authenticated ON public.contractor_documents;
CREATE POLICY p_contractor_documents_authenticated
  ON public.contractor_documents
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

DROP POLICY IF EXISTS p_contractor_quotes_authenticated ON public.contractor_quotes;
CREATE POLICY p_contractor_quotes_authenticated
  ON public.contractor_quotes
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

DROP POLICY IF EXISTS p_contractor_quote_attachments_authenticated ON public.contractor_quote_attachments;
CREATE POLICY p_contractor_quote_attachments_authenticated
  ON public.contractor_quote_attachments
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_incident_reports_company_contractor
  ON public.incident_reports(company_id, contractor_id)
  WHERE contractor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_site_visits_company_contractor
  ON public.job_site_visits(company_id, contractor_id, sign_in_at DESC)
  WHERE contractor_id IS NOT NULL;
;
