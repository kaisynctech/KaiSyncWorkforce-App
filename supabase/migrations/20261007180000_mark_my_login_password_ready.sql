-- ============================================================
-- mark_my_login_password_ready
--
-- ARCH-007 revoked client UPDATE on employees.login_password_ready.
-- The mandatory-password page was updating the column directly, so the
-- flag never flipped — every Sign in bounced users back to "Set password".
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_my_login_password_ready()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.employees
  SET login_password_ready = true
  WHERE user_id = v_uid
    AND is_active = true
    AND COALESCE(login_password_ready, false) = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Already ready counts as success (idempotent).
  IF v_updated = 0 THEN
    PERFORM 1
    FROM public.employees
    WHERE user_id = v_uid
      AND is_active = true
      AND login_password_ready = true
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No linked employee found for this account';
    END IF;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_my_login_password_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_my_login_password_ready() TO authenticated;

NOTIFY pgrst, 'reload schema';
