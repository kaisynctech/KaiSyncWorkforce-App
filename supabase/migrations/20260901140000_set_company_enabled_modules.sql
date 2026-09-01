-- Allow owner/hr to persist companies.enabled_modules (Settings → Modules).
-- Direct UPDATE was owner-only via RLS and returned success with 0 rows for HR.

CREATE OR REPLACE FUNCTION public.set_company_enabled_modules(
  p_company_id uuid,
  p_modules jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_access text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_company_id IS NULL OR p_modules IS NULL OR jsonb_typeof(p_modules) <> 'object' THEN
    RAISE EXCEPTION 'Invalid modules payload';
  END IF;

  v_role := public.get_my_role(p_company_id);

  SELECT e.access_level INTO v_access
  FROM public.employees e
  WHERE e.user_id = v_uid
    AND e.company_id = p_company_id
    AND e.is_active = true
  LIMIT 1;

  IF coalesce(v_role, v_access) IS DISTINCT FROM 'owner'
     AND coalesce(v_role, v_access) IS DISTINCT FROM 'hr'
  THEN
    RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: only owner or HR can change modules'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.companies
  SET enabled_modules = p_modules
  WHERE id = p_company_id
    AND id = ANY (public.user_company_ids());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found or not accessible';
  END IF;

  RETURN p_modules;
END;
$$;

REVOKE ALL ON FUNCTION public.set_company_enabled_modules(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_company_enabled_modules(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.set_company_enabled_modules(uuid, jsonb) IS
  'Persists companies.enabled_modules for owner/hr. Used by Settings → Modules.';
