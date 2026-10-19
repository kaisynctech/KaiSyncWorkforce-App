-- client_resolve_by_code returns a column named company_id. A failed sign-in
-- then writes portal_code_login_attempts with ON CONFLICT (company_id, ...),
-- and Postgres treats that name as both the result column and the table column.
-- Use the primary-key constraint instead, and say so when the code is real
-- but Portal user is off.

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
      SELECT 1 FROM public.portal_code_login_attempts a
      WHERE a.company_id = v_comp_id
        AND a.portal_kind = 'client'
        AND a.portal_code = v_code
        AND a.attempt_date = CURRENT_DATE
        AND a.locked_until IS NOT NULL
        AND a.locked_until > now()
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
    cl.email       AS _email,
    coalesce(cl.portal_enabled, false) AS _portal_enabled
  INTO v_client
  FROM public.companies c
  JOIN public.clients cl ON cl.company_id = c.id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(cl.client_code)) = v_code
    AND cl.client_code IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_comp_id IS NOT NULL AND v_code <> '' THEN
      INSERT INTO public.portal_code_login_attempts
        (company_id, portal_kind, portal_code, attempt_date, failed_attempts, last_attempt_at)
      VALUES
        (v_comp_id, 'client', v_code, CURRENT_DATE, 1, now())
      ON CONFLICT ON CONSTRAINT portal_code_login_attempts_pkey DO UPDATE
        SET failed_attempts = portal_code_login_attempts.failed_attempts + 1,
            last_attempt_at = now();

      SELECT a.failed_attempts INTO v_new_count
      FROM public.portal_code_login_attempts a
      WHERE a.company_id = v_comp_id
        AND a.portal_kind = 'client'
        AND a.portal_code = v_code
        AND a.attempt_date = CURRENT_DATE;

      IF v_new_count >= v_threshold THEN
        UPDATE public.portal_code_login_attempts a
        SET locked_until = now() + INTERVAL '15 minutes'
        WHERE a.company_id = v_comp_id
          AND a.portal_kind = 'client'
          AND a.portal_code = v_code
          AND a.attempt_date = CURRENT_DATE;

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

  IF NOT v_client._portal_enabled THEN
    RAISE EXCEPTION 'PORTAL_DISABLED: Portal access is turned off for this client. Turn on Portal user on the client record, then sign in again.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_comp_id IS NOT NULL THEN
    UPDATE public.portal_code_login_attempts a
    SET failed_attempts = 0,
        locked_until = NULL
    WHERE a.company_id = v_comp_id
      AND a.portal_kind = 'client'
      AND a.portal_code = v_code
      AND a.attempt_date = CURRENT_DATE;
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
