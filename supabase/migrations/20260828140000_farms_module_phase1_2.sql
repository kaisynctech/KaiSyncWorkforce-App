-- ============================================================
-- Farms module Phase 1–2: farms, land units, livestock
-- Module key: farms (opt-in). Permissions: farms.view / farms.edit
-- ============================================================

-- ── Permissions for all existing companies ───────────────────
INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
SELECT c.id, v.role, v.permission_key, v.allowed
FROM public.companies c
CROSS JOIN (
  VALUES
    ('owner',    'farms.view', true),
    ('owner',    'farms.edit', true),
    ('hr',       'farms.view', true),
    ('hr',       'farms.edit', true),
    ('manager',  'farms.view', true),
    ('manager',  'farms.edit', true),
    ('employee', 'farms.view', true),
    ('employee', 'farms.edit', false)
) AS v(role, permission_key, allowed)
ON CONFLICT (company_id, role, permission_key) DO NOTHING;

-- ── farms ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  farm_code   text,
  address     text,
  site_id     uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farms_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_farms_company_code
  ON public.farms (company_id, farm_code)
  WHERE farm_code IS NOT NULL AND length(trim(farm_code)) > 0;

CREATE INDEX IF NOT EXISTS idx_farms_company
  ON public.farms (company_id);

CREATE INDEX IF NOT EXISTS idx_farms_company_active
  ON public.farms (company_id, is_active);

COMMENT ON TABLE public.farms IS
  'Farm register — biological/land operations domain (not inventory).';

ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farms_select ON public.farms;
DROP POLICY IF EXISTS farms_insert ON public.farms;
DROP POLICY IF EXISTS farms_update ON public.farms;
DROP POLICY IF EXISTS farms_delete ON public.farms;

CREATE POLICY farms_select ON public.farms
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farms_insert ON public.farms
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farms_update ON public.farms
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farms_delete ON public.farms
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farms TO authenticated;
REVOKE ALL ON public.farms FROM anon;

-- ── farm_land_units (camps / paddocks / tunnels) ─────────────
CREATE TABLE IF NOT EXISTS public.farm_land_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id       uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  name          text NOT NULL,
  unit_type     text NOT NULL DEFAULT 'camp'
    CHECK (unit_type IN ('camp', 'paddock', 'tunnel', 'orchard', 'field', 'barn', 'other')),
  area_ha       numeric(12, 4),
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_land_units_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_land_units_farm
  ON public.farm_land_units (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_land_units_company
  ON public.farm_land_units (company_id);

ALTER TABLE public.farm_land_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_land_units_select ON public.farm_land_units;
DROP POLICY IF EXISTS farm_land_units_insert ON public.farm_land_units;
DROP POLICY IF EXISTS farm_land_units_update ON public.farm_land_units;
DROP POLICY IF EXISTS farm_land_units_delete ON public.farm_land_units;

CREATE POLICY farm_land_units_select ON public.farm_land_units
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_land_units.farm_id
        AND f.company_id = farm_land_units.company_id
    )
  );

CREATE POLICY farm_land_units_insert ON public.farm_land_units
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_land_units.farm_id
        AND f.company_id = farm_land_units.company_id
    )
  );

CREATE POLICY farm_land_units_update ON public.farm_land_units
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
      WHERE f.id = farm_land_units.farm_id
        AND f.company_id = farm_land_units.company_id
    )
  );

CREATE POLICY farm_land_units_delete ON public.farm_land_units
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_land_units TO authenticated;
REVOKE ALL ON public.farm_land_units FROM anon;

-- ── farm_livestock_groups (flocks / herds / batches) ──────────
CREATE TABLE IF NOT EXISTS public.farm_livestock_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  land_unit_id    uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  name            text NOT NULL,
  species         text NOT NULL DEFAULT 'chicken'
    CHECK (species IN ('chicken', 'cattle', 'sheep', 'goat', 'pig', 'other')),
  breed           text,
  headcount       integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'closed')),
  notes           text,
  acquired_at     date,
  created_by      uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farm_livestock_groups_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_farm_livestock_groups_farm
  ON public.farm_livestock_groups (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_livestock_groups_company
  ON public.farm_livestock_groups (company_id, status);

ALTER TABLE public.farm_livestock_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_livestock_groups_select ON public.farm_livestock_groups;
DROP POLICY IF EXISTS farm_livestock_groups_insert ON public.farm_livestock_groups;
DROP POLICY IF EXISTS farm_livestock_groups_update ON public.farm_livestock_groups;
DROP POLICY IF EXISTS farm_livestock_groups_delete ON public.farm_livestock_groups;

CREATE POLICY farm_livestock_groups_select ON public.farm_livestock_groups
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_livestock_groups_insert ON public.farm_livestock_groups
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_livestock_groups.farm_id
        AND f.company_id = farm_livestock_groups.company_id
    )
  );

