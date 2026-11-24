-- 20261030075349_seed_view_payroll_employee_off
-- Restored from the live migration history (supabase_migrations.schema_migrations) on 2026-11-24.
-- This is the SQL exactly as it was applied to production.

DO $d$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.seed_company_role_permissions(uuid)'::regprocedure);
  v_new := regexp_replace(v_def, $r$(\['employee','payments\.view_payroll',\s*)'true'\]$r$, $r$\1'false']$r$);
  IF v_new <> v_def THEN EXECUTE v_new; END IF;
END $d$;
