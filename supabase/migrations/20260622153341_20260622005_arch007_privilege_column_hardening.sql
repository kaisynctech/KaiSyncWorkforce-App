-- ============================================================
-- ARCH-007: Privilege Column Hardening
--
-- Context: authenticated and anon hold table-level UPDATE on
-- employees, companies, and company_relationships. Column-level
-- REVOKE is ineffective when a table-level grant exists —
-- PostgreSQL's table-level grants subsume column-level
-- revocations. The correct technique is REVOKE table-level,
-- then GRANT UPDATE on safe columns only.
--
-- SECURITY DEFINER RPCs run as postgres and are unaffected.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. employees
-- ----------------------------------------------------------------
REVOKE UPDATE ON TABLE public.employees FROM authenticated, anon;

GRANT UPDATE (
    name, surname, employee_code,
    employment_type, employment_type_label, worker_type,
    position, branch, cost_center,
    employment_date, termination_date, date_of_birth,
    email, phone, profile_photo_url,
    id_number,
    manager_user_id, shift_template_id, registration_status,
    hourly_rate, daily_rate, weekly_rate, monthly_salary,
    overtime_rate, double_time_rate, daily_hours, work_days_weekly,
    pay_basis, paye_rate_percent, uif_exempt,
    medical_aid_deduction, pension_deduction, union_deduction,
    pay_full_monthly_salary, paye_fixed_amount,
    uif_rate_percent, uif_fixed_amount,
    tax_number, paye_reference,
    medical_aid_member_number, pension_fund_number,
    tax_directive_number, tax_directive_rate_percent
) ON TABLE public.employees TO authenticated;

-- Protected and NOT granted:
--   id (PK), company_id, user_id, access_level, is_active (brief targets)
--   bank_account, bank_name, bank_branch_code,
--     bank_details_updated_at, bank_details_updated_by (update_employee_banking RPC)
--   pin_hash, pin_set_at, pin_reset_required,
--     pin_failed_attempts, pin_locked_until (PIN auth RPCs)
--   login_failed_attempts, is_account_locked, locked_at,
--     locked_reason (account lock RPCs)
--   temp_login_code, temp_login_code_expires_at,
--     login_password_ready (auth flow)
--   created_at (immutable)

-- ----------------------------------------------------------------
-- 2. companies
-- ----------------------------------------------------------------
REVOKE UPDATE ON TABLE public.companies FROM authenticated, anon;

GRANT UPDATE (
    name, contact_email, contact_phone, address, logo_url,
    is_vat_registered, vat_number, default_vat_rate,
    finance_vat_inclusive_default,
    custom_settings, enabled_modules
) ON TABLE public.companies TO authenticated;

-- Protected and NOT granted:
--   id (PK), code (immutable), created_at (immutable)
--   owner_user_id (ARCH-006 OTP-gated)
--   plan_code, subscription_active, trial_started_at (service_role only)

-- ----------------------------------------------------------------
-- 3. company_relationships
-- ----------------------------------------------------------------
REVOKE UPDATE ON TABLE public.company_relationships FROM authenticated, anon;

GRANT UPDATE (is_active)
    ON TABLE public.company_relationships TO authenticated;

-- Protected and NOT granted:
--   id (PK), created_at (immutable)
--   user_id (identity), company_id (tenant), role (escalation target)

-- ================================================================
-- Adversarial privilege verification (18 tests)
-- ================================================================
DO $$
DECLARE
  v_failures text[] := '{}';
BEGIN
  -- T1–T4: employees — brief-specified protected columns
  IF has_column_privilege('authenticated', 'public.employees', 'access_level', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T1 FAIL: authenticated can UPDATE employees.access_level');
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'user_id', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T2 FAIL: authenticated can UPDATE employees.user_id');
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'company_id', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T3 FAIL: authenticated can UPDATE employees.company_id');
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'is_active', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T4 FAIL: authenticated can UPDATE employees.is_active');
  END IF;
  -- T5: companies.owner_user_id
  IF has_column_privilege('authenticated', 'public.companies', 'owner_user_id', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T5 FAIL: authenticated can UPDATE companies.owner_user_id');
  END IF;
  -- T6–T7: company_relationships authority columns
  IF has_column_privilege('authenticated', 'public.company_relationships', 'role', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T6 FAIL: authenticated can UPDATE company_relationships.role');
  END IF;
  IF has_column_privilege('authenticated', 'public.company_relationships', 'user_id', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T7 FAIL: authenticated can UPDATE company_relationships.user_id');
  END IF;
  -- T8–T10: DD-3 and DD-4 bonus protections (banking + auth)
  IF has_column_privilege('authenticated', 'public.employees', 'bank_account', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T8 FAIL: authenticated can UPDATE employees.bank_account (banking RPC bypass)');
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'is_account_locked', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T9 FAIL: authenticated can UPDATE employees.is_account_locked');
  END IF;
  IF has_column_privilege('authenticated', 'public.employees', 'pin_hash', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T10 FAIL: authenticated can UPDATE employees.pin_hash');
  END IF;
  -- T11–T12: subscription columns on companies
  IF has_column_privilege('authenticated', 'public.companies', 'plan_code', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T11 FAIL: authenticated can UPDATE companies.plan_code');
  END IF;
  IF has_column_privilege('authenticated', 'public.companies', 'subscription_active', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T12 FAIL: authenticated can UPDATE companies.subscription_active');
  END IF;
  -- T13–T15: anon must have no write on any of these tables
  IF has_column_privilege('anon', 'public.employees', 'access_level', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T13 FAIL: anon can UPDATE employees.access_level');
  END IF;
  IF has_column_privilege('anon', 'public.companies', 'owner_user_id', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T14 FAIL: anon can UPDATE companies.owner_user_id');
  END IF;
  IF has_column_privilege('anon', 'public.company_relationships', 'role', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T15 FAIL: anon can UPDATE company_relationships.role');
  END IF;
  -- T16–T18: Legitimate direct writes must still work (regression)
  IF NOT has_column_privilege('authenticated', 'public.employees', 'name', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T16 FAIL: authenticated CANNOT UPDATE employees.name — legitimate write broken');
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.companies', 'name', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T17 FAIL: authenticated CANNOT UPDATE companies.name — legitimate write broken');
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.company_relationships', 'is_active', 'UPDATE') THEN
    v_failures := array_append(v_failures,
      'T18 FAIL: authenticated CANNOT UPDATE company_relationships.is_active — legitimate write broken');
  END IF;
  -- Final result
  IF array_length(v_failures, 1) > 0 THEN
    RAISE EXCEPTION E'ARCH-007 privilege tests FAILED:\n%',
      array_to_string(v_failures, E'\n');
  END IF;
  RAISE NOTICE 'ARCH-007 privilege verification: 18 tests passed';
END;
$$;;
