-- ============================================================
-- Project child tables: gate with projects.view / projects.edit
-- (membership-only policies allowed bypass of client_deals RLS).
-- ============================================================

-- ── project_quotation_lines ───────────────────────────────────
DROP POLICY IF EXISTS project_quotation_lines_company ON public.project_quotation_lines;
DROP POLICY IF EXISTS project_quotation_lines_select ON public.project_quotation_lines;
DROP POLICY IF EXISTS project_quotation_lines_insert ON public.project_quotation_lines;
DROP POLICY IF EXISTS project_quotation_lines_update ON public.project_quotation_lines;
DROP POLICY IF EXISTS project_quotation_lines_delete ON public.project_quotation_lines;

CREATE POLICY project_quotation_lines_select ON public.project_quotation_lines
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.view')
  );

CREATE POLICY project_quotation_lines_insert ON public.project_quotation_lines
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_quotation_lines_update ON public.project_quotation_lines
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_quotation_lines_delete ON public.project_quotation_lines
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

REVOKE ALL ON TABLE public.project_quotation_lines FROM anon;

-- ── project_documents ─────────────────────────────────────────
DROP POLICY IF EXISTS project_documents_company ON public.project_documents;
DROP POLICY IF EXISTS project_documents_select ON public.project_documents;
DROP POLICY IF EXISTS project_documents_insert ON public.project_documents;
DROP POLICY IF EXISTS project_documents_update ON public.project_documents;
DROP POLICY IF EXISTS project_documents_delete ON public.project_documents;

CREATE POLICY project_documents_select ON public.project_documents
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.view')
  );

CREATE POLICY project_documents_insert ON public.project_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_documents_update ON public.project_documents
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_documents_delete ON public.project_documents
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

REVOKE ALL ON TABLE public.project_documents FROM anon;

-- ── project_client_payments ───────────────────────────────────
DROP POLICY IF EXISTS project_client_payments_company ON public.project_client_payments;
DROP POLICY IF EXISTS project_client_payments_select ON public.project_client_payments;
DROP POLICY IF EXISTS project_client_payments_insert ON public.project_client_payments;
DROP POLICY IF EXISTS project_client_payments_update ON public.project_client_payments;
DROP POLICY IF EXISTS project_client_payments_delete ON public.project_client_payments;

CREATE POLICY project_client_payments_select ON public.project_client_payments
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.view')
  );

CREATE POLICY project_client_payments_insert ON public.project_client_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_client_payments_update ON public.project_client_payments
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  )
  WITH CHECK (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

CREATE POLICY project_client_payments_delete ON public.project_client_payments
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (user_company_ids())
    AND user_has_permission(company_id, 'projects.edit')
  );

REVOKE ALL ON TABLE public.project_client_payments FROM anon;
