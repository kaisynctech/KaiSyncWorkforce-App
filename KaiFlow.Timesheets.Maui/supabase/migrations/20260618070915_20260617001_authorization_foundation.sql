-- ============================================================
-- ARCH-001 Migration 1: Authorization Foundation
-- ============================================================

-- ── 0. Drop the stale no-arg trigger-function variant ────────
-- The pre-existing seed_company_role_permissions() was created as
-- RETURNS TRIGGER with the old role taxonomy (hr_admin/admin).
-- It is not wired to any trigger. DROP it so we can recreate
-- with the correct signature: (p_company_id uuid) RETURNS void.
DROP FUNCTION IF EXISTS public.seed_company_role_permissions();

-- ── 1. CHECK constraint: company_relationships.role ──────────
ALTER TABLE public.company_relationships
  ADD CONSTRAINT company_relationships_role_check
  CHECK (role IN ('owner','hr','manager','employee'));

-- ── 2. CHECK constraint: employees.access_level ─────────────
ALTER TABLE public.employees
  ADD CONSTRAINT employees_access_level_check
  CHECK (access_level IN ('owner','hr','manager','employee'));

-- ── 3. get_my_role ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role(p_company_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT role
  FROM company_relationships
  WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND is_active = true
  LIMIT 1;
$$;

-- ── 4. company_role_permissions table ────────────────────────
CREATE TABLE public.company_role_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role           text NOT NULL CHECK (role IN ('owner','hr','manager','employee')),
  permission_key text NOT NULL,
  allowed        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, role, permission_key)
);

ALTER TABLE public.company_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_role_permissions_select
  ON public.company_role_permissions
  FOR SELECT
  USING (company_id = ANY(user_company_ids()));

-- No direct INSERT/UPDATE/DELETE from JWT — writes only via SECURITY DEFINER functions.

