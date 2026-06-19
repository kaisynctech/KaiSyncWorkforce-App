-- ============================================================================
-- Fix RLS: 4 contractor tables had qual = 'true' (no company isolation)
--
-- Any authenticated HR user from Company A could read/write Company B's
-- contractor documents, banking updates, quotes, and quote attachments.
-- Correct pattern: company_id = ANY(user_company_ids())
-- ============================================================================

-- contractor_banking_updates
DROP POLICY IF EXISTS p_contractor_banking_updates_authenticated ON public.contractor_banking_updates;
CREATE POLICY p_contractor_banking_updates_authenticated
  ON public.contractor_banking_updates
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- contractor_documents
DROP POLICY IF EXISTS p_contractor_documents_authenticated ON public.contractor_documents;
CREATE POLICY p_contractor_documents_authenticated
  ON public.contractor_documents
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- contractor_quotes
DROP POLICY IF EXISTS p_contractor_quotes_authenticated ON public.contractor_quotes;
CREATE POLICY p_contractor_quotes_authenticated
  ON public.contractor_quotes
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- contractor_quote_attachments
DROP POLICY IF EXISTS p_contractor_quote_attachments_authenticated ON public.contractor_quote_attachments;
CREATE POLICY p_contractor_quote_attachments_authenticated
  ON public.contractor_quote_attachments
  FOR ALL TO authenticated
  USING (company_id = ANY(user_company_ids()));

-- ============================================================================
-- Add missing performance indexes
--
-- incident_reports: no (company_id, contractor_id) composite index.
-- Phase H analytics scans the whole table to count incidents per contractor.
--
-- job_site_visits: existing partial index covers open visits only.
-- contractor_portal_visit_history and Phase H analytics need full history
-- by contractor across a company.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_incident_reports_company_contractor
  ON public.incident_reports(company_id, contractor_id)
  WHERE contractor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_site_visits_company_contractor
  ON public.job_site_visits(company_id, contractor_id, sign_in_at DESC)
  WHERE contractor_id IS NOT NULL;
