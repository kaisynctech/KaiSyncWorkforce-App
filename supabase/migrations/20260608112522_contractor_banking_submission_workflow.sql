-- Phase 2C.3: Contractor Banking Submission Workflow.
--
-- Contractors may SUBMIT banking details for HR review via the portal.
-- Submissions are staged in contractor_banking_updates.
-- The contractors table banking columns are NEVER touched by portal RPCs.
-- HR approval (Phase 2C.4) will copy approved values to contractors and
-- reset banking_verified = false for re-verification.

-- ── 1. Staging table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contractor_banking_updates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id       uuid        NOT NULL
                                  REFERENCES public.contractors(id)   ON DELETE CASCADE,
  company_id          uuid        NOT NULL
                                  REFERENCES public.companies(id)     ON DELETE CASCADE,
  -- Submitted banking details (snapshot at submission time)
  account_holder_name text,
  bank_name           text,
  bank_account        text,        -- stored in full; masked in portal read RPCs
  bank_branch_code    text,
  account_type        text,
  swift_bic           text,
  -- Workflow
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at         timestamptz,
  reviewed_by         uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  rejection_reason    text,
  -- Audit
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One pending update per contractor at a time (prevents duplicate submissions)
CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_banking_pending
  ON public.contractor_banking_updates (contractor_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_contractor_banking_updates_contractor
  ON public.contractor_banking_updates (contractor_id, status);

CREATE INDEX IF NOT EXISTS idx_contractor_banking_updates_company_pending
  ON public.contractor_banking_updates (company_id, submitted_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.contractor_banking_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_contractor_banking_updates_authenticated
  ON public.contractor_banking_updates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.contractor_banking_updates IS
    'Staging table for contractor self-service banking changes. '
    'Submissions await HR approval before being copied to contractors table. '
    'Phase 2C.3.';


-- ── 2. HR notify helper ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_hr_contractor_banking_update(
    p_company_id      uuid,
    p_contractor_id   uuid,
    p_contractor_name text,
    p_account_last4   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r             RECORD;
    v_hour_window text := to_char(now(), 'YYYYMMDDHH24');
BEGIN
    FOR r IN
        SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
        FROM   public.employees e
        WHERE  e.company_id  = p_company_id
          AND  e.is_active   = true
          AND  e.user_id     IS NOT NULL
          AND  e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
        INSERT INTO public.app_notifications (
            company_id, audience,
            recipient_auth_user_id, recipient_employee_id,
            type, title, body,
            ref_type, ref_id, dedupe_key, data
        ) VALUES (
            p_company_id, 'hr',
            r.auth_user_id, r.employee_id,
            'contractor_banking_pending',
            'Banking Update Requires Review',
            coalesce(nullif(trim(p_contractor_name), ''), 'Contractor')
                || ' submitted a banking update'
                || CASE WHEN p_account_last4 <> ''
                         THEN ' (account ending ' || p_account_last4 || ')'
                         ELSE '' END
                || ' — HR review required before activation.',
            'contractor', p_contractor_id::text,
            'contractor_banking_pending:' || p_contractor_id::text
                || ':' || r.employee_id::text || ':' || v_hour_window,
            jsonb_build_object(
                'contractor_id', p_contractor_id,
                'account_last4', p_account_last4
            )
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_hr_contractor_banking_update TO anon, authenticated;


-- ── 3. Portal: get current banking (masked) ───────────────────────────────────
--
-- Returns current banking from contractors table with account number masked.
-- Full account number is NEVER exposed to the portal.

CREATE OR REPLACE FUNCTION public.contractor_portal_get_banking(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ct  public.contractors%ROWTYPE;
    v_masked text;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id         = p_contractor_id
      AND  company_id = p_company_id
      AND  is_active  = true;

    IF NOT FOUND THEN RETURN NULL; END IF;

    -- Mask account number: show last 4 digits only
    v_masked := CASE
        WHEN v_ct.bank_account IS NULL OR length(trim(v_ct.bank_account)) = 0
             THEN NULL
        ELSE repeat('•', GREATEST(0, length(trim(v_ct.bank_account)) - 4))
             || right(trim(v_ct.bank_account), 4)
    END;

    RETURN json_build_object(
        'account_holder_name',     v_ct.account_holder_name,
        'bank_name',               v_ct.bank_name,
        'masked_account',          v_masked,
        'bank_branch_code',        v_ct.bank_branch_code,
        'account_type',            v_ct.account_type,
        'swift_bic',               v_ct.swift_bic,
        'has_banking_details',     (v_ct.bank_name IS NOT NULL OR v_ct.bank_account IS NOT NULL),
        'banking_verified',        v_ct.banking_verified,
        'payment_hold',            v_ct.payment_hold,
        'compliance_hold',         v_ct.compliance_hold,
        'payment_terms',           v_ct.payment_terms,
        'preferred_payment_method', v_ct.preferred_payment_method
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_banking TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_portal_get_banking IS
    'Returns current banking status with masked account number. '
    'Full account number is never returned to the portal. Phase 2C.3.';


-- ── 4. Portal: submit banking update ─────────────────────────────────────────
--
-- Creates a pending banking update record.
-- If a pending update already exists, it is replaced (contractor can re-submit).
-- Does NOT touch the contractors table banking fields.

CREATE OR REPLACE FUNCTION public.contractor_portal_submit_banking(
    p_contractor_id     uuid,
    p_company_id        uuid,
    p_account_holder    text,
    p_bank_name         text,
    p_bank_account      text,
    p_branch_code       text,
    p_account_type      text,
    p_swift_bic         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ct          public.contractors%ROWTYPE;
    v_update_id   uuid;
    v_account_last4 text;
BEGIN
    -- Validate identity
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;

    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    IF trim(coalesce(p_account_holder, '')) = '' THEN
        RAISE EXCEPTION 'Account holder name is required';
    END IF;
    IF trim(coalesce(p_bank_name, '')) = '' THEN
        RAISE EXCEPTION 'Bank name is required';
    END IF;
    IF trim(coalesce(p_bank_account, '')) = '' THEN
        RAISE EXCEPTION 'Account number is required';
    END IF;

    -- Compute last 4 for notifications/activity (never store separately)
    v_account_last4 := right(trim(p_bank_account), 4);

    -- Replace any existing pending update (contractor re-submitted)
    DELETE FROM public.contractor_banking_updates
    WHERE  contractor_id = p_contractor_id
      AND  status        = 'pending';

    -- Insert new pending update
    INSERT INTO public.contractor_banking_updates (
        contractor_id, company_id,
        account_holder_name, bank_name, bank_account,
        bank_branch_code, account_type, swift_bic,
        status, submitted_at, created_at
    ) VALUES (
        p_contractor_id, p_company_id,
        nullif(trim(p_account_holder), ''),
        nullif(trim(p_bank_name), ''),
        trim(p_bank_account),
        nullif(trim(p_branch_code), ''),
        nullif(trim(p_account_type), ''),
        nullif(trim(p_swift_bic), ''),
        'pending', now(), now()
    )
    RETURNING id INTO v_update_id;

    -- Activity log
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal',
        'contractor_banking_update_submitted', 'info',
        jsonb_build_object(
            'contractor_id',    p_contractor_id,
            'update_id',        v_update_id,
            'account_last4',    v_account_last4
        ),
        now()
    );

    -- HR notification
    PERFORM public.notify_hr_contractor_banking_update(
        p_company_id, p_contractor_id, v_ct.name, v_account_last4
    );

    RETURN v_update_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_banking TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_portal_submit_banking IS
    'Creates a pending banking update (replaces existing pending if present). '
    'Never modifies contractors table banking fields. Phase 2C.3.';


-- ── 5. Portal: get pending banking update ─────────────────────────────────────
--
-- Returns the contractor's current pending update if any, with masked account.

CREATE OR REPLACE FUNCTION public.contractor_portal_get_pending_banking(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.contractor_banking_updates%ROWTYPE;
    v_masked text;
BEGIN
    SELECT * INTO v_row
    FROM   public.contractor_banking_updates
    WHERE  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  status        = 'pending'
    ORDER  BY submitted_at DESC
    LIMIT  1;

    IF NOT FOUND THEN RETURN NULL; END IF;

    v_masked := CASE
        WHEN v_row.bank_account IS NULL OR length(trim(v_row.bank_account)) = 0
             THEN NULL
        ELSE repeat('•', GREATEST(0, length(trim(v_row.bank_account)) - 4))
             || right(trim(v_row.bank_account), 4)
    END;

    RETURN json_build_object(
        'id',                   v_row.id,
        'account_holder_name',  v_row.account_holder_name,
        'bank_name',            v_row.bank_name,
        'masked_account',       v_masked,
        'bank_branch_code',     v_row.bank_branch_code,
        'account_type',         v_row.account_type,
        'swift_bic',            v_row.swift_bic,
        'status',               v_row.status,
        'submitted_at',         v_row.submitted_at,
        'rejection_reason',     v_row.rejection_reason
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_pending_banking TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_portal_get_pending_banking IS
    'Returns the contractor portal pending banking update with masked account. '
    'Returns null when no pending update exists. Phase 2C.3.';;
