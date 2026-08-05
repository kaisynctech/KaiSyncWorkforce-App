-- ARCH-004 Migration 1: Revoke anon execute on step-up-guarded functions.
-- These functions were rebuilt in ARCH-003 using CREATE OR REPLACE, which
-- preserves existing grants. The anon grants predate ARCH-001 and must be removed.
DO $$
DECLARE
  v_fn text;
  v_sig text;
BEGIN
  -- approve_payment_run
  FOR v_sig IN
    SELECT pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'approve_payment_run'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.approve_payment_run(%s) FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.approve_payment_run(%s) FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.approve_payment_run(%s) TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.approve_payment_run(%s) TO service_role', v_sig);
  END LOOP;
  -- transfer_company_ownership
  FOR v_sig IN
    SELECT pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'transfer_company_ownership'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.transfer_company_ownership(%s) FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.transfer_company_ownership(%s) FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.transfer_company_ownership(%s) TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.transfer_company_ownership(%s) TO service_role', v_sig);
  END LOOP;
  -- update_employee_banking
  FOR v_sig IN
    SELECT pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_employee_banking'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.update_employee_banking(%s) FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.update_employee_banking(%s) FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.update_employee_banking(%s) TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.update_employee_banking(%s) TO service_role', v_sig);
  END LOOP;
  -- upsert_company_settings
  FOR v_sig IN
    SELECT pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_company_settings'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.upsert_company_settings(%s) FROM PUBLIC', v_sig);
    EXECUTE format('REVOKE ALL ON FUNCTION public.upsert_company_settings(%s) FROM anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.upsert_company_settings(%s) TO authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.upsert_company_settings(%s) TO service_role', v_sig);
  END LOOP;
END $$;
-- Verify: confirm no anon grants remain on these four functions.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('approve_payment_run', 'transfer_company_ownership',
                      'update_employee_banking', 'upsert_company_settings')
    AND EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ace
      JOIN pg_roles r ON r.oid = ace.grantee
      WHERE r.rolname = 'anon' AND ace.privilege_type = 'EXECUTE'
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION 'ARCH-004 M1: % function(s) still have anon grants after revocation.', v_count;
  END IF;
END $$;;
