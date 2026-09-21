-- ============================================================
-- Properties Wave 6: portfolio snapshot, meters, inspections
-- ============================================================

-- ── Enriched portfolio snapshot ──────────────────────────────
CREATE OR REPLACE FUNCTION public.hr_get_property_snapshot(
  p_company_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_units int := 0;
  v_occupied int := 0;
  v_vacant int := 0;
  v_active_leases int := 0;
  v_arrears_count int := 0;
  v_arrears_total numeric := 0;
  v_active_sites int := 0;
BEGIN
  SELECT COUNT(*) INTO v_units FROM public.units WHERE company_id = p_company_id;
  SELECT COUNT(*) INTO v_occupied FROM public.units WHERE company_id = p_company_id AND is_occupied = true;
  SELECT COUNT(*) INTO v_vacant FROM public.units WHERE company_id = p_company_id AND is_occupied = false;

  IF v_occupied = 0 AND v_vacant = 0 AND v_units > 0 THEN
    SELECT COUNT(*) INTO v_occupied
    FROM public.residents
    WHERE company_id = p_company_id AND move_out_date IS NULL;
    v_occupied := LEAST(v_occupied, v_units);
    v_vacant := GREATEST(v_units - v_occupied, 0);
  END IF;

  SELECT COUNT(*) INTO v_active_sites
  FROM public.sites
  WHERE company_id = p_company_id AND coalesce(is_active, true) = true;

  SELECT COUNT(*) INTO v_active_leases
  FROM public.property_leases
  WHERE company_id = p_company_id AND status = 'active';

  SELECT COUNT(*), COALESCE(SUM(balance_due), 0)
  INTO v_arrears_count, v_arrears_total
  FROM public.finance_invoices
  WHERE company_id = p_company_id
    AND coalesce(invoice_type, 'standard') = 'rent'
    AND status NOT IN ('draft', 'cancelled', 'voided', 'paid')
    AND balance_due > 0
    AND (
      status = 'overdue'
      OR (due_date IS NOT NULL AND due_date < CURRENT_DATE)
    );

  RETURN jsonb_build_object(
    'total_sites', (SELECT COUNT(*) FROM public.sites WHERE company_id = p_company_id),
    'active_sites', v_active_sites,
    'occupied_units', v_occupied,
    'vacant', v_vacant,
    'total_units', v_units,
    'active_leases', v_active_leases,
    'arrears_invoices', v_arrears_count,
    'arrears_total', v_arrears_total,
    'expiring_compliance', (
      SELECT COUNT(*) FROM public.compliance_entries
      WHERE company_id = p_company_id
        AND expiry_date IS NOT NULL
        AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hr_get_property_snapshot(uuid, date, date) IS
  'Portfolio KPIs for Reports → Property: sites, occupancy, leases, rent arrears, compliance.';

-- ── Meters ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_meters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_id       uuid REFERENCES public.units(id) ON DELETE SET NULL,
  meter_type    text NOT NULL
    CHECK (meter_type IN ('electricity', 'water', 'gas', 'other')),
  label         text NOT NULL,
  serial_number text,
  unit_of_measure text NOT NULL DEFAULT 'kWh',
  is_active     boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_meters_label_not_blank CHECK (length(trim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_property_meters_site
  ON public.property_meters (site_id, is_active);

CREATE TABLE IF NOT EXISTS public.property_meter_readings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  meter_id      uuid NOT NULL REFERENCES public.property_meters(id) ON DELETE CASCADE,
  reading_value numeric(18, 4) NOT NULL,
  reading_date  date NOT NULL DEFAULT CURRENT_DATE,
  recorded_by   uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_meter_readings_value_ok CHECK (reading_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_property_meter_readings_meter
  ON public.property_meter_readings (meter_id, reading_date DESC);

-- ── Inspections ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_inspections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  unit_id         uuid REFERENCES public.units(id) ON DELETE SET NULL,
  inspection_type text NOT NULL DEFAULT 'general'
    CHECK (inspection_type IN ('move_in', 'move_out', 'routine', 'general', 'other')),
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  result          text NOT NULL DEFAULT 'pass'
    CHECK (result IN ('pass', 'fail', 'needs_attention', 'pending')),
  inspector_name  text,
  notes           text,
  created_by      uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_inspections_site
  ON public.property_inspections (site_id, inspection_date DESC);

-- RLS
ALTER TABLE public.property_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS property_meters_select ON public.property_meters;
DROP POLICY IF EXISTS property_meters_write ON public.property_meters;
DROP POLICY IF EXISTS property_meter_readings_select ON public.property_meter_readings;
DROP POLICY IF EXISTS property_meter_readings_write ON public.property_meter_readings;
DROP POLICY IF EXISTS property_inspections_select ON public.property_inspections;
DROP POLICY IF EXISTS property_inspections_write ON public.property_inspections;

CREATE POLICY property_meters_select ON public.property_meters
  FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.view'));

CREATE POLICY property_meters_write ON public.property_meters
  FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'));

CREATE POLICY property_meter_readings_select ON public.property_meter_readings
  FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.view'));

CREATE POLICY property_meter_readings_write ON public.property_meter_readings
  FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'));

CREATE POLICY property_inspections_select ON public.property_inspections
  FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.view'));

CREATE POLICY property_inspections_write ON public.property_inspections
  FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'properties.edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_meters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_meter_readings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_inspections TO authenticated;
REVOKE ALL ON public.property_meters FROM anon;
REVOKE ALL ON public.property_meter_readings FROM anon;
REVOKE ALL ON public.property_inspections FROM anon;

NOTIFY pgrst, 'reload schema';
