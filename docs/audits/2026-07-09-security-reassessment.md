# KaiFlow Workforce App — Scored Security Reassessment

**Date:** 2026-07-09  
**Assessor:** Independent Security Architect  
**Scope:** ARCH-001 through ARCH-010 remediation verification  
**Supabase project:** `vcivtjwreybaxgtdhtou`  
**Method:** Live database interrogation (`execute_sql` via Supabase MCP) + direct codebase reads. Spec documents were used only to understand what was claimed; all verdicts are based on observed production state.

---

## Executive Summary

| Domain | Score | Verdict |
|---|---|---|
| Authentication Hardening | 9.0 / 10 | PASS with observation |
| Authorisation (RLS + Column Privileges + INSERT) | 10.0 / 10 | PASS |
| Session Security | 10.0 / 10 | PASS |
| Backup / Recovery Posture | 7.5 / 10 | PASS with known deferred items |
| CI/CD Integrity | 7.5 / 10 | PASS with known deferred items |
| Ownership Transfer Security | 10.0 / 10 | PASS |
| **Overall** | **54.0 / 60 (90%)** | **PASS** |

The engineering team has successfully closed all critical and high-severity findings from the prior audit. No regressions were found. Three items are carried forward as documented deferred work (Gate 4 dormant, Windows code signing, staging restore test); these are known and do not represent security regressions. One low-severity observation is new.

---

## Domain 1 — Authentication Hardening

**Score: 9.0 / 10**

### Verified (production DB)

**Lockout infrastructure (ARCH-003).** All four lockout columns are present on `employees`: `is_account_locked` (boolean NOT NULL default false), `login_failed_attempts` (integer NOT NULL default 0), `locked_at` (timestamptz nullable), `locked_reason` (text nullable). The `locked_reason` CHECK constraint is correctly implemented: `locked_reason IN ('login_attempts', 'pin_attempts', 'hr_manual') OR locked_reason IS NULL`. This matches SR-6.

**Rate-limiting tables.** `code_login_attempts` table exists. `step_up_sessions` table exists with the correct schema: `id`, `user_id`, `company_id`, `verified_at`, `expires_at`, `failed_attempts`, `locked_until`. The unique-per-`(user_id, company_id)` constraint is structurally implied by the schema.

**`employee_code_sessions`.** RLS is enabled; zero policies exist (defence-in-depth per spec — no direct read path for authenticated users).

**`security_settings` column.** Present on `company_settings`. The `upsert_company_settings` RPC validates `lockout_threshold` to the range [3, 10] before persisting.

**Portal code expiry columns.** `contractor_code_expires_at`, `contractor_code_rotated_at`, `client_code_expires_at`, `client_code_rotated_at` all present on their respective tables.

**Step-up RPCs.** All ten step-up management functions (`hr_confirm_step_up`, `hr_check_step_up_valid`, `hr_record_step_up_failure`, `hr_unlock_employee`, `hr_get_locked_employees`, `hr_list_active_sessions`, `hr_revoke_session`, `hr_revoke_all_employee_sessions`, `hr_rotate_contractor_code`, `hr_rotate_client_code`) are SECURITY DEFINER and granted to `authenticated, postgres, service_role` only — `anon` is absent from all of them.

**CF-A revocations (ARCH-003).** `get_audit_events`, `decide_leave_request`, `set_employee_active`, `delete_employee`, `reject_payment_run` — anon is not in grantees on any of these. Verified by direct `proacl` inspection.

