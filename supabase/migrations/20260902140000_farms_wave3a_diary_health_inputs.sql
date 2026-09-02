-- ============================================================
-- Farms Wave 3A: diary, health events, input usages (feed/meds)
-- Reuses farms.view / farms.edit. Inventory link optional.
-- ============================================================

-- ── farm_diary_entries ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_diary_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  land_unit_id    uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  group_id        uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  planting_id     uuid REFERENCES public.farm_plantings(id) ON DELETE SET NULL,
  animal_id       uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  entry_date      date NOT NULL DEFAULT (CURRENT_DATE),
  title           text,
  body            text NOT NULL,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_diary_entries_body_not_blank CHECK (length(trim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_diary_entries_farm
  ON public.farm_diary_entries (farm_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_diary_entries_company
  ON public.farm_diary_entries (company_id, entry_date DESC);

COMMENT ON TABLE public.farm_diary_entries IS
  'Farm diary / daily ops notes — replaces paper notebooks.';

ALTER TABLE public.farm_diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_diary_entries_select ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_insert ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_update ON public.farm_diary_entries;
DROP POLICY IF EXISTS farm_diary_entries_delete ON public.farm_diary_entries;

CREATE POLICY farm_diary_entries_select ON public.farm_diary_entries
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_diary_entries_insert ON public.farm_diary_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_diary_entries.farm_id
        AND f.company_id = farm_diary_entries.company_id
    )
  );

CREATE POLICY farm_diary_entries_update ON public.farm_diary_entries
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_diary_entries_delete ON public.farm_diary_entries
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_diary_entries TO authenticated;
REVOKE ALL ON public.farm_diary_entries FROM anon;

-- ── farm_health_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_health_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id             uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  group_id            uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  animal_id           uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  event_type          text NOT NULL
    CHECK (event_type IN (
      'illness', 'injury', 'treatment', 'vaccine',
      'vet_visit', 'observation', 'quarantine', 'recovery'
    )),
  event_date          date NOT NULL DEFAULT (CURRENT_DATE),
  product_label       text,
  inventory_item_id   uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  dosage              text,
  withdrawal_until    date,
  notes               text,
  recorded_by         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_health_events_farm
  ON public.farm_health_events (farm_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_health_events_group
  ON public.farm_health_events (group_id, event_date DESC)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_farm_health_events_company
  ON public.farm_health_events (company_id, event_type);

COMMENT ON TABLE public.farm_health_events IS
  'Livestock health / medicine book events (not inventory SKUs).';

ALTER TABLE public.farm_health_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_health_events_select ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_insert ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_update ON public.farm_health_events;
DROP POLICY IF EXISTS farm_health_events_delete ON public.farm_health_events;

CREATE POLICY farm_health_events_select ON public.farm_health_events
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_health_events_insert ON public.farm_health_events
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_health_events.farm_id
        AND f.company_id = farm_health_events.company_id
    )
  );

CREATE POLICY farm_health_events_update ON public.farm_health_events
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_health_events_delete ON public.farm_health_events
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_health_events TO authenticated;
REVOKE ALL ON public.farm_health_events FROM anon;

-- ── farm_input_usages (feed / meds / crop inputs) ─────────────
CREATE TABLE IF NOT EXISTS public.farm_input_usages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id             uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  usage_type          text NOT NULL
    CHECK (usage_type IN ('feed', 'medication', 'vaccine', 'fertilizer', 'chemical', 'other')),
  usage_date          date NOT NULL DEFAULT (CURRENT_DATE),
  quantity            numeric(14, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit                text NOT NULL DEFAULT 'kg'
    CHECK (unit IN ('kg', 'tonne', 'bag', 'litre', 'ml', 'dose', 'each', 'other')),
  product_label       text,
  inventory_item_id   uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  deducted_from_stock boolean NOT NULL DEFAULT false,
  group_id            uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  animal_id           uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  planting_id         uuid REFERENCES public.farm_plantings(id) ON DELETE SET NULL,
  land_unit_id        uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  withdrawal_until    date,
  notes               text,
  recorded_by         uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_input_usages_farm
  ON public.farm_input_usages (farm_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_input_usages_company
  ON public.farm_input_usages (company_id, usage_type);

CREATE INDEX IF NOT EXISTS idx_farm_input_usages_group
  ON public.farm_input_usages (group_id, usage_date DESC)
  WHERE group_id IS NOT NULL;

COMMENT ON TABLE public.farm_input_usages IS
  'Feed / treatment / input log. Optional inventory_item_id; stock deduct via hr_inventory_stock_movement.';

ALTER TABLE public.farm_input_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_input_usages_select ON public.farm_input_usages;
DROP POLICY IF EXISTS farm_input_usages_insert ON public.farm_input_usages;
DROP POLICY IF EXISTS farm_input_usages_update ON public.farm_input_usages;
DROP POLICY IF EXISTS farm_input_usages_delete ON public.farm_input_usages;

CREATE POLICY farm_input_usages_select ON public.farm_input_usages
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_input_usages_insert ON public.farm_input_usages
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_input_usages.farm_id
        AND f.company_id = farm_input_usages.company_id
    )
  );

CREATE POLICY farm_input_usages_update ON public.farm_input_usages
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_input_usages_delete ON public.farm_input_usages
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_input_usages TO authenticated;
REVOKE ALL ON public.farm_input_usages FROM anon;

NOTIFY pgrst, 'reload schema';
