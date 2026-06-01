-- Fix ambiguous company_id / contractor_id in WITH CHECK (join vs. new row).
DROP POLICY IF EXISTS p_contractor_admin_events_contractor_admin_insert ON public.contractor_admin_events;
CREATE POLICY p_contractor_admin_events_contractor_admin_insert ON public.contractor_admin_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees e
      JOIN public.contractor_members cm
        ON cm.employee_id = e.id
       AND cm.contractor_id = contractor_admin_events.contractor_id
       AND cm.company_id = contractor_admin_events.company_id
      WHERE e.profile_id = auth.uid()
        AND e.company_id = contractor_admin_events.company_id
        AND (
          cm.is_primary = true
          OR lower(trim(coalesce(cm.role_label, ''))) IN ('owner', 'manager', 'lead')
        )
    )
    AND actor_employee_id IN (
      SELECT e2.id FROM public.employees e2
      WHERE e2.profile_id = auth.uid()
        AND e2.company_id = contractor_admin_events.company_id
    )
  );
