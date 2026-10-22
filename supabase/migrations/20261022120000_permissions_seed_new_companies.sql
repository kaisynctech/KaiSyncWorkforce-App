-- W1 / B1: new companies were created without role permissions.
-- Root cause: trg_fn_seed_company_permissions calls seed_company_role_permissions(), which since the
-- 18 Jun 2026 hardening requires a step-up session. A brand-new owner never has one at sign-up, so the
-- call raised STEP_UP_REQUIRED, the trigger swallowed it (RAISE NOTICE) and the company got only the
-- farms/properties rows. The app's screen gate (my_permissions) then denied the owner 8 modules.
--
-- Fix (additive):
--  1. permission_defaults: the canonical default matrix (59 permissions x 5 roles). Values copied from
--     the three existing companies, which are identical row for row (verified 22 Oct 2026).
--  2. _seed_company_permissions_from_defaults(company): internal, no session checks, not callable by
--     app roles. Used by the company-creation trigger.
--  3. The trigger now seeds from defaults and records a visible app_events error if seeding ever fails,
--     instead of hiding it.
--  4. my_permissions: owner/admin also receive every default permission, so an owner is never locked
--     out of a module because a company's rows are incomplete. (The database already allowed them:
--     user_has_permission returns true for owner/admin.)
--  5. Repair the one affected company (Ironvale Construction (Playground)) by seeding missing rows.
-- seed_company_role_permissions (step-up protected) is left unchanged for manual use.

CREATE TABLE IF NOT EXISTS public.permission_defaults (
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'hr', 'manager', 'employee')),
  permission_key text NOT NULL,
  allowed boolean NOT NULL,
  PRIMARY KEY (role, permission_key)
);
ALTER TABLE public.permission_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permission_defaults FROM anon, authenticated;
COMMENT ON TABLE public.permission_defaults IS
  'Default role permissions for new companies. When a migration adds a permission key, add it here too.';

INSERT INTO public.permission_defaults (role, permission_key, allowed)
SELECT role, permission_key, allowed
FROM public.company_role_permissions
WHERE company_id = (SELECT id FROM public.companies WHERE code = '28')
ON CONFLICT (role, permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public._seed_company_permissions_from_defaults(p_company_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
  SELECT p_company_id, d.role, d.permission_key, d.allowed FROM public.permission_defaults d
  ON CONFLICT (company_id, role, permission_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public._seed_company_permissions_from_defaults(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_fn_seed_company_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN
    PERFORM public._seed_company_permissions_from_defaults(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Company creation must not fail, but the problem must be visible.
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta, created_at)
    VALUES (NEW.id, auth.uid(), 'CompanySetup', 'company_permissions_seed_failed', 'error',
            jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM), now());
  END;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'ensure_farms_permissions') THEN
    PERFORM public.ensure_farms_permissions(NEW.id);
  END IF;
  PERFORM public.ensure_properties_permissions(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_permissions(p_company_id uuid)
RETURNS TABLE(permission_key text, allowed boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  v_role := get_my_role(p_company_id);
  IF v_role IS NULL THEN RETURN; END IF;
  IF public.role_is_owner_or_admin(v_role) THEN
    RETURN QUERY
      SELECT k.permission_key, true::boolean FROM (
        SELECT crp.permission_key FROM company_role_permissions crp
        WHERE crp.company_id = p_company_id AND crp.role = 'owner'
        UNION
        SELECT d.permission_key FROM permission_defaults d WHERE d.role = 'owner'
      ) k;
    RETURN;
  END IF;
  RETURN QUERY SELECT crp.permission_key, crp.allowed FROM company_role_permissions crp
    WHERE crp.company_id = p_company_id AND crp.role = v_role;
END;
$$;

-- Repair: seed any company that is missing default rows (today: only Ironvale, company code 32).
SELECT c.code, public._seed_company_permissions_from_defaults(c.id) AS rows_added
FROM public.companies c
WHERE (SELECT count(*) FROM public.company_role_permissions p WHERE p.company_id = c.id)
      < (SELECT count(*) FROM public.permission_defaults);
