-- Allow active HR users to UPDATE their company row (name, modules, plan placeholders).

DROP POLICY IF EXISTS p_companies_hr_update ON public.companies;
CREATE POLICY p_companies_hr_update ON public.companies
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hr_users h
      WHERE h.auth_user_id = auth.uid()
        AND COALESCE(h.is_active, false) = true
        AND h.company_id = companies.id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hr_users h
      WHERE h.auth_user_id = auth.uid()
        AND COALESCE(h.is_active, false) = true
        AND h.company_id = companies.id
    )
  );
