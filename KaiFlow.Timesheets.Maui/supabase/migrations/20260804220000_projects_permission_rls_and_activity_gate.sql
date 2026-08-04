-- ============================================================
-- Projects (client_deals): restore permission-gated RLS (lost after
-- UUID rebuild) and gate get_project_activity_feed with projects.view.
-- Pattern matches live clients_* policies (user_has_permission).
-- ============================================================

DROP POLICY IF EXISTS client_deals_all ON public.client_deals;
DROP POLICY IF EXISTS "client_deals_all" ON public.client_deals;
DROP POLICY IF EXISTS r_client_deals_matrix_insert ON public.client_deals;
DROP POLICY IF EXISTS r_client_deals_matrix_update ON public.client_deals;
DROP POLICY IF EXISTS r_client_deals_matrix_delete ON public.client_deals;
DROP POLICY IF EXISTS client_deals_select ON public.client_deals;
DROP POLICY IF EXISTS client_deals_insert ON public.client_deals;
DROP POLICY IF EXISTS client_deals_update ON public.client_deals;
DROP POLICY IF EXISTS client_deals_delete ON public.client_deals;

CREATE POLICY client_deals_select ON public.client_deals
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.view')
  );

CREATE POLICY client_deals_insert ON public.client_deals
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.create')
  );

CREATE POLICY client_deals_update ON public.client_deals
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY client_deals_delete ON public.client_deals
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

REVOKE ALL ON TABLE public.client_deals FROM anon;

-- Activity feed: require projects.view; revoke anon
CREATE OR REPLACE FUNCTION public.get_project_activity_feed(
  p_company_id uuid,
  p_project_id uuid,
  p_limit int DEFAULT 200
)
RETURNS SETOF public.app_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'projects.view');

  RETURN QUERY
  SELECT *
  FROM public.app_events
  WHERE company_id = p_company_id
    AND meta @> jsonb_build_object('project_id', p_project_id::text)
    AND level IN ('info', 'warning')
  ORDER BY created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 200), 500));
END;
$$;

REVOKE ALL ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_activity_feed(uuid, uuid, int) TO service_role;
