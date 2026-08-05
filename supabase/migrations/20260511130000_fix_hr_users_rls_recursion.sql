-- Fix PostgreSQL 42P17 "infinite recursion detected in policy for relation hr_users".
-- p_hr_users_hr_select_company referenced hr_users inside its own USING clause; each
-- subquery scan re-entered RLS on hr_users. Resolve company access via SECURITY DEFINER
-- helper with row_security disabled for the internal lookup only.

CREATE OR REPLACE FUNCTION public.auth_active_hr_company_ids()
RETURNS SETOF bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT DISTINCT h.company_id
  FROM public.hr_users h
  WHERE h.auth_user_id = auth.uid()
    AND COALESCE(h.is_active, false) = true;
$$;
REVOKE ALL ON FUNCTION public.auth_active_hr_company_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_active_hr_company_ids() TO authenticated;
DROP POLICY IF EXISTS p_hr_users_hr_select_company ON public.hr_users;
CREATE POLICY p_hr_users_hr_select_company ON public.hr_users
  FOR SELECT TO authenticated
  USING (
    hr_users.company_id IN (
      SELECT public.auth_active_hr_company_ids()
    )
  );
