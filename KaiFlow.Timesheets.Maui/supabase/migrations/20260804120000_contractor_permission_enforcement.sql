-- Contractors permission enforcement (enterprise)
-- Keys already seeded: contractors.view / .create / .edit
-- Suppliers share public.contractors (partner_kind) — dual-key SELECT/write.
-- Portal SECURITY DEFINER RPCs are unchanged (code auth, not HR JWT keys).

-- ── Helpers ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.require_user_permission(
  p_company_id uuid,
  p_permission_key text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(p_company_id, p_permission_key) THEN
    RAISE EXCEPTION 'INSUFFICIENT_PERMISSION: % required', p_permission_key
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_user_permission(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_user_permission(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_select_partner_row(
  p_company_id uuid,
  p_partner_kind text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_company_id = ANY (public.user_company_ids())
    AND (
      (
        public.user_has_permission(p_company_id, 'contractors.view')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') IN ('contractor', 'both')
      )
      OR (
        public.user_has_permission(p_company_id, 'suppliers.view')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') IN ('supplier', 'both')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_insert_partner_row(
  p_company_id uuid,
  p_partner_kind text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_company_id = ANY (public.user_company_ids())
    AND (
      (
        public.user_has_permission(p_company_id, 'contractors.create')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') IN ('contractor', 'both')
      )
      OR (
        public.user_has_permission(p_company_id, 'suppliers.edit')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') = 'supplier'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_write_partner_row(
  p_company_id uuid,
  p_partner_kind text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_company_id = ANY (public.user_company_ids())
    AND (
      (
        public.user_has_permission(p_company_id, 'contractors.edit')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') IN ('contractor', 'both')
      )
      OR (
        public.user_has_permission(p_company_id, 'suppliers.edit')
        AND coalesce(nullif(trim(p_partner_kind), ''), 'contractor') IN ('supplier', 'both')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_select_partner_row(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_insert_partner_row(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_partner_row(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_select_partner_row(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_partner_row(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_partner_row(uuid, text) TO authenticated;

-- ── contractors RLS ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS contractors_all ON public.contractors;

CREATE POLICY contractors_select ON public.contractors
  FOR SELECT TO authenticated
  USING (public.can_select_partner_row(company_id, partner_kind));

CREATE POLICY contractors_insert ON public.contractors
  FOR INSERT TO authenticated
  WITH CHECK (public.can_insert_partner_row(company_id, partner_kind));

CREATE POLICY contractors_update ON public.contractors
  FOR UPDATE TO authenticated
  USING (public.can_write_partner_row(company_id, partner_kind))
  WITH CHECK (public.can_write_partner_row(company_id, partner_kind));

CREATE POLICY contractors_delete ON public.contractors
  FOR DELETE TO authenticated
  USING (public.can_write_partner_row(company_id, partner_kind));

-- ── Child tables (HR JWT path) — portal writes remain SECURITY DEFINER ────

DROP POLICY IF EXISTS p_contractor_documents_authenticated ON public.contractor_documents;
CREATE POLICY contractor_documents_select ON public.contractor_documents
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_documents.contractor_id
        AND c.company_id = contractor_documents.company_id
        AND public.can_select_partner_row(c.company_id, c.partner_kind)
    )
  );
CREATE POLICY contractor_documents_write ON public.contractor_documents
  FOR ALL TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_documents.contractor_id
        AND c.company_id = contractor_documents.company_id
        AND public.can_write_partner_row(c.company_id, c.partner_kind)
    )
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_documents.contractor_id
        AND c.company_id = contractor_documents.company_id
        AND public.can_write_partner_row(c.company_id, c.partner_kind)
    )
  );

DROP POLICY IF EXISTS contractor_member_links_all ON public.contractor_member_links;
CREATE POLICY contractor_member_links_select ON public.contractor_member_links
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_member_links.contractor_id
        AND c.company_id = contractor_member_links.company_id
        AND public.can_select_partner_row(c.company_id, c.partner_kind)
    )
  );
CREATE POLICY contractor_member_links_write ON public.contractor_member_links
  FOR ALL TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_member_links.contractor_id
        AND c.company_id = contractor_member_links.company_id
        AND public.can_write_partner_row(c.company_id, c.partner_kind)
    )
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.id = contractor_member_links.contractor_id
        AND c.company_id = contractor_member_links.company_id
        AND public.can_write_partner_row(c.company_id, c.partner_kind)
    )
  );

DROP POLICY IF EXISTS p_contractor_quotes_authenticated ON public.contractor_quotes;
CREATE POLICY contractor_quotes_select ON public.contractor_quotes
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.view')
      OR public.user_has_permission(company_id, 'suppliers.view')
    )
  );
CREATE POLICY contractor_quotes_write ON public.contractor_quotes
  FOR ALL TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.edit')
      OR public.user_has_permission(company_id, 'suppliers.edit')
    )
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.edit')
      OR public.user_has_permission(company_id, 'suppliers.edit')
    )
  );

