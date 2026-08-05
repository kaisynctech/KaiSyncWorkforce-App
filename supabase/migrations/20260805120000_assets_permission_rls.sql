-- ============================================================
-- Assets: replace membership-only RLS with assets.view / assets.edit
-- (mirrors clients / projects permission-gated policies).
-- ============================================================

DROP POLICY IF EXISTS assets_all ON public.assets;
DROP POLICY IF EXISTS "assets_all" ON public.assets;
DROP POLICY IF EXISTS assets_select ON public.assets;
DROP POLICY IF EXISTS assets_insert ON public.assets;
DROP POLICY IF EXISTS assets_update ON public.assets;
DROP POLICY IF EXISTS assets_delete ON public.assets;

CREATE POLICY assets_select ON public.assets
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'assets.view')
  );

CREATE POLICY assets_insert ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'assets.edit')
  );

CREATE POLICY assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'assets.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'assets.edit')
  );

CREATE POLICY assets_delete ON public.assets
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'assets.edit')
  );

REVOKE ALL ON TABLE public.assets FROM anon;
