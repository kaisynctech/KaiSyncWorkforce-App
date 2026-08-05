-- Client portal codes: permanent (no expiry). Revoke via portal_enabled.
-- Also: login rate limit + clients.view/edit RLS enforcement.

-- ── 1. portal_enabled ─────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.portal_enabled IS
  'When true, client_code may be used for portal login. Codes do not expire.';

UPDATE public.clients
SET portal_enabled = true
WHERE client_code IS NOT NULL
  AND coalesce(portal_enabled, false) = false;

UPDATE public.clients
SET client_code_expires_at = NULL
WHERE client_code_expires_at IS NOT NULL;

-- ── 2. Resolve: no expiry; require portal_enabled; rate limit ──────────────
CREATE OR REPLACE FUNCTION public.client_resolve_by_code(
  p_company_code text,
  p_client_code text
)
RETURNS TABLE(
  client_id uuid,
  company_id uuid,
  company_code text,
  client_code text,
  client_name text,
  email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id   uuid;
  v_threshold integer;
  v_new_count integer;
  v_client    RECORD;
  v_code      text := upper(trim(p_client_code));
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
        AND portal_kind = 'client'
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
    cl.id          AS _client_id,
    c.id           AS _company_id,
    c.code         AS _company_code,
    cl.client_code AS _client_code,
    cl.name        AS _client_name,
    cl.email       AS _email
  INTO v_client
  FROM public.companies c
  JOIN public.clients cl ON cl.company_id = c.id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = v_code
    AND cl.client_code IS NOT NULL
    AND coalesce(cl.portal_enabled, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_comp_id IS NOT NULL AND v_code <> '' THEN
      INSERT INTO public.portal_code_login_attempts
        (company_id, portal_kind, portal_code, attempt_date, failed_attempts, last_attempt_at)
      VALUES
        (v_comp_id, 'client', v_code, CURRENT_DATE, 1, now())
      ON CONFLICT (company_id, portal_kind, portal_code, attempt_date) DO UPDATE
        SET failed_attempts = portal_code_login_attempts.failed_attempts + 1,
            last_attempt_at = now();

      SELECT failed_attempts INTO v_new_count
      FROM public.portal_code_login_attempts
      WHERE company_id = v_comp_id
        AND portal_kind = 'client'
        AND portal_code = v_code
        AND attempt_date = CURRENT_DATE;

      IF v_new_count >= v_threshold THEN
        UPDATE public.portal_code_login_attempts
        SET locked_until = now() + INTERVAL '15 minutes'
        WHERE company_id = v_comp_id
          AND portal_kind = 'client'
          AND portal_code = v_code
          AND attempt_date = CURRENT_DATE;

        BEGIN
          PERFORM public.write_audit_event(
            v_comp_id,
            'portal_login_lockout',
            'client_code',
            v_code,
            NULL,
            NULL,
            jsonb_build_object(
              'portal_kind', 'client',
              'failed_attempts', v_new_count,
              'locked_until', now() + INTERVAL '15 minutes'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;
    RETURN;
  END IF;

  IF v_comp_id IS NOT NULL THEN
    UPDATE public.portal_code_login_attempts
    SET failed_attempts = 0,
        locked_until = NULL
    WHERE company_id = v_comp_id
      AND portal_kind = 'client'
      AND portal_code = v_code
      AND attempt_date = CURRENT_DATE;
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

REVOKE ALL ON FUNCTION public.client_resolve_by_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_resolve_by_code(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.client_resolve_by_code(text, text) IS
  'Portal login resolve. Requires portal_enabled. Codes do not expire. Daily attempt lockout.';

-- ── 3. Rotate kept for emergency/MAUI — never sets expiry ─────────────────
CREATE OR REPLACE FUNCTION public.hr_rotate_client_code(
  p_company_id uuid,
  p_client_id uuid
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
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = p_client_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_code := upper(substring(
    md5(random()::text || clock_timestamp()::text)
    FROM 1 FOR 8
  ));

  UPDATE public.clients
  SET client_code            = v_new_code,
      client_code_expires_at = NULL,
      client_code_rotated_at = now(),
      portal_enabled         = true
  WHERE id = p_client_id;

  BEGIN
    PERFORM write_audit_event(
      p_company_id,
      'portal_code_rotated',
      'client',
      p_client_id::text,
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

REVOKE ALL ON FUNCTION public.hr_rotate_client_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_rotate_client_code(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_rotate_client_code(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.hr_rotate_client_code(uuid, uuid) IS
  'Emergency: generates a new non-expiring client portal code. Prefer portal_enabled=false to revoke.';

-- ── 4. clients RLS — permission-aware ─────────────────────────────────────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_all ON public.clients;
DROP POLICY IF EXISTS clients_select ON public.clients;
DROP POLICY IF EXISTS clients_insert ON public.clients;
DROP POLICY IF EXISTS clients_update ON public.clients;
DROP POLICY IF EXISTS clients_delete ON public.clients;
DROP POLICY IF EXISTS p_clients_all ON public.clients;
DROP POLICY IF EXISTS p_clients_select ON public.clients;
DROP POLICY IF EXISTS p_clients_insert ON public.clients;
DROP POLICY IF EXISTS p_clients_update ON public.clients;
DROP POLICY IF EXISTS p_clients_delete ON public.clients;

CREATE POLICY clients_select ON public.clients
  FOR SELECT TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.view')
  );

CREATE POLICY clients_insert ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY clients_update ON public.clients
  FOR UPDATE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  )
  WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );

CREATE POLICY clients_delete ON public.clients
  FOR DELETE TO authenticated
  USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'clients.edit')
  );
