-- Gate 5: Verify the 4 step-up-guarded functions revoked in ARCH-004 Phase 0
-- still do NOT grant EXECUTE to the anon role.
-- These four functions require authenticated HR sessions and must never be
-- callable by unauthenticated (anon) callers.
-- Portal / code-auth functions are intentionally callable by anon and are excluded.
-- Returns rows if any of these four have an anon regression (CI fails on non-empty).
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.proname = ANY(ARRAY[
    'approve_payment_run',
    'transfer_company_ownership',
    'update_employee_banking',
    'upsert_company_settings'
  ])
  AND EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) ace
    JOIN pg_roles r ON r.oid = ace.grantee
    WHERE r.rolname = 'anon'
      AND ace.privilege_type = 'EXECUTE'
  )
ORDER BY p.proname;
