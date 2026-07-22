-- ============================================================
-- ARCH-001 Migration 3: RLS Role Enforcement
-- ============================================================

-- ── 1. employees UPDATE — restrict to owner/hr ───────────────
DROP POLICY IF EXISTS employees_update ON public.employees;
CREATE POLICY employees_update ON public.employees FOR UPDATE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  )
  WITH CHECK (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  );

-- ── 2. employees DELETE — restrict to owner only ─────────────
DROP POLICY IF EXISTS employees_delete ON public.employees;
CREATE POLICY employees_delete ON public.employees FOR DELETE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) = 'owner'
  );

-- ── 3. payment_approvals — split FOR ALL into role-scoped policies ─
DROP POLICY IF EXISTS payment_approvals_all ON public.payment_approvals;

CREATE POLICY payment_approvals_select ON public.payment_approvals FOR SELECT
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  );

CREATE POLICY payment_approvals_insert ON public.payment_approvals FOR INSERT
  WITH CHECK (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  );

CREATE POLICY payment_approvals_update ON public.payment_approvals FOR UPDATE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  );

CREATE POLICY payment_approvals_delete ON public.payment_approvals FOR DELETE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr')
  );

-- ── 4. companies UPDATE — restrict to owner only ─────────────
DROP POLICY IF EXISTS companies_update ON public.companies;
CREATE POLICY companies_update ON public.companies FOR UPDATE
  USING (
    id = ANY(user_company_ids())
    AND get_my_role(id) = 'owner'
  )
  WITH CHECK (
    id = ANY(user_company_ids())
    AND get_my_role(id) = 'owner'
  );

-- ── 5. time_punches — split FOR ALL, restrict write to owner/hr/manager ─
DROP POLICY IF EXISTS time_punches_all ON public.time_punches;

CREATE POLICY time_punches_select ON public.time_punches FOR SELECT
  USING (company_id = ANY(user_company_ids()));

CREATE POLICY time_punches_insert ON public.time_punches FOR INSERT
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY time_punches_update ON public.time_punches FOR UPDATE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr', 'manager')
  );

CREATE POLICY time_punches_delete ON public.time_punches FOR DELETE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr', 'manager')
  );

-- ── 6. leave_requests — split FOR ALL, restrict write to owner/hr/manager ─
DROP POLICY IF EXISTS leave_requests_all ON public.leave_requests;

CREATE POLICY leave_requests_select ON public.leave_requests FOR SELECT
  USING (company_id = ANY(user_company_ids()));

CREATE POLICY leave_requests_insert ON public.leave_requests FOR INSERT
  WITH CHECK (company_id = ANY(user_company_ids()));

CREATE POLICY leave_requests_update ON public.leave_requests FOR UPDATE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr', 'manager')
  );

CREATE POLICY leave_requests_delete ON public.leave_requests FOR DELETE
  USING (
    company_id = ANY(user_company_ids())
    AND get_my_role(company_id) IN ('owner', 'hr', 'manager')
  );;
