-- ============================================================
-- Farms Wave 2: plantings (crops) + production lots (eggs/milk/honey)
-- Reuses farms.view / farms.edit. Not inventory.
-- ============================================================

-- Hook farms permissions into new-company seed trigger
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

-- ── farm_plantings ───────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_farm_plantings_farm
  ON public.farm_plantings (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_plantings_company
  ON public.farm_plantings (company_id, status);

COMMENT ON TABLE public.farm_plantings IS
  'Crop / planting batches — biological domain (not inventory SKUs).';

ALTER TABLE public.farm_plantings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_plantings_select ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_insert ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_update ON public.farm_plantings;
DROP POLICY IF EXISTS farm_plantings_delete ON public.farm_plantings;

CREATE POLICY farm_plantings_select ON public.farm_plantings
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_plantings.farm_id
        AND f.company_id = farm_plantings.company_id
    )
  );

CREATE POLICY farm_plantings_insert ON public.farm_plantings
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_plantings.farm_id
        AND f.company_id = farm_plantings.company_id
    )
  );

CREATE POLICY farm_plantings_update ON public.farm_plantings
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_plantings.farm_id
        AND f.company_id = farm_plantings.company_id
    )
  );

CREATE POLICY farm_plantings_delete ON public.farm_plantings
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_plantings TO authenticated;
REVOKE ALL ON public.farm_plantings FROM anon;

-- ── farm_planting_events ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_planting_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  planting_id     uuid NOT NULL REFERENCES public.farm_plantings(id) ON DELETE CASCADE,
  event_type      text NOT NULL
    CHECK (event_type IN ('plant', 'input', 'loss', 'harvest', 'status_note')),
  event_date      date NOT NULL DEFAULT (CURRENT_DATE),
  quantity        numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit            text NOT NULL DEFAULT 'kg'
    CHECK (unit IN ('kg', 'tonne', 'crate', 'bunch', 'each', 'other')),
  notes           text,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_planting_events_planting
  ON public.farm_planting_events (planting_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_planting_events_farm
  ON public.farm_planting_events (farm_id, event_date DESC);

ALTER TABLE public.farm_planting_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_planting_events_select ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_insert ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_update ON public.farm_planting_events;
DROP POLICY IF EXISTS farm_planting_events_delete ON public.farm_planting_events;

CREATE POLICY farm_planting_events_select ON public.farm_planting_events
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_planting_events_insert ON public.farm_planting_events
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_planting_events_update ON public.farm_planting_events
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_planting_events_delete ON public.farm_planting_events
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_planting_events TO authenticated;
REVOKE ALL ON public.farm_planting_events FROM anon;

-- ── farm_production_lots ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_production_lots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id          uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  land_unit_id     uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  name             text NOT NULL,
  product_type     text NOT NULL DEFAULT 'eggs'
    CHECK (product_type IN ('eggs', 'milk', 'honey', 'other')),
  quantity_total   numeric(14, 3) NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  unit             text NOT NULL DEFAULT 'dozen'
    CHECK (unit IN ('dozen', 'each', 'litre', 'kg', 'other')),
  status           text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'sold')),
  period_start     date,
  period_end       date,
  notes            text,
  created_by       uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_production_lots_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_production_lots_farm
  ON public.farm_production_lots (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_production_lots_company
  ON public.farm_production_lots (company_id, product_type, status);

CREATE INDEX IF NOT EXISTS idx_farm_production_lots_group
  ON public.farm_production_lots (group_id)
  WHERE group_id IS NOT NULL;

COMMENT ON TABLE public.farm_production_lots IS
  'Biological production lots (eggs, milk, honey) — not warehouse inventory.';

ALTER TABLE public.farm_production_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_production_lots_select ON public.farm_production_lots;
DROP POLICY IF EXISTS farm_production_lots_insert ON public.farm_production_lots;
DROP POLICY IF EXISTS farm_production_lots_update ON public.farm_production_lots;
DROP POLICY IF EXISTS farm_production_lots_delete ON public.farm_production_lots;

CREATE POLICY farm_production_lots_select ON public.farm_production_lots
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_production_lots.farm_id
        AND f.company_id = farm_production_lots.company_id
    )
  );

CREATE POLICY farm_production_lots_insert ON public.farm_production_lots
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_production_lots.farm_id
        AND f.company_id = farm_production_lots.company_id
    )
  );

CREATE POLICY farm_production_lots_update ON public.farm_production_lots
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_production_lots.farm_id
        AND f.company_id = farm_production_lots.company_id
    )
  );

CREATE POLICY farm_production_lots_delete ON public.farm_production_lots
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_production_lots TO authenticated;
REVOKE ALL ON public.farm_production_lots FROM anon;

-- ── farm_production_events ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_production_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  lot_id          uuid NOT NULL REFERENCES public.farm_production_lots(id) ON DELETE CASCADE,
  event_type      text NOT NULL
    CHECK (event_type IN ('collect', 'loss', 'sale', 'adjust')),
  event_date      date NOT NULL DEFAULT (CURRENT_DATE),
  quantity        numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes           text,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_production_events_lot
  ON public.farm_production_events (lot_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_production_events_farm
  ON public.farm_production_events (farm_id, event_date DESC);

ALTER TABLE public.farm_production_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_production_events_select ON public.farm_production_events;
DROP POLICY IF EXISTS farm_production_events_insert ON public.farm_production_events;
DROP POLICY IF EXISTS farm_production_events_update ON public.farm_production_events;
DROP POLICY IF EXISTS farm_production_events_delete ON public.farm_production_events;

CREATE POLICY farm_production_events_select ON public.farm_production_events
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_production_events_insert ON public.farm_production_events
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_production_events_update ON public.farm_production_events
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_production_events_delete ON public.farm_production_events
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_production_events TO authenticated;
REVOKE ALL ON public.farm_production_events FROM anon;

NOTIFY pgrst, 'reload schema';
