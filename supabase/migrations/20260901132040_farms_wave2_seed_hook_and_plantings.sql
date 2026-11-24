-- 20260901132040_farms_wave2_seed_hook_and_plantings
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.seed_company_role_permissions(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'seed_company_role_permissions failed for %: % %', NEW.id, SQLSTATE, SQLERRM;
  END;
  PERFORM public.ensure_farms_permissions(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.farm_plantings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id              uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  land_unit_id         uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  name                 text NOT NULL,
  crop_type            text NOT NULL DEFAULT 'vegetable'
    CHECK (crop_type IN ('vegetable', 'fruit', 'grain', 'other')),
  variety              text,
  area_ha              numeric(12, 4),
  plant_count          integer CHECK (plant_count IS NULL OR plant_count >= 0),
  planted_at           date,
  expected_harvest_at  date,
  total_harvested      numeric(14, 3) NOT NULL DEFAULT 0 CHECK (total_harvested >= 0),
  harvest_unit         text NOT NULL DEFAULT 'kg'
    CHECK (harvest_unit IN ('kg', 'tonne', 'crate', 'bunch', 'each', 'other')),
  status               text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'harvested', 'abandoned')),
  notes                text,
  created_by           uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_plantings_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_plantings_farm ON public.farm_plantings (farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_plantings_company ON public.farm_plantings (company_id, status);
COMMENT ON TABLE public.farm_plantings IS 'Crop / planting batches — biological domain (not inventory SKUs).';
ALTER TABLE public.farm_plantings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS farm_plantings_select ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_insert ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_update ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_delete ON public.farm_plantings;
CREATE POLICY farm_plantings_select ON public.farm_plantings FOR SELECT TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.view') AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_plantings.farm_id AND f.company_id = farm_plantings.company_id));
CREATE POLICY farm_plantings_insert ON public.farm_plantings FOR INSERT TO authenticated WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit') AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_plantings.farm_id AND f.company_id = farm_plantings.company_id));
CREATE POLICY farm_plantings_update ON public.farm_plantings FOR UPDATE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit')) WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit') AND EXISTS (SELECT 1 FROM public.farms f WHERE f.id = farm_plantings.farm_id AND f.company_id = farm_plantings.company_id));
CREATE POLICY farm_plantings_delete ON public.farm_plantings FOR DELETE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_plantings TO authenticated;
REVOKE ALL ON public.farm_plantings FROM anon;

CREATE TABLE IF NOT EXISTS public.farm_planting_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  planting_id     uuid NOT NULL REFERENCES public.farm_plantings(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN ('plant', 'input', 'loss', 'harvest', 'status_note')),
  event_date      date NOT NULL DEFAULT (CURRENT_DATE),
  quantity        numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit            text NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'tonne', 'crate', 'bunch', 'each', 'other')),
  notes           text,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_farm_planting_events_planting ON public.farm_planting_events (planting_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_farm_planting_events_farm ON public.farm_planting_events (farm_id, event_date DESC);
ALTER TABLE public.farm_planting_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS farm_planting_events_select ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_insert ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_update ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_delete ON public.farm_planting_events;
CREATE POLICY farm_planting_events_select ON public.farm_planting_events FOR SELECT TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.view'));
CREATE POLICY farm_planting_events_insert ON public.farm_planting_events FOR INSERT TO authenticated WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
CREATE POLICY farm_planting_events_update ON public.farm_planting_events FOR UPDATE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit')) WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
CREATE POLICY farm_planting_events_delete ON public.farm_planting_events FOR DELETE TO authenticated USING (company_id = ANY (public.user_company_ids()) AND public.user_has_permission(company_id, 'farms.edit'));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_planting_events TO authenticated;
REVOKE ALL ON public.farm_planting_events FROM anon;
