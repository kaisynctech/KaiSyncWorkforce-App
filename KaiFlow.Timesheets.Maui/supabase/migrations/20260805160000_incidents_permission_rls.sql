-- ============================================================
-- Incidents: seed permissions, permission-keyed RLS, HR update RPC
-- ============================================================

INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
SELECT c.id, v.role, v.permission_key, v.allowed
FROM public.companies c
CROSS JOIN (
  VALUES
    ('owner',    'incidents.view', true),
    ('owner',    'incidents.create', true),
    ('owner',    'incidents.edit', true),
    ('hr',       'incidents.view', true),
    ('hr',       'incidents.create', true),
    ('hr',       'incidents.edit', true),
    ('manager',  'incidents.view', true),
    ('manager',  'incidents.create', true),
    ('manager',  'incidents.edit', true),
    ('employee', 'incidents.view', true),
    ('employee', 'incidents.create', true),
    ('employee', 'incidents.edit', false)
) AS v(role, permission_key, allowed)
ON CONFLICT (company_id, role, permission_key) DO NOTHING;

-- ── incident_reports ─────────────────────────────────────────
DROP POLICY IF EXISTS incident_reports_all ON public.incident_reports;
DROP POLICY IF EXISTS incident_reports_select ON public.incident_reports;
DROP POLICY IF EXISTS incident_reports_insert ON public.incident_reports;
DROP POLICY IF EXISTS incident_reports_update ON public.incident_reports;
DROP POLICY IF EXISTS incident_reports_delete ON public.incident_reports;

CREATE POLICY incident_reports_select ON public.incident_reports
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.view')
  );

CREATE POLICY incident_reports_insert ON public.incident_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.create')
  );

CREATE POLICY incident_reports_update ON public.incident_reports
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  );

CREATE POLICY incident_reports_delete ON public.incident_reports
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  );

-- ── incident_comments ────────────────────────────────────────
DROP POLICY IF EXISTS incident_comments_all ON public.incident_comments;
DROP POLICY IF EXISTS incident_comments_select ON public.incident_comments;
DROP POLICY IF EXISTS incident_comments_insert ON public.incident_comments;
DROP POLICY IF EXISTS incident_comments_update ON public.incident_comments;
DROP POLICY IF EXISTS incident_comments_delete ON public.incident_comments;

CREATE POLICY incident_comments_select ON public.incident_comments
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.view')
  );

CREATE POLICY incident_comments_insert ON public.incident_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'incidents.view')
      OR public.user_has_permission(company_id, 'incidents.edit')
    )
  );

CREATE POLICY incident_comments_update ON public.incident_comments
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  );

CREATE POLICY incident_comments_delete ON public.incident_comments
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  );

-- ── incident_status_history ──────────────────────────────────
DROP POLICY IF EXISTS incident_status_history_all ON public.incident_status_history;
DROP POLICY IF EXISTS incident_status_history_select ON public.incident_status_history;
DROP POLICY IF EXISTS incident_status_history_insert ON public.incident_status_history;

CREATE POLICY incident_status_history_select ON public.incident_status_history
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.view')
  );

CREATE POLICY incident_status_history_insert ON public.incident_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'incidents.edit')
  );

REVOKE ALL ON TABLE public.incident_reports FROM anon;
REVOKE ALL ON TABLE public.incident_comments FROM anon;
REVOKE ALL ON TABLE public.incident_status_history FROM anon;

-- HR status/assign path (employee_* RPCs require reporter/assignee/job scope)
CREATE OR REPLACE FUNCTION public.hr_update_incident(
  p_company_id uuid,
  p_incident_id uuid,
  p_status text DEFAULT NULL,
  p_resolution_notes text DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_clear_assignee boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_actor uuid;
  v_row public.incident_reports%ROWTYPE;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'incidents.edit');

  SELECT e.id INTO v_actor
  FROM public.employees e
  WHERE e.company_id = p_company_id
    AND e.user_id = auth.uid()
    AND e.is_active = true
  ORDER BY e.created_at
  LIMIT 1;

  IF NOT EXISTS (
    SELECT 1 FROM public.incident_reports
    WHERE id = p_incident_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;

  IF p_status IS NOT NULL THEN
    PERFORM public._incident_apply_status(
      p_incident_id, p_status, v_actor, p_resolution_notes
    );
  ELSIF p_resolution_notes IS NOT NULL THEN
    UPDATE public.incident_reports
    SET resolution_notes = p_resolution_notes, updated_at = now()
    WHERE id = p_incident_id AND company_id = p_company_id;
  END IF;

  IF p_assignee_id IS NOT NULL AND NOT public._employee_valid(p_company_id, p_assignee_id) THEN
    RAISE EXCEPTION 'invalid assignee';
  END IF;

  IF p_clear_assignee THEN
    UPDATE public.incident_reports
    SET assignee_id = null, updated_at = now()
    WHERE id = p_incident_id AND company_id = p_company_id;
  ELSIF p_assignee_id IS NOT NULL THEN
    UPDATE public.incident_reports
    SET assignee_id = p_assignee_id, updated_at = now()
    WHERE id = p_incident_id AND company_id = p_company_id;
  END IF;

  SELECT * INTO v_row
  FROM public.incident_reports
  WHERE id = p_incident_id AND company_id = p_company_id;

  RETURN row_to_json(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_update_incident(uuid, uuid, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_update_incident(uuid, uuid, text, text, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_update_incident(uuid, uuid, text, text, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_update_incident(uuid, uuid, text, text, uuid, boolean) TO service_role;