CREATE POLICY farm_livestock_groups_update ON public.farm_livestock_groups
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_livestock_groups_delete ON public.farm_livestock_groups
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_livestock_groups TO authenticated;
REVOKE ALL ON public.farm_livestock_groups FROM anon;

-- ── farm_animals (optional individuals) ──────────────────────
CREATE TABLE IF NOT EXISTS public.farm_animals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  group_id        uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  land_unit_id    uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  tag_number      text,
  name            text,
  species         text NOT NULL DEFAULT 'cattle'
    CHECK (species IN ('chicken', 'cattle', 'sheep', 'goat', 'pig', 'other')),
  sex             text CHECK (sex IS NULL OR sex IN ('male', 'female', 'unknown')),
  date_of_birth   date,
  status          text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'dead', 'culled')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_animals_farm
  ON public.farm_animals (farm_id);

CREATE INDEX IF NOT EXISTS idx_farm_animals_group
  ON public.farm_animals (group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_farm_animals_company
  ON public.farm_animals (company_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_farm_animals_tag
  ON public.farm_animals (company_id, farm_id, tag_number)
  WHERE tag_number IS NOT NULL AND length(trim(tag_number)) > 0;

ALTER TABLE public.farm_animals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_animals_select ON public.farm_animals;
DROP POLICY IF EXISTS farm_animals_insert ON public.farm_animals;
DROP POLICY IF EXISTS farm_animals_update ON public.farm_animals;
DROP POLICY IF EXISTS farm_animals_delete ON public.farm_animals;

CREATE POLICY farm_animals_select ON public.farm_animals
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_animals_insert ON public.farm_animals
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_animals_update ON public.farm_animals
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_animals_delete ON public.farm_animals
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_animals TO authenticated;
REVOKE ALL ON public.farm_animals FROM anon;

-- ── farm_livestock_events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_livestock_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  group_id        uuid REFERENCES public.farm_livestock_groups(id) ON DELETE SET NULL,
  animal_id       uuid REFERENCES public.farm_animals(id) ON DELETE SET NULL,
  event_type      text NOT NULL
    CHECK (event_type IN ('intake', 'death', 'cull', 'move', 'count_adjust', 'sale')),
  event_date      date NOT NULL DEFAULT (CURRENT_DATE),
  quantity        integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  from_land_unit_id uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  to_land_unit_id   uuid REFERENCES public.farm_land_units(id) ON DELETE SET NULL,
  notes           text,
  recorded_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_farm_livestock_events_farm
  ON public.farm_livestock_events (farm_id, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_farm_livestock_events_group
  ON public.farm_livestock_events (group_id, event_date DESC)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_farm_livestock_events_company
  ON public.farm_livestock_events (company_id, event_type);

ALTER TABLE public.farm_livestock_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_livestock_events_select ON public.farm_livestock_events;
DROP POLICY IF EXISTS farm_livestock_events_insert ON public.farm_livestock_events;
DROP POLICY IF EXISTS farm_livestock_events_update ON public.farm_livestock_events;
DROP POLICY IF EXISTS farm_livestock_events_delete ON public.farm_livestock_events;

CREATE POLICY farm_livestock_events_select ON public.farm_livestock_events
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.view')
  );

CREATE POLICY farm_livestock_events_insert ON public.farm_livestock_events
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_livestock_events_update ON public.farm_livestock_events
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

CREATE POLICY farm_livestock_events_delete ON public.farm_livestock_events
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'farms.edit')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.farm_livestock_events TO authenticated;
REVOKE ALL ON public.farm_livestock_events FROM anon;

-- Seed farms permissions for any company created later (idempotent helper)
CREATE OR REPLACE FUNCTION public.ensure_farms_permissions(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
  VALUES
    (p_company_id, 'owner',    'farms.view', true),
    (p_company_id, 'owner',    'farms.edit', true),
    (p_company_id, 'hr',       'farms.view', true),
    (p_company_id, 'hr',       'farms.edit', true),
    (p_company_id, 'manager',  'farms.view', true),
    (p_company_id, 'manager',  'farms.edit', true),
    (p_company_id, 'employee', 'farms.view', true),
    (p_company_id, 'employee', 'farms.edit', false)
  ON CONFLICT (company_id, role, permission_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_farms_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_farms_permissions(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
