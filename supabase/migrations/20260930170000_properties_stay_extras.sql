-- ============================================================
-- Stay extras: extra charges billed on the checkout invoice
-- ============================================================

CREATE TABLE IF NOT EXISTS public.property_stay_charges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stay_id      uuid NOT NULL REFERENCES public.property_stays(id) ON DELETE CASCADE,
  description  text NOT NULL,
  amount       numeric NOT NULL,
  created_by   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_stay_charges_description_ok CHECK (length(trim(description)) > 0),
  CONSTRAINT property_stay_charges_amount_ok CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_property_stay_charges_stay
  ON public.property_stay_charges (stay_id);

COMMENT ON TABLE public.property_stay_charges IS
  'Extra stay charges (breakfast, damage, late checkout) included on the checkout invoice.';

ALTER TABLE public.property_stay_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_stay_charges_select ON public.property_stay_charges;
DROP POLICY IF EXISTS property_stay_charges_insert ON public.property_stay_charges;
DROP POLICY IF EXISTS property_stay_charges_delete ON public.property_stay_charges;

CREATE POLICY property_stay_charges_select ON public.property_stay_charges
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.view')
  );

CREATE POLICY property_stay_charges_insert ON public.property_stay_charges
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.property_stays s
      WHERE s.id = stay_id
        AND s.company_id = company_id
        AND s.status IN ('reserved', 'checked_in')
    )
  );

CREATE POLICY property_stay_charges_delete ON public.property_stay_charges
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'properties.edit')
    AND EXISTS (
      SELECT 1 FROM public.property_stays s
      WHERE s.id = stay_id
        AND s.company_id = property_stay_charges.company_id
        AND s.status IN ('reserved', 'checked_in')
    )
  );

GRANT SELECT, INSERT, DELETE ON public.property_stay_charges TO authenticated;
REVOKE ALL ON public.property_stay_charges FROM anon;

NOTIFY pgrst, 'reload schema';
