-- ============================================================
-- Properties Wave 1: permission keys (app-layer + seed)
-- Module remains property_management; keys: properties.view / properties.edit
-- ============================================================

INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
SELECT c.id, v.role, v.permission_key, v.allowed
FROM public.companies c
CROSS JOIN (
  VALUES
    ('owner',    'properties.view', true),
    ('owner',    'properties.edit', true),
    ('hr',       'properties.view', true),
    ('hr',       'properties.edit', true),
    ('manager',  'properties.view', true),
    ('manager',  'properties.edit', true),
    ('employee', 'properties.view', true),
    ('employee', 'properties.edit', false)
) AS v(role, permission_key, allowed)
ON CONFLICT (company_id, role, permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_properties_permissions(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
  VALUES
    (p_company_id, 'owner',    'properties.view', true),
    (p_company_id, 'owner',    'properties.edit', true),
    (p_company_id, 'hr',       'properties.view', true),
    (p_company_id, 'hr',       'properties.edit', true),
    (p_company_id, 'manager',  'properties.view', true),
    (p_company_id, 'manager',  'properties.edit', true),
    (p_company_id, 'employee', 'properties.view', true),
    (p_company_id, 'employee', 'properties.edit', false)
  ON CONFLICT (company_id, role, permission_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_properties_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_properties_permissions(uuid) TO service_role;

-- Extend new-company seed to include properties + farms permissions
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
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_farms_permissions'
  ) THEN
    PERFORM public.ensure_farms_permissions(NEW.id);
  END IF;
  PERFORM public.ensure_properties_permissions(NEW.id);
  RETURN NEW;
END;
$$;

-- Unique unit number per site (case-insensitive) — only if no duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.units
    WHERE unit_number IS NOT NULL AND length(trim(unit_number)) > 0
    GROUP BY site_id, lower(trim(unit_number))
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_units_site_unit_number
      ON public.units (site_id, lower(trim(unit_number)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sites_company_active
  ON public.sites (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_units_site
  ON public.units (site_id);

CREATE INDEX IF NOT EXISTS idx_residents_site
  ON public.residents (site_id);

CREATE INDEX IF NOT EXISTS idx_residents_unit
  ON public.residents (unit_id)
  WHERE unit_id IS NOT NULL;
