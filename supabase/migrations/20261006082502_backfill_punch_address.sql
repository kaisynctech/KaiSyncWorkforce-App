-- Allow backfilling a human place name onto a punch that only has GPS.
-- Does not change lat/lng or other fields. Used when reverse-geocode succeeds
-- after the punch was already saved (Nominatim flake / offline race).

CREATE OR REPLACE FUNCTION public.backfill_punch_address(
  p_company_id uuid,
  p_punch_id uuid,
  p_address text,
  p_session_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp uuid;
  v_addr text := nullif(btrim(p_address), '');
BEGIN
  IF v_addr IS NULL THEN
    RAISE EXCEPTION 'Address is required' USING ERRCODE = 'P0001';
  END IF;

  -- Reject if the "address" is still raw coordinates.
  IF v_addr ~ '^-?[0-9]{1,3}\.[0-9]+\s*,\s*-?[0-9]{1,3}\.[0-9]+$' THEN
    RAISE EXCEPTION 'Address must be a place name, not coordinates' USING ERRCODE = 'P0001';
  END IF;

  SELECT employee_id INTO v_emp
  FROM public.time_punches
  WHERE id = p_punch_id AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Punch not found' USING ERRCODE = 'P0002';
  END IF;

  -- HR/manager/owner via JWT, or the worker who owns the punch (code session).
  BEGIN
    PERFORM public._assert_worker_access(p_company_id, v_emp, p_session_token);
  EXCEPTION WHEN OTHERS THEN
    IF auth.uid() IS NULL OR get_my_role(p_company_id) NOT IN ('owner', 'hr', 'manager') THEN
      RAISE;
    END IF;
  END;

  UPDATE public.time_punches
  SET address = v_addr
  WHERE id = p_punch_id
    AND company_id = p_company_id
    AND (
      address IS NULL
      OR btrim(address) = ''
      OR address ~ '^-?[0-9]{1,3}\.[0-9]+\s*,\s*-?[0-9]{1,3}\.[0-9]+$'
    );

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_punch_address(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_punch_address(uuid, uuid, text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.backfill_punch_address(uuid, uuid, text, text) IS
  'Set time_punches.address to a real place name when GPS was saved without one.';
