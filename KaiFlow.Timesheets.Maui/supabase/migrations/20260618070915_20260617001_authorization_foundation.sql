-- ARCH-001 Migration 1: Authorization Foundation
-- Introduces role-based access control primitives.

-- company_role_permissions: per-company overridable permission matrix
CREATE TABLE IF NOT EXISTS public.company_role_permissions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id     uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role           text        NOT NULL,
  permission_key text        NOT NULL,
  allowed        boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_role_permissions_unique UNIQUE (company_id, role, permission_key)
);

-- get_my_role: returns the calling user's role for a company
CREATE OR REPLACE FUNCTION public.get_my_role(p_company_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT role
  FROM company_relationships
  WHERE user_id = auth.uid()
    AND company_id = p_company_id
    AND is_active = true
  LIMIT 1;
$$;

-- user_has_permission: checks whether the calling user has a permission key
CREATE OR REPLACE FUNCTION public.user_has_permission(p_company_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role    text;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  v_role := get_my_role(p_company_id);

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Owners have all permissions — short-circuit
  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  SELECT allowed
  INTO v_allowed
  FROM company_role_permissions
  WHERE company_id    = p_company_id
    AND role          = v_role
    AND permission_key = p_permission_key
  LIMIT 1;

  RETURN COALESCE(v_allowed, false);
END;
$$;

-- is_company_owner (uuid overload)
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.companies c
        WHERE c.id = p_company_id AND c.owner_user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.company_id = p_company_id
          AND e.user_id = auth.uid()
          AND e.access_level IN ('owner', 'admin', 'hr_admin')
          AND coalesce(e.is_active, true)
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_permission(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_my_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_role(uuid) TO anon;
