-- ============================================================
-- Properties Wave A: unit hub foundations
-- - units.default_rent_amount (advertised / vacant list rent)
-- - residents.id_number / passport_number
-- - property_kind: student_accommodation, guest_house
-- ============================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS default_rent_amount numeric(14, 2),
  ADD COLUMN IF NOT EXISTS default_rent_currency text NOT NULL DEFAULT 'ZAR';

COMMENT ON COLUMN public.units.default_rent_amount IS
  'Advertised / vacant list rent. Active lease rent_amount takes precedence when occupied.';
COMMENT ON COLUMN public.units.default_rent_currency IS
  'Currency for default_rent_amount (default ZAR).';

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS id_number text,
  ADD COLUMN IF NOT EXISTS passport_number text;

COMMENT ON COLUMN public.residents.id_number IS
  'South African ID number when the resident has one.';
COMMENT ON COLUMN public.residents.passport_number IS
  'Passport number when no SA ID is used.';

ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_property_kind_check;
ALTER TABLE public.sites
  ADD CONSTRAINT sites_property_kind_check
  CHECK (property_kind = ANY (ARRAY[
    'residential'::text,
    'commercial'::text,
    'mixed'::text,
    'student_accommodation'::text,
    'guest_house'::text,
    'other'::text
  ]));

COMMENT ON COLUMN public.sites.property_kind IS
  'Portfolio classification: residential, commercial, mixed, student_accommodation, guest_house, other.';