DROP POLICY IF EXISTS p_contractor_banking_updates_authenticated ON public.contractor_banking_updates;
CREATE POLICY contractor_banking_updates_select ON public.contractor_banking_updates
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.view')
  );
CREATE POLICY contractor_banking_updates_write ON public.contractor_banking_updates
  FOR ALL TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'contractors.edit')
  );

DROP POLICY IF EXISTS contractor_payouts_all ON public.contractor_payouts;
CREATE POLICY contractor_payouts_select ON public.contractor_payouts
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.view')
      OR public.user_has_permission(company_id, 'suppliers.view')
    )
  );
CREATE POLICY contractor_payouts_write ON public.contractor_payouts
  FOR ALL TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.edit')
      OR public.user_has_permission(company_id, 'suppliers.edit')
    )
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'contractors.edit')
      OR public.user_has_permission(company_id, 'suppliers.edit')
    )
  );

-- ── SECURITY DEFINER RPCs: permission gates ───────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_get_contractor_action_items(p_company_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.view');

  RETURN coalesce((
    SELECT json_agg(row_to_json(a) ORDER BY a.priority ASC, a.created_at DESC)
    FROM (
      SELECT
        cq.id::text AS ref_id,
        cq.contractor_id::text AS contractor_id,
        c.name AS contractor_name,
        coalesce(c.contractor_code, '') AS contractor_code,
        'quote_pending' AS action_type,
        coalesce(
          'Quote' || CASE WHEN cq.quote_number IS NOT NULL THEN ' #' || cq.quote_number ELSE '' END || ' awaiting review',
          'Quote awaiting review'
        ) AS summary,
        cq.total_amount AS amount,
        cq.status AS status,
        cq.submitted_at AS created_at,
        1 AS priority
      FROM public.contractor_quotes cq
      JOIN public.contractors c ON c.id = cq.contractor_id
      WHERE cq.company_id = p_company_id
        AND cq.status IN ('submitted', 'under_review')
        AND c.is_active = true

      UNION ALL

      SELECT
        bu.id::text, bu.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'banking_pending', 'Banking details update awaiting approval',
        NULL::numeric, bu.status, bu.submitted_at, 2
      FROM public.contractor_banking_updates bu
      JOIN public.contractors c ON c.id = bu.contractor_id
      WHERE bu.company_id = p_company_id AND bu.status = 'pending' AND c.is_active = true

      UNION ALL

      SELECT
        cd.id::text, cd.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'document_pending', cd.document_type || ': ' || cd.document_name,
        NULL::numeric, cd.approval_status, cd.created_at, 3
      FROM public.contractor_documents cd
      JOIN public.contractors c ON c.id = cd.contractor_id
      WHERE cd.company_id = p_company_id
        AND cd.approval_status = 'pending'
        AND cd.uploaded_by_role = 'contractor'
        AND c.is_active = true

      UNION ALL

      SELECT
        cd.id::text, cd.contractor_id::text, c.name, coalesce(c.contractor_code, ''),
        'document_expiring',
        cd.document_type || ' expires ' || to_char(cd.expiry_date, 'DD Mon YYYY'),
        NULL::numeric, 'expiring', cd.created_at, 4
      FROM public.contractor_documents cd
      JOIN public.contractors c ON c.id = cd.contractor_id
      WHERE cd.company_id = p_company_id
        AND cd.approval_status = 'approved'
        AND cd.expiry_date IS NOT NULL
        AND cd.expiry_date >= CURRENT_DATE
        AND cd.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        AND c.is_active = true
    ) a
  ), '[]'::json);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_get_contractors_snapshot(
  p_company_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.view');

  RETURN jsonb_build_object(
    'active', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id AND COALESCE(is_active, true)
    ),
    'pending_compliance', (
      SELECT COUNT(*) FROM contractors
      WHERE company_id = p_company_id AND COALESCE(compliance_hold, false)
    ),
    'pending_payments', (
      SELECT COUNT(*) FROM contractor_payouts
      WHERE company_id = p_company_id
        AND payout_status IN ('pending', 'approved')
    ),
    'payment_summary', COALESCE((
      SELECT jsonb_agg(row_obj ORDER BY (row_obj->>'agreed')::numeric DESC)
      FROM (
        SELECT jsonb_build_object(
          'name', c.name,
          'agreed', COALESCE((
            SELECT SUM(jc.agreed_amount) FROM job_contractors jc
            WHERE jc.company_id = p_company_id AND jc.contractor_id = c.id
          ), 0),
          'paid', COALESCE((
            SELECT SUM(cp.total_amount) FROM contractor_payouts cp
            WHERE cp.company_id = p_company_id
              AND cp.contractor_id = c.id
              AND cp.payout_status = 'paid'
          ), 0)
        ) AS row_obj
        FROM contractors c
        WHERE c.company_id = p_company_id AND COALESCE(c.is_active, true)
        ORDER BY c.name
        LIMIT 20
      ) t
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_banking(
  p_update_id uuid,
  p_reviewed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_update   public.contractor_banking_updates%ROWTYPE;
  v_reviewer public.employees%ROWTYPE;
BEGIN
  SELECT * INTO v_update
  FROM public.contractor_banking_updates
  WHERE id = p_update_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Banking update not found';
  END IF;

  IF v_update.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot approve: update status is already "%"', v_update.status;
  END IF;

  PERFORM public.require_user_permission(v_update.company_id, 'contractors.edit');

  SELECT * INTO v_reviewer
  FROM public.employees
  WHERE id = p_reviewed_by
    AND company_id = v_update.company_id
    AND is_active = true
    AND access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewer not found or lacks HR permissions for this company';
  END IF;

  UPDATE public.contractors
  SET
    account_holder_name = v_update.account_holder_name,
    bank_name           = v_update.bank_name,
    bank_account        = v_update.bank_account,
    bank_branch_code    = v_update.bank_branch_code,
    account_type        = v_update.account_type,
    swift_bic           = v_update.swift_bic,
    banking_verified    = false,
    updated_at          = now()
  WHERE id = v_update.contractor_id
    AND company_id = v_update.company_id;

  UPDATE public.contractor_banking_updates
  SET status = 'approved', reviewed_at = now(), reviewed_by = p_reviewed_by
  WHERE id = p_update_id;

  INSERT INTO public.app_events (
    company_id, auth_user_id, screen, action, level, meta, created_at
  ) VALUES (
    v_update.company_id,
    v_reviewer.user_id,
    'HrContractorDetails',
    'contractor_banking_update_approved',
    'info',
    jsonb_build_object(
      'contractor_id', v_update.contractor_id,
      'update_id', p_update_id,
      'reviewed_by', p_reviewed_by
    ),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_banking(
  p_update_id uuid,
  p_reviewed_by uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_update   public.contractor_banking_updates%ROWTYPE;
  v_reviewer public.employees%ROWTYPE;
BEGIN
  SELECT * INTO v_update
  FROM public.contractor_banking_updates
  WHERE id = p_update_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Banking update not found';
  END IF;

  IF v_update.status <> 'pending' THEN
    RAISE EXCEPTION 'Cannot reject: update status is already "%"', v_update.status;
  END IF;

  PERFORM public.require_user_permission(v_update.company_id, 'contractors.edit');

  SELECT * INTO v_reviewer
  FROM public.employees
  WHERE id = p_reviewed_by
    AND company_id = v_update.company_id
    AND is_active = true
    AND access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewer not found or lacks HR permissions for this company';
  END IF;

  UPDATE public.contractor_banking_updates
  SET
    status = 'rejected',
    reviewed_at = now(),
    reviewed_by = p_reviewed_by,
    rejection_reason = nullif(trim(coalesce(p_reason, '')), '')
  WHERE id = p_update_id;

  INSERT INTO public.app_events (
    company_id, auth_user_id, screen, action, level, meta, created_at
  ) VALUES (
    v_update.company_id,
    v_reviewer.user_id,
    'HrContractorDetails',
    'contractor_banking_update_rejected',
    'info',
    jsonb_build_object(
      'contractor_id', v_update.contractor_id,
      'update_id', p_update_id,
      'reviewed_by', p_reviewed_by,
      'rejection_reason', p_reason
    ),
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_approve_contractor_quote(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid,
  p_hr_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contractor_id uuid;
  v_quote_number text;
  v_total numeric;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  UPDATE public.contractor_quotes
  SET status = 'approved',
      reviewed_by = p_hr_user_id,
      reviewed_at = now(),
      hr_notes = p_hr_notes,
      updated_at = now()
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND status IN ('submitted', 'under_review')
  RETURNING contractor_id, quote_number, total_amount
  INTO v_contractor_id, v_quote_number, v_total;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or not in a reviewable state';
  END IF;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_approve_quote', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'contractor_id', v_contractor_id,
      'quote_number', v_quote_number,
      'total_amount', v_total
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_reject_contractor_quote(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid,
  p_rejection_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contractor_id uuid;
  v_quote_number text;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  UPDATE public.contractor_quotes
  SET status = 'rejected',
      reviewed_by = p_hr_user_id,
      reviewed_at = now(),
      rejection_reason = p_rejection_reason,
      updated_at = now()
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND status IN ('submitted', 'under_review')
  RETURNING contractor_id, quote_number
  INTO v_contractor_id, v_quote_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or not in a reviewable state';
  END IF;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_reject_quote', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'contractor_id', v_contractor_id,
      'rejection_reason', p_rejection_reason
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_start_quote_review(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contractor_id uuid;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  SELECT contractor_id INTO v_contractor_id
  FROM public.contractor_quotes
  WHERE id = p_quote_id AND company_id = p_company_id;

  UPDATE public.contractor_quotes
  SET status = 'under_review', updated_at = now()
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND status = 'submitted';

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_start_review', 'info',
    jsonb_build_object('quote_id', p_quote_id, 'contractor_id', v_contractor_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_request_quote_revision(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid,
  p_revision_comments text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contractor_id uuid;
  v_quote_number text;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  UPDATE public.contractor_quotes
  SET status = 'revision_requested',
      reviewed_by = p_hr_user_id,
      reviewed_at = now(),
      revision_comments = p_revision_comments,
      updated_at = now()
  WHERE id = p_quote_id
    AND company_id = p_company_id
    AND status IN ('submitted', 'under_review')
  RETURNING contractor_id, quote_number
  INTO v_contractor_id, v_quote_number;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or not in a reviewable state';
  END IF;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'hr_request_revision', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'contractor_id', v_contractor_id,
      'revision_comments', p_revision_comments
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_assign_quote_to_job(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid,
  p_job_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote record;
  v_job record;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  SELECT * INTO v_quote
  FROM public.contractor_quotes
  WHERE id = p_quote_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF v_quote.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved quotes can be assigned to a job (current status: %)', v_quote.status;
  END IF;
  IF v_quote.converted_to_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quote has already been linked to job %', v_quote.converted_to_job_id;
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found or belongs to a different company';
  END IF;

  UPDATE public.contractor_quotes SET
    status = 'converted',
    converted_to_job_id = p_job_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_quote_id AND company_id = p_company_id;

  UPDATE public.jobs SET
    contractor_id = CASE WHEN contractor_id IS NULL THEN v_quote.contractor_id ELSE contractor_id END,
    contractor_cost = contractor_cost + v_quote.total_amount,
    updated_at = now()
  WHERE id = p_job_id AND company_id = p_company_id;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id, 'contractor_quotes', 'contractor_quote_assigned_to_existing_job', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'job_id', p_job_id,
      'job_code', v_job.job_code,
      'job_title', v_job.title,
      'quote_number', v_quote.quote_number,
      'total_amount', v_quote.total_amount,
      'contractor_id', v_quote.contractor_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_convert_quote_to_job(
  p_company_id uuid,
  p_hr_user_id uuid,
  p_quote_id uuid,
  p_job_title text,
  p_description text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_scheduled_start timestamptz DEFAULT NULL,
  p_scheduled_end timestamptz DEFAULT NULL,
  p_deal_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote record;
  v_job_id uuid;
  v_code text;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  SELECT * INTO v_quote
  FROM public.contractor_quotes
  WHERE id = p_quote_id AND company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF v_quote.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved quotes can be converted (current status: %)', v_quote.status;
  END IF;
  IF v_quote.converted_to_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Quote has already been converted to job %', v_quote.converted_to_job_id;
  END IF;

  v_code := public._next_job_code(p_company_id);

  INSERT INTO public.jobs (
    company_id, title, description, status, priority,
    contractor_id, contractor_cost, estimated_cost,
    source_quote_id, external_ref, deal_id,
    scheduled_start, scheduled_end,
    created_by_employee_id, job_code, created_at, updated_at
  ) VALUES (
    p_company_id,
    trim(p_job_title),
    trim(coalesce(p_description, '')),
    'scheduled',
    coalesce(p_priority, 'normal'),
    v_quote.contractor_id,
    v_quote.total_amount,
    v_quote.total_amount,
    p_quote_id,
    'quote:' || p_quote_id::text,
    p_deal_id,
    p_scheduled_start,
    p_scheduled_end,
    p_hr_user_id,
    v_code,
    now(),
    now()
  )
  RETURNING id INTO v_job_id;

  UPDATE public.contractor_quotes SET
    status = 'converted',
    converted_to_job_id = v_job_id,
    converted_at = now(),
    updated_at = now()
  WHERE id = p_quote_id AND company_id = p_company_id;

  INSERT INTO public.job_contractors (
    company_id, job_id, contractor_id, quote_id,
    role, agreed_amount, quoted_amount, status,
    assigned_at, created_at, updated_at
  ) VALUES (
    p_company_id, v_job_id, v_quote.contractor_id, p_quote_id,
    'general', v_quote.total_amount, v_quote.total_amount, 'assigned',
    now(), now(), now()
  )
  ON CONFLICT (job_id, contractor_id) DO NOTHING;

  IF p_deal_id IS NOT NULL THEN
    INSERT INTO public.project_contractors (
      company_id, deal_id, contractor_id,
      role, status, assigned_at, created_at, updated_at
    ) VALUES (
      p_company_id, p_deal_id, v_quote.contractor_id,
      'general', 'active', now(), now(), now()
    )
    ON CONFLICT (deal_id, contractor_id) DO NOTHING;
  END IF;

  INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
  VALUES (
    p_company_id, p_hr_user_id,
    'contractor_quotes', 'contractor_quote_converted_to_job', 'info',
    jsonb_build_object(
      'quote_id', p_quote_id,
      'job_id', v_job_id,
      'job_code', v_code,
      'job_title', p_job_title,
      'quote_number', v_quote.quote_number,
      'total_amount', v_quote.total_amount,
      'contractor_id', v_quote.contractor_id,
      'deal_id', p_deal_id
    )
  );

  RETURN json_build_object('job_id', v_job_id, 'job_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_upsert_job_contractor(
  p_company_id uuid,
  p_job_id uuid,
  p_contractor_id uuid,
  p_quote_id uuid DEFAULT NULL,
  p_agreed_amount numeric DEFAULT 0,
  p_deal_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  INSERT INTO public.job_contractors (
    company_id, job_id, contractor_id, quote_id,
    role, agreed_amount, quoted_amount, status,
    assigned_at, created_at, updated_at
  ) VALUES (
    p_company_id, p_job_id, p_contractor_id, p_quote_id,
    'general', p_agreed_amount, p_agreed_amount, 'assigned',
    now(), now(), now()
  )
  ON CONFLICT (job_id, contractor_id) DO NOTHING;

  IF p_deal_id IS NOT NULL THEN
    INSERT INTO public.project_contractors (
      company_id, deal_id, contractor_id,
      role, status, assigned_at, created_at, updated_at
    ) VALUES (
      p_company_id, p_deal_id, p_contractor_id,
      'general', 'active', now(), now(), now()
    )
    ON CONFLICT (deal_id, contractor_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_rotate_contractor_code(
  p_company_id uuid,
  p_contractor_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_code text;
BEGIN
  PERFORM public.require_user_permission(p_company_id, 'contractors.edit');

  IF NOT EXISTS (
    SELECT 1 FROM public.contractors
    WHERE id = p_contractor_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  v_new_code := upper(substring(
    md5(random()::text || clock_timestamp()::text)
    FROM 1 FOR 8
  ));

  UPDATE public.contractors
  SET contractor_code = v_new_code,
      contractor_code_expires_at = NULL,
      contractor_code_rotated_at = now()
  WHERE id = p_contractor_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'portal_code_rotated',
      'contractor',
      p_contractor_id::text,
      NULL,
      NULL,
      jsonb_build_object('non_expiring', true)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
  END;

  RETURN v_new_code;
END;
$$;

-- Activity feed: inject view gate without rewriting the large body
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'hr_get_contractor_activity'
    AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_limit integer';

  IF def IS NULL THEN
    RAISE EXCEPTION 'hr_get_contractor_activity not found';
  END IF;

  IF position('require_user_permission(p_company_id, ''contractors.view'')' in def) = 0 THEN
    def := replace(
      def,
      E'AS $function$\nBEGIN\n',
      E'AS $function$\nBEGIN\n    PERFORM public.require_user_permission(p_company_id, ''contractors.view'');\n'
    );
    EXECUTE def;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.require_user_permission(uuid, text) IS
  'Raises INSUFFICIENT_PERMISSION when caller lacks the given company_role_permissions key.';
