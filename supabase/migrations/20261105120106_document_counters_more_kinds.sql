-- 20261105120106_document_counters_more_kinds
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

ALTER TABLE public.document_counters DROP CONSTRAINT document_counters_kind_check;
ALTER TABLE public.document_counters ADD CONSTRAINT document_counters_kind_check
  CHECK (kind = ANY (ARRAY['invoice', 'quote', 'job', 'credit_note', 'purchase_order', 'rfq', 'grn']));
