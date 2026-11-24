-- 20261105135700_recurring_invoices_created_by_default
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

ALTER TABLE public.recurring_invoices ALTER COLUMN created_by SET DEFAULT auth.uid();
