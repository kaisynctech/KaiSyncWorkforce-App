-- ============================================================
-- Properties Wave D: B&B / guest house stays + room housekeeping
-- ============================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS housekeeping_status text NOT NULL DEFAULT 'clean';

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_housekeeping_status_check;
ALTER TABLE public.units
  ADD CONSTRAINT units_housekeeping_status_check
  CHECK (housekeeping_status = ANY (ARRAY[
    'clean'::text,
    'dirty'::text,
    'inspected'::text,
    'out_of_order'::text
  ]));

COMMENT ON COLUMN public.units.housekeeping_status IS
  'Room board status for short-stay (B&B / guest house): clean, dirty, inspected, out_of_order.';

CREATE TABLE IF NOT EXISTS public.property_stays (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_id             uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
  guest_name          text NOT NULL,
  guest_surname       text NOT NULL DEFAULT '',
  guest_phone         text,
  guest_email         text,
  id_number           text,
  passport_number     text,
  check_in_date       date NOT NULL,
  check_out_date      date NOT NULL,
  check_in_at         timestamptz,
  check_out_at        timestamptz,
  status              text NOT NULL DEFAULT 'reserved'
    CHECK (status = ANY (ARRAY[
      'reserved'::text,
      'checked_in'::text,
      'checked_out'::text,
      'cancelled'::text,
      'no_show'::text
    ])),
  adults              integer NOT NULL DEFAULT 1
    CHECK (adults >= 1 AND adults <= 20),
  children            integer NOT NULL DEFAULT 0
    CHECK (children >= 0 AND children <= 20),
  nightly_rate        numeric(14, 2),
  total_amount        numeric(14, 2),
  deposit_amount      numeric(14, 2),
  deposit_status      text NOT NULL DEFAULT 'none'
    CHECK (deposit_status = ANY (ARRAY[
      'none'::text,
      'due'::text,
      'paid'::text,
      'held'::text,
      'refunded'::text
    ])),
  currency            text NOT NULL DEFAULT 'ZAR',
  notes               text,
  created_by          uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_stays_dates_ok CHECK (check_out_date >= check_in_date),
  CONSTRAINT property_stays_guest_name_ok CHECK (length(trim(guest_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_property_stays_site_status
  ON public.property_stays (site_id, status);

CREATE INDEX IF NOT EXISTS idx_property_stays_unit_dates
  ON public.property_stays (unit_id, check_in_date, check_out_date);

CREATE INDEX IF NOT EXISTS idx_property_stays_company
  ON public.property_stays (company_id, check_in_date DESC);

COMMENT ON TABLE public.property_stays IS
  'Short-stay bookings for B&B / guest house properties (not long-stay leases).';

ALTER TABLE public.property_stays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_stays_select ON public.property_stays;
DROP POLICY IF EXISTS property_stays_insert ON public.property_stays;
DROP POLICY IF EXISTS property_stays_update ON public.property_stays;
DROP POLICY IF EXISTS property_stays_delete ON public.property_stays;

CREATE POLICY property_stays_select ON public.property_stays
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_stays_insert ON public.property_stays
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.sites s
      WHERE s.id = property_stays.site_id
        AND s.company_id = property_stays.company_id
    )
    AND EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.id = property_stays.unit_id
        AND u.company_id = property_stays.company_id
        AND u.site_id = property_stays.site_id
    )
  );

CREATE POLICY property_stays_update ON public.property_stays
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

CREATE POLICY property_stays_delete ON public.property_stays
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_stays TO authenticated;
REVOKE ALL ON public.property_stays FROM anon;