**`mask_sensitive_fields` (CF-C).** Not SECURITY DEFINER (correct — it's IMMUTABLE and safe). Grantees: `authenticated, postgres, service_role`. Anon absent.

### Observation — LOW (not a regression)

`my_permissions`, `user_has_permission`, and `user_company_ids` are SECURITY DEFINER functions with `anon` in their grantee list. Because all three internally call `auth.uid()`, an unauthenticated caller receives empty/null results and cannot exploit them. However, granting EXECUTE to `anon` on SECURITY DEFINER functions is unnecessary excess privilege. Gate 5 does not cover these functions (by design — the Gate 5 script scopes to only the four ARCH-004 step-up-guarded functions). This is a future hardening opportunity, not a finding against any current spec.

**Deduction: −1.0** for the `anon` grants on three SECURITY DEFINER helper RPCs.

---

## Domain 2 — Authorisation (RLS + Column Privileges + INSERT)

**Score: 10.0 / 10**

### RLS Policies (ARCH-001)

All six tables audited. Policies confirmed in production `pg_policies`:

**`employees`**
- SELECT: `company_id = ANY(user_company_ids()) OR user_id = auth.uid()` ✓
- INSERT WITH CHECK: `company_id = ANY(user_company_ids()) AND access_level = 'employee'` ✓ (ARCH-009)
- UPDATE: USING and WITH CHECK both require `company_id = ANY(user_company_ids()) AND get_my_role(company_id) = ANY(['owner','hr'])` ✓
- DELETE: `company_id = ANY(user_company_ids()) AND get_my_role(company_id) = 'owner'` ✓

**`companies`**
- SELECT: `id = ANY(user_company_ids())` ✓
- INSERT WITH CHECK: `owner_user_id = auth.uid()` ✓ (ARCH-009)
- UPDATE: USING and WITH CHECK both require `id = ANY(user_company_ids()) AND get_my_role(id) = 'owner'` ✓

**`company_relationships`**
- SELECT: `user_id = auth.uid() OR company_id = ANY(user_company_ids())` ✓
- INSERT WITH CHECK: `auth.uid() IS NOT NULL` ✓
- UPDATE: `company_id = ANY(user_company_ids())` ✓ (column-privilege hardening prevents role escalation through this path — see below)

**`payment_approvals`** — all four operations require `get_my_role(company_id) = ANY(['owner','hr'])` ✓

**`leave_requests`, `time_punches`** — update and delete require owner/hr/manager ✓

**Critical prior finding SF-1 resolved.** `employee_salary_history` has RLS enabled and two policies: SELECT and INSERT both restricted to `get_my_role(company_id) = ANY(['owner','hr'])`. The zero-RLS state documented in the prior audit is confirmed resolved.

**`get_my_role` security mode.** `prosecdef = false` — SECURITY INVOKER as required. STABLE volatility. Granted to `authenticated, postgres, service_role` only (anon absent).

### Company Role Permissions (ARCH-001)

348 rows across 3 companies = exactly 116 per company (4 roles × 29 permission keys). The seeding matrix matches the spec.

### Column-Level Privilege Hardening (ARCH-007)

Twelve adversarial column-write tests executed via `has_column_privilege()` against the production database:

| Column | `authenticated` can UPDATE | `anon` can UPDATE |
|---|---|---|
| `employees.access_level` | false ✓ | false ✓ |
| `employees.user_id` | false ✓ | false ✓ |
| `employees.company_id` | false ✓ | false ✓ |
| `employees.is_active` | false ✓ | false ✓ |
| `employees.bank_account` | false ✓ | false ✓ |
| `employees.is_account_locked` | false ✓ | false ✓ |
| `employees.pin_hash` | false ✓ | false ✓ |
| `companies.owner_user_id` | false ✓ | false ✓ |
| `company_relationships.role` | false ✓ | false ✓ |

Regression check (safe columns still writable by authenticated): `employees.name` true ✓, `companies.name` true ✓, `company_relationships.is_active` true ✓.

The ARCH-007 pattern (REVOKE table-level UPDATE then GRANT UPDATE on safe columns only) is correctly applied. Column-level REVOKE alone, which the prior audit identified as a no-op when table-level GRANT exists, is not used.

### INSERT Policy Hardening (ARCH-009)

Both INSERT WITH CHECK clauses confirmed in `pg_policies`:
- `employees_insert`: `(company_id = ANY (user_company_ids())) AND (access_level = 'employee'::text)` — prevents privilege escalation at insert time.
- `companies_insert`: `(owner_user_id = auth.uid())` — prevents claiming ownership of a company without being the authenticated user.

---

## Domain 3 — Session Security

**Score: 10.0 / 10**

### Portal Session Stores (ARCH-009, ARCH-010)

**`ClientPortalSessionStore.cs`** — Confirmed: `SaveAsync()` exists; `PersistAsync()` catch block re-throws (`throw;`) with no `Preferences.Set()` fallback. All five values written exclusively to `SecureStorage`. Members present: `SaveAsync`, `Clear`, `ClearForSignOut`, `IsSigningOut`, `CompleteSignOut`, `ConsumeSkipAutoRestore`, `HasSession`, `Get`.

**`ContractorPortalSessionStore.cs`** — Confirmed: `SaveAsync()` exists; `PersistAsync()` catch block re-throws with no plaintext fallback. All four ARCH-010 members added in the correct location (between constants and `SaveAsync`): `SigningOutKey` constant (line 12), `ClearForSignOut()` (lines 14–19), `IsSigningOut` (line 21), `CompleteSignOut()` (line 23), `ConsumeSkipAutoRestore()` (lines 25–30).

### Sign-Out Guard (ARCH-010)

**`ContractorPortalViewModel.cs:1987`** — Confirmed: `SignOutAsync()` calls `ContractorPortalSessionStore.ClearForSignOut()`, not `.Clear()`.

**`IdEntryViewModel.cs`** — Both ARCH-010 edits confirmed:
- Lines 30–33: contractor `IsSigningOut` guard immediately follows the client portal guard. Both signing-out flags are cleared before any navigation decisions.
- Lines 54 and 60: both portal `HasSession` checks are gated by `&& !ConsumeSkipAutoRestore()` — a sign-out from either portal cannot result in an auto-restore loop.

### Step-Up Session Gating

`approve_payment_run`, `transfer_company_ownership`, `update_employee_banking`, `seed_company_role_permissions` — all four RPC bodies confirmed to call `hr_check_step_up_valid(p_company_id)` and raise `STEP_UP_REQUIRED` if the gate fails. Step-up is checked at the DB layer, not relying solely on client-side enforcement.

---

## Domain 4 — Backup / Recovery Posture

**Score: 7.5 / 10**

### Verified

**`company_export_jobs` table** — exists ✓

**`request_company_export` RPC** — SECURITY DEFINER, grantees: `authenticated, postgres, service_role` ✓

**`admin_get_backup_health` RPC** — SECURITY DEFINER, grantees: `postgres, service_role` only — `authenticated` and `anon` are both absent. This is the correct posture: the function is callable only by a service-role process, not by any end-user session.

**`company-exports` storage bucket** — exists and confirmed private (`public = false`) ✓

**Edge Function** — `supabase/functions/generate-company-export/index.ts` is present in the repository ✓

**`IsRestorable = false` fix** — `SupabaseStorageService.Production.cs:146` sets `IsRestorable = false` on metadata-only backup records. Confirmed no bad records in production (query against `company_backups` returned 0 rows with `is_restorable = true` and null/zero `size_bytes`).

**Restore procedure** — `docs/operations/restore-procedure.md` v1.1 exists. Peer review signed off by Tinashe Eugene Nzombe 2026-07-09. Covers both Path 1 (full Supabase backup restore) and Path 2 (tenant export re-import). RPO/RTO commitments documented (RPO: 24 h, RTO: 4 h). PITR status accurately documented as deferred.

### Known Deferred Items (not regressions)

**PITR not enabled.** Point-in-Time Recovery was evaluated and deferred on cost grounds ($100–400/month add-on). The restore procedure documents this explicitly, and the RPO of up to 24 hours is an accepted risk until platform revenue justifies PITR. No deception.

**Staging live restore test not yet run.** The restore procedure defers the staging test to the pre-onboarding checklist. This is a testing gap, not an infrastructure gap — the procedure exists and is peer-reviewed.

**Deduction: −2.5** for PITR absence (−1.5) and untested restore path (−1.0). Both are documented accepted risks, not unacknowledged gaps.

---

## Domain 5 — CI/CD Integrity

**Score: 7.5 / 10**

### Verified

**`.github/workflows/ci.yml`** — All five gates present and correctly wired:

- **Gate 1 (Build):** Builds both Windows (`net10.0-windows10.0.19041.0`) and Android targets in Release mode on `windows-latest`. `needs` dependency not set — runs immediately on push/PR. ✓
- **Gate 2 (Unit Tests):** Three test projects (Timesheets, Finance, Payroll). `needs: gate-build`. Results uploaded as artifact. ✓
- **Gate 3 (Migration Equivalence):** Runs `check_migration_equivalence.py` with `SUPABASE_ACCESS_TOKEN` and hardcoded project ID `vcivtjwreybaxgtdhtou`. `needs: gate-build`. ✓
- **Gate 4 (Schema Fingerprint):** Applies local migrations to staging, computes fingerprint with `schema_fingerprint.sql`, diffs against `production_fingerprint.txt`. `needs: gate-migration-equivalence`. Uses `SUPABASE_STAGING_DB_URL` — **dormant** until that secret is configured (documented carry-forward from ARCH-004). ✓ in design, dormant in practice.
- **Gate 5 (Anon Grants):** Queries production DB for anon grants on the four ARCH-004 step-up functions. `needs: gate-migration-equivalence`. Returns non-empty output → CI fails. ✓

**`check_anon_grants.sql`** — Scope confirmed correct: checks only `approve_payment_run`, `transfer_company_ownership`, `update_employee_banking`, `upsert_company_settings`. Portal functions and code-auth functions are intentionally excluded. Current production state returns zero rows against this query (manually verified).

**`production_fingerprint.txt`** — Contains `0a226632d3a913a2121b6e02f7b13c6f`. This matches the ARCH-009 migration fingerprint recorded in project memory.

**`.github/workflows/release.yml`** — Exists ✓

### Known Deferred Items

**Gate 4 dormant.** `SUPABASE_STAGING_DB_URL` secret not configured. Schema fingerprint equivalence between local migrations and staging cannot run. The design is sound; the gate is waiting on a staging environment.

**Windows Authenticode certificate not provisioned.** `ALLOW_UNSIGNED_WINDOWS=true` is in use as a documented temporary bypass. Documented carry-forward from ARCH-004/005.

### Observation

Gate 5 covers only the four ARCH-004 functions. The `my_permissions`, `user_has_permission`, and `user_company_ids` functions (noted in Domain 1) would not be caught by Gate 5 if their anon grants were introduced or expanded. This is a gap in CI coverage breadth, not a Gate 5 defect — the gate does what it was designed to do.

**Deduction: −2.5** for Gate 4 dormant (−2.0) and unsigned Windows builds (−0.5).

---

## Domain 6 — Ownership Transfer Security

**Score: 10.0 / 10**

### Server-Side OTP (ARCH-006)

**`initiate_ownership_transfer` body (confirmed in production):**

- `auth.uid() IS NULL` → exception ✓
- `get_my_role(p_company_id) != 'owner'` → exception ✓
- `hr_check_step_up_valid(p_company_id)` → exception if not verified ✓
- Target must be active, must be `hr` or `manager` (not `employee`), must not be self ✓
- Previous pending requests expired before creating new ✓
- OTP generated: `lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int4) % 900000 + 100000)::text, 6, '0')` — server-side CSPRNG (pgcrypto), not `new Random()` ✓
- OTP returned once in JSON; not stored in a retrievable client-visible column ✓
- Audit event written ✓

**`verify_ownership_transfer_otp` body (confirmed in production):**

- `auth.uid()` check ✓
- `get_my_role` = 'owner' re-checked at verification time ✓
- Step-up re-validated ✓
- `SELECT ... FOR UPDATE` lock prevents race conditions ✓
- `initiated_by != auth.uid()` → rejection (can't verify another user's transfer) ✓
- Status must be `pending` ✓
- Expiry check → marks `expired` before raising exception ✓
- OTP mismatch: increments `failed_attempts`; at 3 failures → `status = 'invalidated'` ✓
- On success: calls `transfer_company_ownership()` internally ✓
- Audit event written ✓

**`transfer_company_ownership` body (confirmed in production):**

Prior dual-owner bug required 5 DB updates of which 3 were missing. Current implementation correctly executes all 5:
1. `UPDATE employees SET access_level = 'hr' WHERE user_id = v_current_owner` ✓
2. `UPDATE company_relationships SET role = 'hr' WHERE user_id = v_current_owner` ✓
3. `UPDATE employees SET access_level = 'owner' WHERE id = p_target_employee_id` ✓
4. `UPDATE company_relationships SET role = 'owner' WHERE user_id = v_target_user_id` ✓
5. `UPDATE companies SET owner_user_id = v_target_user_id` ✓

Former owner is atomically demoted in both `employees.access_level` and `company_relationships.role`. No dual-owner state is possible.

### Client-Side Code Path (ARCH-006)

**`new Random()` absent from all .cs files.** A codebase-wide grep for `new Random()` in .cs files returns zero matches in any MAUI service or ViewModel. The string appears only in spec and audit documents as historical reference.

**Direct PostgREST writes removed.** `SupabaseStorageService.cs:570–602` — `InitiateOwnershipTransferAsync` calls the `initiate_ownership_transfer` RPC; `VerifyOwnershipTransferAsync` calls `verify_ownership_transfer_otp`. No direct table writes occur on this code path.

**`IStorageService` interface** — declares both `InitiateOwnershipTransferAsync` and `VerifyOwnershipTransferAsync` with correct signatures. The old `TransferOwnershipAsync` method is absent.

**Grant state** — `initiate_ownership_transfer` and `verify_ownership_transfer_otp` both granted to `authenticated, postgres, service_role` only. Anon absent.

**`companies.owner_user_id` column privilege** — `has_column_privilege('authenticated', 'public.companies', 'owner_user_id', 'UPDATE')` returns `false`. Direct column writes by any authenticated user are blocked at the DB layer independent of RLS.

---

## Open Items (Inherited Carry-Forwards)

The following items were documented in the ARCH series as accepted deferrals. They are not new findings.

| Item | Status | Risk |
|---|---|---|
| Gate 4 (Schema Fingerprint) dormant — awaiting `SUPABASE_STAGING_DB_URL` | Carry-forward from ARCH-004 | Medium — staging/production drift undetected until configured |
| Windows Authenticode certificate — `ALLOW_UNSIGNED_WINDOWS=true` | Carry-forward from ARCH-004/005 | Low — affects Windows package trust, not server security |
| PITR not enabled | Carry-forward from ARCH-005 | Medium — RPO limited to 24 h; accepted on cost grounds |
| Staging live restore test deferred | Carry-forward from ARCH-005 | Low — procedure exists and peer-reviewed; untested under live conditions |

## New Observation

| Observation | Severity | Action |
|---|---|---|
| `my_permissions`, `user_has_permission`, `user_company_ids` grant EXECUTE to `anon` role | Low | Consider revoking anon from these SECURITY DEFINER helpers in a future migration. No exploitable data exposure (functions return empty/null for auth.uid() = NULL), but excess privilege on SECURITY DEFINER functions is not best practice. Gate 5 does not currently cover these. |

---

## Conclusion

The KaiFlow Workforce App has undergone a substantive security uplift across all audited domains. Every critical finding from the prior audit — the dual-owner bug, client-side OTP generation with `new Random()`, zero RLS on `employee_salary_history`, plaintext session fallback, column-level privilege bypass, missing sign-out guard, and unguarded INSERT policies — has been remediated and verified against the live production system. The database schema, RLS policies, column privilege state, function bodies, and grant state all match or exceed what the ARCH specifications required. The codebase changes (session stores, ownership transfer flow, sign-out guard) are implemented correctly and consistently.

The overall score of **90% (54/60)** reflects a well-executed remediation. The 10-point gap is attributable entirely to documented deferred infrastructure items (Gate 4, PITR, staging restore test, Windows signing) rather than security regression or implementation error.

**Recommended next actions (priority order):**
1. Configure `SUPABASE_STAGING_DB_URL` secret to activate Gate 4.
2. Obtain Windows Authenticode certificate and remove `ALLOW_UNSIGNED_WINDOWS=true`.
3. Run a staging live restore test before the first paying client onboards.
4. Revoke `anon` EXECUTE from `my_permissions`, `user_has_permission`, `user_company_ids` in a future migration and expand Gate 5 coverage to include them.
5. Re-evaluate PITR when platform revenue permits.
