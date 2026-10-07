-- Align branch management RLS with Settings UI (isHrOrAbove includes manager).
-- Without this, managers can open Organisation → Branches but UPDATE/INSERT/DELETE
-- is blocked by the original owner/hr-only policy.

DROP POLICY IF EXISTS "HR can manage branches" ON public.branches;

CREATE POLICY "HR can manage branches"
  ON public.branches
  FOR ALL
  TO authenticated
  USING (
    company_id IN (
      SELECT e.company_id
      FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.is_active = true
        AND e.access_level = ANY (ARRAY['owner'::text, 'admin'::text, 'hr_admin'::text, 'hr'::text, 'manager'::text])
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT e.company_id
      FROM public.employees e
      WHERE e.user_id = auth.uid()
        AND e.is_active = true
        AND e.access_level = ANY (ARRAY['owner'::text, 'admin'::text, 'hr_admin'::text, 'hr'::text, 'manager'::text])
    )
  );