-- ── 5. seed_company_role_permissions (plain function, idempotent) ─
-- 29 permission keys × 4 roles = 116 rows per company.
-- Corrections applied per ARCH-001:
--   leave.approve:    manager = TRUE
--   employees.create: manager = FALSE
--   employees.edit:   manager = FALSE
CREATE OR REPLACE FUNCTION public.seed_company_role_permissions(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix text[][] := ARRAY[
    -- owner (all 29 = true)
    ['owner','projects.view',              'true'],
    ['owner','projects.view_all',          'true'],
    ['owner','projects.create',            'true'],
    ['owner','projects.edit',              'true'],
    ['owner','jobs.view',                  'true'],
    ['owner','jobs.view_all',              'true'],
    ['owner','jobs.create',                'true'],
    ['owner','jobs.edit',                  'true'],
    ['owner','employees.view',             'true'],
    ['owner','employees.create',           'true'],
    ['owner','employees.edit',             'true'],
    ['owner','contractors.view',           'true'],
    ['owner','contractors.create',         'true'],
    ['owner','contractors.edit',           'true'],
    ['owner','clients.view',               'true'],
    ['owner','clients.edit',               'true'],
    ['owner','inventory.view',             'true'],
    ['owner','inventory.edit',             'true'],
    ['owner','suppliers.view',             'true'],
    ['owner','suppliers.edit',             'true'],
    ['owner','attendance.view_team',       'true'],
    ['owner','attendance.view_all',        'true'],
    ['owner','leave.view_all',             'true'],
    ['owner','leave.approve',              'true'],
    ['owner','payments.view_payroll',      'true'],
    ['owner','payments.approve',           'true'],
    ['owner','reports.view_operational',   'true'],
    ['owner','reports.view_financial',     'true'],
    ['owner','settings.view',              'true'],
    -- hr (all 29 = true)
    ['hr','projects.view',                 'true'],
    ['hr','projects.view_all',             'true'],
    ['hr','projects.create',               'true'],
    ['hr','projects.edit',                 'true'],
    ['hr','jobs.view',                     'true'],
    ['hr','jobs.view_all',                 'true'],
    ['hr','jobs.create',                   'true'],
    ['hr','jobs.edit',                     'true'],
    ['hr','employees.view',                'true'],
    ['hr','employees.create',              'true'],
    ['hr','employees.edit',                'true'],
    ['hr','contractors.view',              'true'],
    ['hr','contractors.create',            'true'],
    ['hr','contractors.edit',              'true'],
    ['hr','clients.view',                  'true'],
    ['hr','clients.edit',                  'true'],
    ['hr','inventory.view',                'true'],
    ['hr','inventory.edit',                'true'],
    ['hr','suppliers.view',                'true'],
    ['hr','suppliers.edit',                'true'],
    ['hr','attendance.view_team',          'true'],
    ['hr','attendance.view_all',           'true'],
    ['hr','leave.view_all',                'true'],
    ['hr','leave.approve',                 'true'],
    ['hr','payments.view_payroll',         'true'],
    ['hr','payments.approve',              'true'],
    ['hr','reports.view_operational',      'true'],
    ['hr','reports.view_financial',        'true'],
    ['hr','settings.view',                 'true'],
    -- manager (with ARCH-001 corrections)
    ['manager','projects.view',            'true'],
    ['manager','projects.view_all',        'false'],
    ['manager','projects.create',          'true'],
    ['manager','projects.edit',            'true'],
    ['manager','jobs.view',                'true'],
    ['manager','jobs.view_all',            'false'],
    ['manager','jobs.create',              'true'],
    ['manager','jobs.edit',                'true'],
    ['manager','employees.view',           'true'],
    ['manager','employees.create',         'false'],   -- corrected
    ['manager','employees.edit',           'false'],   -- corrected
    ['manager','contractors.view',         'true'],
    ['manager','contractors.create',       'true'],
    ['manager','contractors.edit',         'true'],
    ['manager','clients.view',             'true'],
    ['manager','clients.edit',             'true'],
    ['manager','inventory.view',           'true'],
    ['manager','inventory.edit',           'true'],
    ['manager','suppliers.view',           'true'],
    ['manager','suppliers.edit',           'false'],
    ['manager','attendance.view_team',     'true'],
    ['manager','attendance.view_all',      'false'],
    ['manager','leave.view_all',           'false'],
    ['manager','leave.approve',            'true'],    -- corrected
    ['manager','payments.view_payroll',    'false'],
    ['manager','payments.approve',         'false'],
    ['manager','reports.view_operational', 'true'],
    ['manager','reports.view_financial',   'false'],
    ['manager','settings.view',            'false'],
    -- employee
    ['employee','projects.view',           'true'],
    ['employee','projects.view_all',       'false'],
    ['employee','projects.create',         'false'],
    ['employee','projects.edit',           'false'],
    ['employee','jobs.view',               'true'],
    ['employee','jobs.view_all',           'false'],
    ['employee','jobs.create',             'false'],
    ['employee','jobs.edit',               'false'],
    ['employee','employees.view',          'false'],
    ['employee','employees.create',        'false'],
    ['employee','employees.edit',          'false'],
    ['employee','contractors.view',        'false'],
    ['employee','contractors.create',      'false'],
    ['employee','contractors.edit',        'false'],
    ['employee','clients.view',            'true'],
    ['employee','clients.edit',            'false'],
    ['employee','inventory.view',          'true'],
    ['employee','inventory.edit',          'false'],
    ['employee','suppliers.view',          'false'],
    ['employee','suppliers.edit',          'false'],
    ['employee','attendance.view_team',    'false'],
    ['employee','attendance.view_all',     'false'],
    ['employee','leave.view_all',          'false'],
    ['employee','leave.approve',           'false'],
    ['employee','payments.view_payroll',   'true'],
    ['employee','payments.approve',        'false'],
    ['employee','reports.view_operational','false'],
    ['employee','reports.view_financial',  'false'],
    ['employee','settings.view',           'false']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_matrix, 1) LOOP
    INSERT INTO public.company_role_permissions
      (company_id, role, permission_key, allowed)
    VALUES (
      p_company_id,
      v_matrix[i][1],
      v_matrix[i][2],
      v_matrix[i][3]::boolean
    )
    ON CONFLICT (company_id, role, permission_key) DO NOTHING;
  END LOOP;
END;
$$;

-- ── 6. Backfill all existing companies ───────────────────────
SELECT seed_company_role_permissions(id) FROM public.companies;

-- ── 7. Trigger: seed permissions for every new company ───────
CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_permissions()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM seed_company_role_permissions(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_company_permissions
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_company_permissions();

-- ── 8. Trigger: sync employees.access_level → company_relationships.role ─
CREATE OR REPLACE FUNCTION public.sync_employee_role_to_relationship()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    UPDATE public.company_relationships
    SET role = NEW.access_level
    WHERE user_id  = NEW.user_id
      AND company_id = NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_employee_role
  AFTER UPDATE OF access_level ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.sync_employee_role_to_relationship();

-- ── 9. my_permissions (replace broken version) ───────────────
CREATE OR REPLACE FUNCTION public.my_permissions(p_company_id uuid)
RETURNS TABLE(permission_key text, allowed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  v_role := get_my_role(p_company_id);
  IF v_role IS NULL THEN RETURN; END IF;

  IF v_role = 'owner' THEN
    RETURN QUERY
      SELECT DISTINCT crp.permission_key, true::boolean
      FROM company_role_permissions crp
      WHERE crp.company_id = p_company_id
        AND crp.role = 'owner';
    RETURN;
  END IF;

  RETURN QUERY
    SELECT crp.permission_key, crp.allowed
    FROM company_role_permissions crp
    WHERE crp.company_id = p_company_id
      AND crp.role = v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.my_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated;;
