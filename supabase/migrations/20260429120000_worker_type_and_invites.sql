-- ============================================================
-- Worker types + invitation tracking
-- Adds worker_type, invite_status, invited_at to employees.
-- Updates link_employee_profile() to mark invites as accepted.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS worker_type   text        DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS invite_status text        DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS invited_at    timestamptz;
-- Constraints (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_worker_type_chk'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_worker_type_chk
      CHECK (worker_type IN ('employee','contractor','subcontractor'));
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_invite_status_chk'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_invite_status_chk
      CHECK (invite_status IN ('not_sent','sent','accepted','expired'));
  END IF;
END$$;
-- Updated linker: also marks invite as accepted on first sign-in.
CREATE OR REPLACE FUNCTION link_employee_profile()
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  UPDATE employees
  SET    profile_id = auth.uid(),
         invite_status = CASE
           WHEN invite_status IN ('sent','expired','not_sent') THEN 'accepted'
           ELSE invite_status
         END
  WHERE  lower(email) = lower(
           (SELECT email FROM auth.users WHERE id = auth.uid())
         )
    AND  profile_id IS NULL;
$$;
-- Hygiene: enable RLS on the only table that didn't have it.
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
