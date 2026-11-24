-- current_employee_scope() on every employees read made sign-in, company
-- lookup, and invite linking hit statement timeout. Membership stays the
-- select rule. Manager scoping stays in list_employee_directory.

DROP POLICY IF EXISTS employees_select ON public.employees;

CREATE POLICY employees_select ON public.employees
  FOR SELECT
  TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    OR user_id = auth.uid()
  );
