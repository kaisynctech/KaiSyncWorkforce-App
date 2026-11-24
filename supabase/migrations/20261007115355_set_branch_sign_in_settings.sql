-- Allow owner / HR / manager to persist branch sign-in geofence flags in
-- companies.custom_settings.dispatch_settings (direct companies UPDATE is owner-only).

CREATE OR REPLACE FUNCTION public.set_branch_sign_in_settings(
  p_company_id uuid,
  p_enforce boolean,
  p_radius_meters numeric DEFAULT NULL
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
  v_custom jsonb;
  v_dispatch jsonb;
  v_radius numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_company_id IS NULL OR p_enforce IS NULL THEN
    RAISE EXCEPTION 'Invalid payload';
  END IF;

  v_role := public.get_my_role(p_company_id);

  SELECT e.access_level INTO v_access
  FROM public.employees e
  WHERE e.user_id = v_uid
    AND e.company_id = p_company_id
    AND e.is_active = true
  LIMIT 1;

  IF coalesce(v_role, v_access) NOT IN ('owner', 'hr', 'manager', 'admin', 'hr_admin') THEN
    RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: only owner, HR, or manager can change branch sign-in settings'
      USING ERRCODE = '42501';
  END IF;

  IF p_radius_meters IS NOT NULL THEN
    IF p_radius_meters < 25 OR p_radius_meters > 5000 THEN
      RAISE EXCEPTION 'Radius must be between 25 and 5000 metres';
    END IF;
    v_radius := round(p_radius_meters);
  END IF;

  SELECT coalesce(c.custom_settings, '{}'::jsonb)
  INTO v_custom
  FROM public.companies c
  WHERE c.id = p_company_id
    AND c.id = ANY (public.user_company_ids())
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found or not accessible';
  END IF;

  v_dispatch := coalesce(v_custom->'dispatch_settings', '{}'::jsonb);
  v_dispatch := jsonb_set(v_dispatch, '{enforce_branch_sign_in_radius}', to_jsonb(p_enforce), true);

  IF v_radius IS NOT NULL THEN
    v_dispatch := jsonb_set(v_dispatch, '{branch_sign_in_radius_m}', to_jsonb(v_radius), true);
  END IF;

  v_custom := jsonb_set(v_custom, '{dispatch_settings}', v_dispatch, true);

  UPDATE public.companies
  SET custom_settings = v_custom
  WHERE id = p_company_id;

  RETURN v_dispatch;
END;
$$;

REVOKE ALL ON FUNCTION public.set_branch_sign_in_settings(uuid, boolean, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_branch_sign_in_settings(uuid, boolean, numeric) TO authenticated;

COMMENT ON FUNCTION public.set_branch_sign_in_settings(uuid, boolean, numeric) IS
  'Persists enforce_branch_sign_in_radius (+ optional default radius) under custom_settings.dispatch_settings.';
