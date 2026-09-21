-- ============================================================
-- Properties Wave 5: Tenant (resident) portal
-- Code-auth + SECURITY DEFINER RPCs (mirrors client/contractor).
-- ============================================================

-- ── Resident portal identity ─────────────────────────────────
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS resident_code text;

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS resident_code_rotated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_residents_company_code
  ON public.residents (company_id, upper(trim(resident_code)))
  WHERE resident_code IS NOT NULL AND length(trim(resident_code)) > 0;

COMMENT ON COLUMN public.residents.resident_code IS
  'Permanent tenant portal login code (assigned once; disable portal to revoke).';
COMMENT ON COLUMN public.residents.portal_enabled IS
  'When true, resident may sign in to /tenant-portal with company + resident codes.';

-- Extend portal login lockout kinds
ALTER TABLE public.portal_code_login_attempts
  DROP CONSTRAINT IF EXISTS portal_code_login_attempts_portal_kind_check;

ALTER TABLE public.portal_code_login_attempts
  ADD CONSTRAINT portal_code_login_attempts_portal_kind_check
  CHECK (portal_kind IN ('contractor', 'client', 'resident'));

-- ── Payment proofs (tenant submits; HR reviews; then Money payment) ─
CREATE TABLE IF NOT EXISTS public.finance_payment_proofs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL REFERENCES public.finance_invoices(id) ON DELETE CASCADE,
  lease_id        uuid REFERENCES public.property_leases(id) ON DELETE SET NULL,
  resident_id     uuid REFERENCES public.residents(id) ON DELETE SET NULL,
  storage_path    text NOT NULL,
  file_url        text,
  amount          numeric(14, 2),
  reference       text,
  notes           text,
  status          text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'accepted', 'rejected')),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  review_notes    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_payment_proofs_path_not_blank CHECK (length(trim(storage_path)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_finance_payment_proofs_invoice
  ON public.finance_payment_proofs (invoice_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_payment_proofs_company_status
  ON public.finance_payment_proofs (company_id, status);

ALTER TABLE public.finance_payment_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finance_payment_proofs_select ON public.finance_payment_proofs;
DROP POLICY IF EXISTS finance_payment_proofs_update ON public.finance_payment_proofs;

CREATE POLICY finance_payment_proofs_select ON public.finance_payment_proofs
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'properties.view')
      OR public.user_has_permission(company_id, 'invoices.view')
    )
  );

CREATE POLICY finance_payment_proofs_update ON public.finance_payment_proofs
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'properties.edit')
      OR public.user_has_permission(company_id, 'invoices.edit')
    )
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND (
      public.user_has_permission(company_id, 'properties.edit')
      OR public.user_has_permission(company_id, 'invoices.edit')
    )
  );

GRANT SELECT, UPDATE ON public.finance_payment_proofs TO authenticated;
REVOKE ALL ON public.finance_payment_proofs FROM anon;

