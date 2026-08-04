-- Product decision: contractor portal codes do not expire.
-- The system-generated contractor_code is the permanent login credential
-- (still requires is_active + portal_enabled). Rotate replaces the code only.

-- 1) Resolve: no expiry check
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
    ct.id          AS contractor_id,
    ct.company_id,
    ct.name        AS contractor_name,
    ct.contractor_code,
    c.code         AS company_code
  INTO v_contractor
  FROM public.contractors ct
  INNER JOIN public.companies c ON c.id = ct.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_company_code))
    AND upper(trim(ct.contractor_code)) = upper(trim(p_contractor_code))
    AND ct.is_active = true
    AND coalesce(ct.portal_enabled, false) = true
    AND ct.contractor_code IS NOT NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '[]'::json;
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
  'Portal login resolve. Requires active contractor + portal_enabled. Codes do not expire; rotate to revoke.';

-- 2) Rotate: never set expiry
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
  v_new_code text;
BEGIN
  IF get_my_role(p_company_id) NOT IN ('owner', 'hr') THEN
    RAISE EXCEPTION 'INSUFFICIENT_ROLE: owner or hr required'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contractors
    WHERE id = p_contractor_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'CONTRACTOR_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_code := upper(substring(
    md5(random()::text || clock_timestamp()::text)
    FROM 1 FOR 8
  ));

  UPDATE public.contractors
  SET contractor_code            = v_new_code,
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

REVOKE ALL ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.hr_rotate_contractor_code(uuid, uuid) IS
  'Generates a new non-expiring contractor portal code. Previous code stops working immediately.';

-- 3) Clear legacy expiry timestamps so UI/state stays clean
UPDATE public.contractors
SET contractor_code_expires_at = NULL
WHERE contractor_code_expires_at IS NOT NULL;
