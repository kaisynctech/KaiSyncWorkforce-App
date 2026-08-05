-- ════════════════════════════════════════════════════════════════════════════
-- AUTHORIZATION AUDIT — Revoke inappropriate anon EXECUTE grants
--
-- HR/admin/payroll/finance RPCs must not be callable with the publishable anon key.
-- Worker portal (client_*, contractor_*) and public app version RPCs unchanged.
--
-- Rollback: re-GRANT anon on each function (see docs/security/authorization-remediation-report.md)
-- ════════════════════════════════════════════════════════════════════════════

SET search_path = public;
CREATE OR REPLACE FUNCTION public._safe_revoke_anon(p_signature text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', p_signature);
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;
SELECT public._safe_revoke_anon('public.hr_upsert_shift_template(uuid, uuid, text, text, text, int, jsonb)');
SELECT public._safe_revoke_anon('public.hr_delete_shift_template(uuid, uuid)');
SELECT public._safe_revoke_anon('public.hr_set_default_shift_template(uuid, uuid)');
SELECT public._safe_revoke_anon('public.hr_set_job_assignments(uuid, uuid, uuid, uuid[])');
SELECT public._safe_revoke_anon('public.get_employee_shift_templates(uuid)');
SELECT public._safe_revoke_anon('public.platform_is_admin()');
SELECT public._safe_revoke_anon('public.platform_list_companies(integer, integer)');
SELECT public._safe_revoke_anon('public.platform_set_subscription_status(uuid, text, text)');
SELECT public._safe_revoke_anon('public.platform_set_company_feature(uuid, text, boolean, timestamptz, text)');
SELECT public._safe_revoke_anon('public.platform_admin_dashboard()');
SELECT public._safe_revoke_anon('public.platform_search_companies(text, integer, integer)');
SELECT public._safe_revoke_anon('public.platform_customer_health(uuid)');
SELECT public._safe_revoke_anon('public.platform_feedback_stats()');
SELECT public._safe_revoke_anon('public.platform_refresh_company_subscription(uuid)');
SELECT public._safe_revoke_anon('public.hr_delete_employee_safe(uuid, uuid)');
SELECT public._safe_revoke_anon('public.hr_allocate_inventory_to_job(uuid, uuid, uuid, uuid, numeric, numeric)');
SELECT public._safe_revoke_anon('public.approve_pending_employee(uuid)');
SELECT public._safe_revoke_anon('public.reject_pending_employee(uuid)');
SELECT public._safe_revoke_anon('public.hr_get_employees_last_punch(uuid, uuid[])');
DROP FUNCTION public._safe_revoke_anon(text);
-- Self-register company is pre-auth onboarding only — keep anon (intentional)
-- get_latest_app_version / list_public_app_versions — keep anon (website downloads);
