-- Migration: 20260608100303_contractor_portal_remove_rating
-- Removed contractor rating column from the portal/contractors table.
-- Representation file: idempotent no-op — objects introduced by this migration
-- are managed by surrounding migrations in this sequence.
-- Likely: ALTER TABLE public.contractors DROP COLUMN IF EXISTS rating;
-- or similar DDL. No stored function was introduced.
DO $$ BEGIN NULL; END $$;