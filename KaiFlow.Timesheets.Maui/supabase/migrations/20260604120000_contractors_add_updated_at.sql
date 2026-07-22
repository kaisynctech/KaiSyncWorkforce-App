-- Phase 1 remediation: add updated_at tracking to contractors table.
-- The UUID v2 contractors table (20260515160036) was created without updated_at.
-- This migration adds the column, backfills from created_at, and installs a trigger.

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- Backfill existing rows: use created_at as a safe starting value.
UPDATE public.contractors
SET updated_at = created_at
WHERE updated_at IS NULL;
-- Make the column NOT NULL with a default now that backfill is complete.
ALTER TABLE public.contractors
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();
-- Auto-maintain updated_at on every row update.
-- set_updated_at() may already exist from other tables — CREATE OR REPLACE is safe.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_contractors_updated_at
  BEFORE UPDATE ON public.contractors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
