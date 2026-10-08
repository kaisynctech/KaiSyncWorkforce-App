-- Managers must not read other employees by calling the table directly.
-- Owner, Admin, and HR still see the company. A person can always read their own row.

CREATE OR REPLACE FUNCTION public.current_employee_scope(p_company_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_user uuid;
  v_access text;
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF NOT (p_company_id = ANY (public.user_company_ids())) THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT e.id, e.user_id, e.access_level
    INTO v_id, v_user, v_access
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = auth.uid()
    AND e.is_active = true
  ORDER BY e.created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    IF public.platform_is_admin() THEN
      RETURN NULL;
    END IF;
    RETURN ARRAY[]::uuid[];
  END IF;

  RETURN public.hr_employee_scope_ids(p_company_id, v_id, v_user, v_access);
END;
$$;

REVOKE ALL ON FUNCTION public.current_employee_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_employee_scope(uuid) TO authenticated;

DROP POLICY IF EXISTS employees_select ON public.employees;

CREATE POLICY employees_select ON public.employees
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      company_id = ANY (public.user_company_ids())
      AND (
        public.current_employee_scope(company_id) IS NULL
        OR id = ANY (public.current_employee_scope(company_id))
      )
    )
  );
