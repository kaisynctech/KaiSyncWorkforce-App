-- ============================================================
-- Properties Wave G2: per-room iCal import URL for channel sync
-- ============================================================

ALTER TABLE public.property_unit_channel_mappings
  ADD COLUMN IF NOT EXISTS ical_import_url text;

COMMENT ON COLUMN public.property_unit_channel_mappings.ical_import_url IS
  'Optional per-room iCal feed (Airbnb/Booking style). Overrides connection-level URL when set.';

NOTIFY pgrst, 'reload schema';
