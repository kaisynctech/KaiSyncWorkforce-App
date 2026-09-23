-- ============================================================
-- Properties Wave F4: resident emergency / next-of-kin contact
-- ============================================================

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

COMMENT ON COLUMN public.residents.emergency_contact_name IS
  'Next of kin / emergency contact full name.';
COMMENT ON COLUMN public.residents.emergency_contact_phone IS
  'Emergency contact phone number.';
COMMENT ON COLUMN public.residents.emergency_contact_relationship IS
  'Relationship to resident (e.g. parent, spouse, sibling).';

NOTIFY pgrst, 'reload schema';
