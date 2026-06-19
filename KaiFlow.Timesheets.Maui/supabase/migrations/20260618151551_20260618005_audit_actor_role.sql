-- ARCH-002 Migration 4 (corrective): Audit Actor Role
-- Corrective migration: renamed actor_id -> actor_user_id, added actor_employee_id
-- FK column referencing employees(id), and made actor_role nullable.
-- The audit_events table was created with these final column names in the
-- preceding audit_foundation representation file, so this is a no-op.
ALTER TABLE public.audit_events ADD COLUMN IF NOT EXISTS actor_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;
-- actor_role nullable: no-op if already nullable
DO $$ BEGIN
  ALTER TABLE public.audit_events ALTER COLUMN actor_role DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
