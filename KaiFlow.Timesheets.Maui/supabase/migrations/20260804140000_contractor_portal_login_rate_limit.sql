-- Contractor portal login rate limit (parity with employee code lockout).
-- Uses dedicated table so employee code_login_attempts stays unchanged.

CREATE TABLE IF NOT EXISTS public.portal_code_login_attempts (
  company_id      uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portal_kind     text         NOT NULL CHECK (portal_kind IN ('contractor', 'client')),
  portal_code     text         NOT NULL,
  attempt_date    date         NOT NULL DEFAULT CURRENT_DATE,
  failed_attempts integer      NOT NULL DEFAULT 0,
  last_attempt_at timestamptz  NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  PRIMARY KEY (company_id, portal_kind, portal_code, attempt_date)
);

ALTER TABLE public.portal_code_login_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.portal_code_login_attempts IS
  'Failed portal code login attempts (contractor/client). No direct PostgREST access.';

CREATE OR REPLACE FUNCTION public.contractor_resolve_by_code(
  p_company_code text,
  p_contractor_code text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comp_id     uuid;
  v_threshold   integer;
  v_new_count   integer;
  v_contractor  RECORD;
  v_code        text := upper(trim(p_contractor_code));
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
        AND portal_kind = 'contractor'
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
    ct.id          AS contractor_id,
    ct.company_id,
    ct.name        AS contractor_name,
    ct.contractor_code,
    c.code         AS company_code
  INTO v_contractor
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = v_code
    AND ct.is_active = true
    AND coalesce(ct.portal_enabled, false) = true
    AND ct.contractor_code IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    IF v_comp_id IS NOT NULL AND v_code <> '' THEN
      INSERT INTO public.portal_code_login_attempts
        (company_id, portal_kind, portal_code, attempt_date, failed_attempts, last_attempt_at)
      VALUES
        (v_comp_id, 'contractor', v_code, CURRENT_DATE, 1, now())
      ON CONFLICT (company_id, portal_kind, portal_code, attempt_date) DO UPDATE
        SET failed_attempts = portal_code_login_attempts.failed_attempts + 1,
            last_attempt_at = now();

      SELECT failed_attempts INTO v_new_count
      FROM public.portal_code_login_attempts
      WHERE company_id = v_comp_id
        AND portal_kind = 'contractor'
        AND portal_code = v_code
        AND attempt_date = CURRENT_DATE;

      IF v_new_count >= v_threshold THEN
        UPDATE public.portal_code_login_attempts
        SET locked_until = now() + INTERVAL '15 minutes'
        WHERE company_id = v_comp_id
          AND portal_kind = 'contractor'
          AND portal_code = v_code
          AND attempt_date = CURRENT_DATE;

        BEGIN
          PERFORM public.write_audit_event(
            v_comp_id,
            'portal_login_lockout',
            'contractor_code',
            v_code,
            NULL,
            NULL,
            jsonb_build_object(
              'portal_kind', 'contractor',
              'failed_attempts', v_new_count,
              'locked_until', now() + INTERVAL '15 minutes'
            )
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
        END;
      END IF;
    END IF;

    RETURN '[]'::json;
  END IF;

  IF v_comp_id IS NOT NULL THEN
    UPDATE public.portal_code_login_attempts
    SET failed_attempts = 0,
        locked_until = NULL
    WHERE company_id = v_comp_id
      AND portal_kind = 'contractor'
      AND portal_code = v_code
      AND attempt_date = CURRENT_DATE;
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

REVOKE ALL ON FUNCTION public.contractor_resolve_by_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contractor_resolve_by_code(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.contractor_resolve_by_code(text, text) IS
  'Portal login resolve with daily attempt lockout (default 5 fails → 15 min). Codes do not expire.';
