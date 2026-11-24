-- 20261016134458_client_document_requests_revoke_anon
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

REVOKE ALL ON TABLE public.client_document_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.client_document_requests FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.client_document_requests TO authenticated;