-- ── Shared resolver ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._resident_from_portal_codes(
  p_company_code text,
  p_resident_code text
)
RETURNS public.residents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
BEGIN
  SELECT r.* INTO v_res
  FROM public.residents r
  INNER JOIN public.companies c ON c.id = r.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(r.resident_code)) = upper(trim(p_resident_code))
    AND r.resident_code IS NOT NULL
    AND coalesce(r.portal_enabled, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESIDENT_NOT_FOUND';
  END IF;

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public._resident_from_portal_codes(text, text) FROM PUBLIC;

-- ── Login ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resident_resolve_by_code(
  p_company_code text,
  p_resident_code text
)
RETURNS TABLE (
  resident_id uuid,
  company_id uuid,
  company_code text,
  resident_code text,
  resident_name text,
  email text,
  phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id   uuid;
  v_threshold integer;
  v_new_count integer;
  v_res       RECORD;
  v_code      text := upper(trim(p_resident_code));
BEGIN
  SELECT c.id INTO v_comp_id
  FROM public.companies c
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
  LIMIT 1;

  IF v_comp_id IS NOT NULL THEN
    SELECT COALESCE((cs.security_settings->>'lockout_threshold')::integer, 5)
    INTO v_threshold
    FROM public.company_settings cs
    WHERE cs.company_id = v_comp_id;
    v_threshold := COALESCE(v_threshold, 5);

    IF EXISTS (
      SELECT 1 FROM public.portal_code_login_attempts
      WHERE company_id = v_comp_id
        AND portal_kind = 'resident'
        AND portal_code = v_code
        AND attempt_date = CURRENT_DATE
        AND locked_until IS NOT NULL
        AND locked_until > now()
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_LOCKED: Too many failed sign-in attempts. Please try again later.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_threshold := 5;
  END IF;

  SELECT
    r.id AS _resident_id,
    c.id AS _company_id,
    c.code AS _company_code,
    r.resident_code AS _resident_code,
    trim(both from coalesce(r.name, '') || ' ' || coalesce(r.surname, '')) AS _resident_name,
    r.email AS _email,
    r.phone AS _phone
  INTO v_res
  FROM public.companies c
  JOIN public.residents r ON r.company_id = c.id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(r.resident_code)) = v_code
    AND r.resident_code IS NOT NULL
    AND coalesce(r.portal_enabled, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_comp_id IS NOT NULL AND v_code <> '' THEN
      INSERT INTO public.portal_code_login_attempts
        (company_id, portal_kind, portal_code, attempt_date, failed_attempts, last_attempt_at)
      VALUES
        (v_comp_id, 'resident', v_code, CURRENT_DATE, 1, now())
      ON CONFLICT (company_id, portal_kind, portal_code, attempt_date) DO UPDATE
        SET failed_attempts = portal_code_login_attempts.failed_attempts + 1,
            last_attempt_at = now();

      SELECT failed_attempts INTO v_new_count
      FROM public.portal_code_login_attempts
      WHERE company_id = v_comp_id
        AND portal_kind = 'resident'
        AND portal_code = v_code
        AND attempt_date = CURRENT_DATE;

      IF v_new_count >= v_threshold THEN
        UPDATE public.portal_code_login_attempts
        SET locked_until = now() + INTERVAL '15 minutes'
        WHERE company_id = v_comp_id
          AND portal_kind = 'resident'
          AND portal_code = v_code
          AND attempt_date = CURRENT_DATE;
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_comp_id IS NOT NULL THEN
    UPDATE public.portal_code_login_attempts
    SET failed_attempts = 0,
        locked_until = NULL
    WHERE company_id = v_comp_id
      AND portal_kind = 'resident'
      AND portal_code = v_code
      AND attempt_date = CURRENT_DATE;
  END IF;

  resident_id   := v_res._resident_id;
  company_id    := v_res._company_id;
  company_code  := v_res._company_code;
  resident_code := v_res._resident_code;
  resident_name := v_res._resident_name;
  email         := v_res._email;
  phone         := v_res._phone;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.resident_resolve_by_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_resolve_by_code(text, text) TO anon, authenticated;

-- ── Lease summary ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_get_lease_summary(
  p_company_code text,
  p_resident_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_payload json;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);

  SELECT json_build_object(
    'resident', json_build_object(
      'id', v_res.id,
      'name', v_res.name,
      'surname', v_res.surname,
      'phone', v_res.phone,
      'email', v_res.email,
      'move_in_date', v_res.move_in_date,
      'move_out_date', v_res.move_out_date
    ),
    'leases', coalesce((
      SELECT json_agg(row_to_json(x) ORDER BY x.start_date DESC)
      FROM (
        SELECT
          pl.id,
          pl.status,
          pl.start_date,
          pl.end_date,
          pl.rent_amount,
          pl.deposit_amount,
          pl.currency,
          pl.payment_frequency,
          pl.notes,
          s.id AS site_id,
          s.name AS site_name,
          s.address AS site_address,
          u.id AS unit_id,
          u.unit_number,
          u.unit_type
        FROM public.property_leases pl
        INNER JOIN public.sites s ON s.id = pl.site_id
        LEFT JOIN public.units u ON u.id = pl.unit_id
        WHERE pl.company_id = v_res.company_id
          AND pl.resident_id = v_res.id
          AND pl.status IN ('active', 'draft', 'ended')
      ) x
    ), '[]'::json)
  ) INTO v_payload;

  RETURN v_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_get_lease_summary(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_get_lease_summary(text, text) TO anon, authenticated;

-- ── Invoices for resident leases ─────────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_list_invoices(
  p_company_code text,
  p_resident_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);

  RETURN coalesce((
    SELECT json_agg(row_to_json(x) ORDER BY x.due_date DESC NULLS LAST)
    FROM (
      SELECT
        fi.id,
        fi.invoice_number,
        fi.status,
        fi.issue_date,
        fi.due_date,
        fi.total_amount,
        fi.amount_paid,
        fi.balance_due,
        fi.currency,
        fi.invoice_type,
        fi.lease_id,
        fi.site_id
      FROM public.finance_invoices fi
      WHERE fi.company_id = v_res.company_id
        AND fi.status NOT IN ('draft', 'cancelled', 'voided')
        AND (
          fi.lease_id IN (
            SELECT pl.id FROM public.property_leases pl
            WHERE pl.company_id = v_res.company_id AND pl.resident_id = v_res.id
          )
          OR (
            fi.client_id IS NOT NULL
            AND fi.client_id IN (
              SELECT pl.tenant_client_id FROM public.property_leases pl
              WHERE pl.company_id = v_res.company_id
                AND pl.resident_id = v_res.id
                AND pl.tenant_client_id IS NOT NULL
            )
          )
        )
    ) x
  ), '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_list_invoices(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_list_invoices(text, text) TO anon, authenticated;

-- ── Prepare payment proof upload ─────────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_prepare_payment_proof_upload(
  p_company_code text,
  p_resident_code text,
  p_invoice_id uuid,
  p_storage_path text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_inv public.finance_invoices%ROWTYPE;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_prefix text;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);

  SELECT * INTO v_inv
  FROM public.finance_invoices
  WHERE id = p_invoice_id
    AND company_id = v_res.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND';
  END IF;

  IF v_inv.status IN ('draft', 'cancelled', 'voided') THEN
    RAISE EXCEPTION 'INVOICE_NOT_VISIBLE';
  END IF;

  IF NOT (
    (v_inv.lease_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.property_leases pl
      WHERE pl.id = v_inv.lease_id AND pl.resident_id = v_res.id
    ))
    OR (
      v_inv.client_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.property_leases pl
        WHERE pl.resident_id = v_res.id AND pl.tenant_client_id = v_inv.client_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'INVOICE_NOT_OWNED';
  END IF;

  IF v_path = '' THEN
    RAISE EXCEPTION 'storage_path_required';
  END IF;

  v_prefix := 'payment_proofs/' || v_res.company_id::text || '/' || p_invoice_id::text || '/';
  IF left(v_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'storage_path_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    v_res.company_id, NULL, v_path, 'resident_payment_proof',
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = NULL,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', now() + interval '15 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_prepare_payment_proof_upload(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_prepare_payment_proof_upload(text, text, uuid, text) TO anon, authenticated;

-- ── Submit payment proof ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_submit_payment_proof(
  p_company_code text,
  p_resident_code text,
  p_invoice_id uuid,
  p_storage_path text,
  p_file_url text,
  p_amount numeric DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_inv public.finance_invoices%ROWTYPE;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_prefix text;
  v_lease_id uuid;
  v_row public.finance_payment_proofs%ROWTYPE;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);

  SELECT * INTO v_inv
  FROM public.finance_invoices
  WHERE id = p_invoice_id AND company_id = v_res.company_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_inv.status IN ('draft', 'cancelled', 'voided') THEN
    RAISE EXCEPTION 'INVOICE_NOT_VISIBLE';
  END IF;

  IF NOT (
    (v_inv.lease_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.property_leases pl
      WHERE pl.id = v_inv.lease_id AND pl.resident_id = v_res.id
    ))
    OR (
      v_inv.client_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.property_leases pl
        WHERE pl.resident_id = v_res.id AND pl.tenant_client_id = v_inv.client_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'INVOICE_NOT_OWNED';
  END IF;

  v_prefix := 'payment_proofs/' || v_res.company_id::text || '/' || p_invoice_id::text || '/';
  IF v_path = '' OR left(v_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'storage_path_not_allowed';
  END IF;

  v_lease_id := v_inv.lease_id;
  IF v_lease_id IS NULL THEN
    SELECT pl.id INTO v_lease_id
    FROM public.property_leases pl
    WHERE pl.company_id = v_res.company_id
      AND pl.resident_id = v_res.id
      AND pl.status = 'active'
    ORDER BY pl.start_date DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.finance_payment_proofs (
    company_id, invoice_id, lease_id, resident_id,
    storage_path, file_url, amount, reference, notes, status
  ) VALUES (
    v_res.company_id, p_invoice_id, v_lease_id, v_res.id,
    v_path, nullif(trim(p_file_url), ''), p_amount,
    nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), 'submitted'
  )
  RETURNING * INTO v_row;

  UPDATE public.media_upload_grants
  SET consumed_at = now()
  WHERE storage_path = v_path
    AND consumed_at IS NULL;

  RETURN row_to_json(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_submit_payment_proof(text, text, uuid, text, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_submit_payment_proof(text, text, uuid, text, text, numeric, text, text) TO anon, authenticated;

-- ── Create maintenance issue (job) ───────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_create_issue(
  p_company_code text,
  p_resident_code text,
  p_title text,
  p_description text DEFAULT NULL,
  p_lease_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_lease public.property_leases%ROWTYPE;
  v_job_id uuid;
  v_job_code text;
  v_title text := trim(coalesce(p_title, ''));
  v_open_count integer;
  v_site_id uuid;
  v_unit_id uuid;
  v_lease_found boolean := false;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);
  v_site_id := v_res.site_id;
  v_unit_id := v_res.unit_id;

  IF v_title = '' THEN
    RAISE EXCEPTION 'title_required';
  END IF;

  SELECT count(*) INTO v_open_count
  FROM public.jobs j
  WHERE j.company_id = v_res.company_id
    AND j.resident_reporter = trim(both from coalesce(v_res.name, '') || ' ' || coalesce(v_res.surname, ''))
    AND j.status IN ('open', 'in_progress', 'assigned')
    AND j.opened_at > now() - interval '7 days';

  IF v_open_count >= 10 THEN
    RAISE EXCEPTION 'TOO_MANY_OPEN_ISSUES';
  END IF;

  IF p_lease_id IS NOT NULL THEN
    SELECT * INTO v_lease
    FROM public.property_leases
    WHERE id = p_lease_id
      AND company_id = v_res.company_id
      AND resident_id = v_res.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'LEASE_NOT_FOUND'; END IF;
    v_lease_found := true;
  ELSE
    SELECT * INTO v_lease
    FROM public.property_leases
    WHERE company_id = v_res.company_id
      AND resident_id = v_res.id
      AND status = 'active'
    ORDER BY start_date DESC
    LIMIT 1;
    v_lease_found := FOUND;
  END IF;

  IF v_lease_found THEN
    v_site_id := coalesce(v_lease.site_id, v_res.site_id);
    v_unit_id := coalesce(v_lease.unit_id, v_res.unit_id);
  END IF;

  v_job_code := public._next_job_code(v_res.company_id);

  INSERT INTO public.jobs (
    company_id,
    title,
    description,
    status,
    priority,
    job_code,
    site_id,
    unit_id,
    resident_reporter,
    opened_at
  ) VALUES (
    v_res.company_id,
    v_title,
    nullif(trim(p_description), ''),
    'open',
    'medium',
    v_job_code,
    v_site_id,
    v_unit_id,
    trim(both from coalesce(v_res.name, '') || ' ' || coalesce(v_res.surname, '')),
    now()
  )
  RETURNING id INTO v_job_id;

  RETURN json_build_object(
    'id', v_job_id,
    'job_code', v_job_code,
    'site_id', v_site_id,
    'unit_id', v_unit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_create_issue(text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_create_issue(text, text, text, text, uuid) TO anon, authenticated;

-- ── Issue photo upload grant + append ────────────────────────
CREATE OR REPLACE FUNCTION public.resident_portal_prepare_issue_photo_upload(
  p_company_code text,
  p_resident_code text,
  p_job_id uuid,
  p_storage_path text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_path text := trim(both '/' from trim(coalesce(p_storage_path, '')));
  v_prefix text;
  v_name text;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);
  v_name := trim(both from coalesce(v_res.name, '') || ' ' || coalesce(v_res.surname, ''));

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND company_id = v_res.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF coalesce(v_job.resident_reporter, '') <> v_name THEN
    RAISE EXCEPTION 'JOB_NOT_OWNED';
  END IF;

  IF v_path = '' THEN RAISE EXCEPTION 'storage_path_required'; END IF;

  v_prefix := 'job_photos/' || v_res.company_id::text || '/' || p_job_id::text || '/';
  IF left(v_path, length(v_prefix)) <> v_prefix THEN
    RAISE EXCEPTION 'storage_path_not_allowed';
  END IF;

  INSERT INTO public.media_upload_grants (
    company_id, employee_id, storage_path, purpose, expires_at
  ) VALUES (
    v_res.company_id, NULL, v_path, 'resident_issue_photo',
    now() + interval '15 minutes'
  )
  ON CONFLICT (storage_path) DO UPDATE SET
    company_id  = EXCLUDED.company_id,
    employee_id = NULL,
    purpose     = EXCLUDED.purpose,
    expires_at  = EXCLUDED.expires_at,
    consumed_at = NULL;

  RETURN json_build_object(
    'storage_path', v_path,
    'expires_at', now() + interval '15 minutes'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_prepare_issue_photo_upload(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_prepare_issue_photo_upload(text, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resident_portal_append_issue_photo(
  p_company_code text,
  p_resident_code text,
  p_job_id uuid,
  p_photo_url text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_job public.jobs%ROWTYPE;
  v_name text;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);
  v_name := trim(both from coalesce(v_res.name, '') || ' ' || coalesce(v_res.surname, ''));

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id AND company_id = v_res.company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOB_NOT_FOUND'; END IF;
  IF coalesce(v_job.resident_reporter, '') <> v_name THEN
    RAISE EXCEPTION 'JOB_NOT_OWNED';
  END IF;

  UPDATE public.jobs
  SET photo_urls_before = array_append(coalesce(photo_urls_before, '{}'), p_photo_url),
      photo_urls = array_append(coalesce(photo_urls, '{}'), p_photo_url),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN json_build_object('id', v_job.id, 'photo_urls', v_job.photo_urls);
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_append_issue_photo(text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_append_issue_photo(text, text, uuid, text) TO anon, authenticated;

-- List open issues for resident (recent)
CREATE OR REPLACE FUNCTION public.resident_portal_list_issues(
  p_company_code text,
  p_resident_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.residents%ROWTYPE;
  v_name text;
BEGIN
  v_res := public._resident_from_portal_codes(p_company_code, p_resident_code);
  v_name := trim(both from coalesce(v_res.name, '') || ' ' || coalesce(v_res.surname, ''));

  RETURN coalesce((
    SELECT json_agg(row_to_json(x) ORDER BY x.opened_at DESC)
    FROM (
      SELECT
        j.id,
        j.job_code,
        j.title,
        j.description,
        j.status,
        j.opened_at,
        j.site_id,
        j.unit_id,
        j.photo_urls_before
      FROM public.jobs j
      WHERE j.company_id = v_res.company_id
        AND j.resident_reporter = v_name
        AND j.opened_at > now() - interval '90 days'
      LIMIT 50
    ) x
  ), '[]'::json);
END;
$$;

REVOKE ALL ON FUNCTION public.resident_portal_list_issues(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resident_portal_list_issues(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
