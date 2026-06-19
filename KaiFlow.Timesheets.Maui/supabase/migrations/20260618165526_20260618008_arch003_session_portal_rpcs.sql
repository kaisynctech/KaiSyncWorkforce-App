-- =============================================================================
-- ARCH-003 Migration 8: Session management + portal code rotation RPCs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rebuild contractor_resolve_by_code with expiry check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contractor_resolve_by_code(
    p_company_code    text,
    p_contractor_code text
)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_contractor RECORD;
BEGIN
    SELECT
        ct.id                        AS contractor_id,
        ct.company_id,
        ct.name                      AS contractor_name,
        ct.contractor_code,
        ct.contractor_code_expires_at,
        c.code                       AS company_code
    INTO v_contractor
    FROM public.contractors ct
    INNER JOIN public.companies c ON c.id = ct.company_id
    WHERE upper(trim(c.code))  = upper(trim(p_company_code))
      AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
      AND ct.is_active = true
      AND ct.contractor_code IS NOT NULL
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN '[]'::json;
    END IF;

    IF v_contractor.contractor_code_expires_at IS NOT NULL
       AND v_contractor.contractor_code_expires_at < now() THEN
        RAISE EXCEPTION 'PORTAL_CODE_EXPIRED: contractor portal code has expired'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN json_build_array(json_build_object(
        'contractor_id',   v_contractor.contractor_id,
        'company_id',      v_contractor.company_id,
        'contractor_name', v_contractor.contractor_name,
        'contractor_code', v_contractor.contractor_code,
        'company_code',    v_contractor.company_code
    ));
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rebuild client_resolve_by_code with expiry check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_resolve_by_code(
    p_company_code text,
    p_client_code  text
)
RETURNS TABLE(
    client_id    uuid,
    company_id   uuid,
    company_code text,
    client_code  text,
    client_name  text,
    email        text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client RECORD;
BEGIN
    SELECT
        cl.id                      AS _client_id,
        c.id                       AS _company_id,
        c.code                     AS _company_code,
        cl.client_code             AS _client_code,
        cl.name                    AS _client_name,
        cl.email                   AS _email,
        cl.client_code_expires_at
    INTO v_client
    FROM public.companies c
    JOIN public.clients cl ON cl.company_id = c.id
    WHERE upper(trim(c.code))  = upper(trim(p_company_code))
      AND upper(trim(cl.client_code)) = upper(trim(p_client_code))
      AND cl.client_code IS NOT NULL
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_client.client_code_expires_at IS NOT NULL
       AND v_client.client_code_expires_at < now() THEN
        RAISE EXCEPTION 'PORTAL_CODE_EXPIRED: client portal code has expired'
            USING ERRCODE = 'P0001';
    END IF;

    client_id    := v_client._client_id;
    company_id   := v_client._company_id;
    company_code := v_client._company_code;
    client_code  := v_client._client_code;
    client_name  := v_client._client_name;
    email        := v_client._email;
    RETURN NEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. hr_list_active_sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_list_active_sessions(
    p_company_id  uuid,
    p_employee_id uuid DEFAULT NULL
)
RETURNS TABLE(
    session_id    uuid,
    employee_id   uuid,
    employee_name text,
    login_method  text,
    device_info   jsonb,
    created_at    timestamptz,
    last_seen_at  timestamptz,
    expires_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    SELECT
        s.id                                                                     AS session_id,
        s.employee_id,
        trim(COALESCE(e.name, '') || ' ' || COALESCE(e.surname, ''))::text      AS employee_name,
        s.login_method,
        s.device_info,
        s.created_at,
        s.last_seen_at,
        s.expires_at
    FROM public.employee_code_sessions s
    JOIN public.employees e ON e.id = s.employee_id
    WHERE s.company_id  = p_company_id
      AND s.revoked_at IS NULL
      AND (p_employee_id IS NULL OR s.employee_id = p_employee_id)
    ORDER BY s.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_list_active_sessions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_list_active_sessions(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_list_active_sessions(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. hr_revoke_session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_revoke_session(
    p_company_id uuid,
    p_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_employee_id uuid;
BEGIN
    IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT employee_id INTO v_employee_id
    FROM public.employee_code_sessions
    WHERE id         = p_session_id
      AND company_id = p_company_id
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'SESSION_NOT_FOUND: session does not exist or is already revoked'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.employee_code_sessions
    SET revoked_at = now(),
        revoked_by = auth.uid()
    WHERE id = p_session_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'session_revoked',
            'employee_code_session',
            p_session_id::text,
            NULL,
            NULL,
            jsonb_build_object('employee_id', v_employee_id)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_revoke_session(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_revoke_session(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_revoke_session(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. hr_revoke_all_employee_sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_revoke_all_employee_sessions(
    p_company_id  uuid,
    p_employee_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_revoked_count integer;
BEGIN
    IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.employee_code_sessions
    SET revoked_at = now(),
        revoked_by = auth.uid()
    WHERE company_id  = p_company_id
      AND employee_id = p_employee_id
      AND revoked_at IS NULL;

    GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'sessions_bulk_revoked',
            'employee',
            p_employee_id::text,
            NULL,
            NULL,
            jsonb_build_object('revoked_count', v_revoked_count)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    RETURN v_revoked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_revoke_all_employee_sessions(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_revoke_all_employee_sessions(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_revoke_all_employee_sessions(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. hr_rotate_contractor_code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_rotate_contractor_code(
    p_company_id    uuid,
    p_contractor_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_code    text;
    v_expiry_days integer;
    v_expires_at  timestamptz;
BEGIN
    IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
            USING ERRCODE = 'P0001';
    END IF;

    -- Verify contractor belongs to this company
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id
    ) THEN
        RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    -- Read expiry config
    SELECT COALESCE((cs.security_settings->>'portal_code_expiry_days')::int, 365)
    INTO v_expiry_days
    FROM public.company_settings cs
    WHERE cs.company_id = p_company_id;

    IF NOT FOUND THEN
        v_expiry_days := 365;
    END IF;

    v_expires_at := now() + (v_expiry_days || ' days')::interval;

    -- Generate cryptographically random 8-char code
    v_new_code := upper(substring(
        md5(random()::text || clock_timestamp()::text)
        FROM 1 FOR 8
    ));

    UPDATE public.contractors
    SET contractor_code           = v_new_code,
        contractor_code_expires_at = v_expires_at,
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
            jsonb_build_object('expires_at', v_expires_at)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    RETURN v_new_code;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. hr_rotate_client_code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_rotate_client_code(
    p_company_id uuid,
    p_client_id  uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_code    text;
    v_expiry_days integer;
    v_expires_at  timestamptz;
BEGIN
    IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
            USING ERRCODE = 'P0001';
    END IF;

    -- Verify client belongs to this company
    IF NOT EXISTS (
        SELECT 1 FROM public.clients
        WHERE id = p_client_id AND company_id = p_company_id
    ) THEN
        RAISE EXCEPTION 'CLIENT_NOT_FOUND'
            USING ERRCODE = 'P0001';
    END IF;

    -- Read expiry config
    SELECT COALESCE((cs.security_settings->>'portal_code_expiry_days')::int, 365)
    INTO v_expiry_days
    FROM public.company_settings cs
    WHERE cs.company_id = p_company_id;

    IF NOT FOUND THEN
        v_expiry_days := 365;
    END IF;

    v_expires_at := now() + (v_expiry_days || ' days')::interval;

    -- Generate cryptographically random 8-char code
    v_new_code := upper(substring(
        md5(random()::text || clock_timestamp()::text)
        FROM 1 FOR 8
    ));

    UPDATE public.clients
    SET client_code           = v_new_code,
        client_code_expires_at = v_expires_at,
        client_code_rotated_at = now()
    WHERE id = p_client_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id,
            'portal_code_rotated',
            'client',
            p_client_id::text,
            NULL,
            NULL,
            jsonb_build_object('expires_at', v_expires_at)
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    RETURN v_new_code;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_rotate_client_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_rotate_client_code(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hr_rotate_client_code(uuid, uuid) TO authenticated;
