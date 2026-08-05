
-- Fix: employees has separate name/surname columns, no full_name column.
CREATE OR REPLACE FUNCTION public.hr_get_locked_employees(p_company_id uuid)
RETURNS TABLE (
  employee_id   uuid,
  full_name     text,
  locked_at     timestamptz,
  locked_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    trim(COALESCE(e.name, '') || ' ' || COALESCE(e.surname, ''))::text,
    e.locked_at,
    e.locked_reason
  FROM public.employees e
  WHERE e.company_id        = p_company_id
    AND e.is_account_locked = true
  ORDER BY e.locked_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_get_locked_employees(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_get_locked_employees(uuid) TO authenticated;
;
