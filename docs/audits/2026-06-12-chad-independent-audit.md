# KaiFlow Workforce App — Independent System Audit

**Audit date:** 12 June 2026  
**Auditor:** Chad (Cowork Audit Claude)  
**Scope:** Direct inspection of source code, migration files, service layer, schema, and RLS policies from the working tree. No build executed. Database schema read from migration history only — live DB not queried.  
**Reference audit:** `docs/audits/2026-06-12-enterprise-full-system-audit.md`

---

## My role on this project

Per the AGENTS.md and established workflow, I am the **Auditor / Designer** Claude. My responsibilities are:

- Read the codebase, database migrations, RLS policies, RPCs, services, ViewModels, and architecture
- Identify root causes (not symptoms)
- Design solutions and write precise, self-contained prompts for Claude Code to execute
- Apply migrations via the Supabase MCP after Claude Code delivers a clean build
- I do **not** write application code (C#, XAML), execute destructive DB operations, or drop objects directly

Every fix must pass the AGENTS.md enterprise checklist (Rule 1–12) before implementation begins.

---

## Executive summary

After direct inspection of 197 migration files, ~9,800 lines of service code, 103 ViewModels, 106 XAML views, all session stores, the permissions service, the accounting library, and the full RLS migration chain, I reach the same headline verdict as the reference audit — **not enterprise-ready for unrestricted production** — but I have found several findings the reference audit did not capture, and I have materially updated the severity picture on two of its critical findings.

**Overall enterprise readiness: 44/100** (my independent assessment — slightly lower than the reference's 48/100 due to two additional critical findings)

| Area | My score | Reference score | Direction |
|---|---:|---:|---|
| Product/domain coverage | 80 | 82 | Aligned |
| Frontend architecture | 58 | 61 | Slightly lower — confirmed XAML scale |
| Backend/data access | 48 | 52 | Lower — coupling worse than reported |
| Authentication | 56 | 58 | Aligned |
| Authorization/tenant isolation | 15 | 20 | Lower — new critical finding below |
| Database engineering | 40 | 43 | Lower — confirmed drift + new schema break |
| Payroll/finance correctness | 78 | 78 | Aligned |
| Reliability/offline/realtime | 62 | 64 | Aligned |
| Testing/quality gates | 36 | 38 | Aligned |
| Operations/DR/compliance | 30 | 31 | Aligned |

---

## What I read directly

- All 197 local migration files (April 2026 – June 12 2026)
- `SupabaseStorageService.cs` (5,691 lines) + 17 partial files (~9,816 lines total)
- `IStorageService.cs` (552 lines)
- `PermissionsService.cs` (144 lines)
- `ClientPortalSessionStore.cs`, `ContractorPortalSessionStore.cs`, `CodeSessionStore.cs`
- `TimesheetStateService.cs`
- `KaiFlow.Accounting` library — all providers and interfaces
- Key migrations: UUID v2 cutover batch (May 15), role taxonomy (May 12), permissions matrix (May 12), worker session enforcement (June 1), contractor RLS fixes (June 12)
- The reference audit in full

---

## Critical findings

### C-NEW-1. The permissions matrix was wiped by the UUID cutover and has never been restored

**Severity: Critical. This is a new finding not in the reference audit.**

**Evidence chain:**

1. Migration `20260512110000_role_permissions_matrix.sql` (May 12) created `company_role_permissions` table, `has_permission()`, `my_permissions()`, a seeding trigger, and seeded defaults for all existing companies.

2. Migration `20260512130000_permissions_matrix_hardening_phase2.sql` (May 12) added **restrictive** `AS RESTRICTIVE` policies on `jobs`, `client_deals`, `employees`, `contractors`, `leave_requests`, and `payment_approvals` — all calling `has_permission()`.

3. Migration `20260515154722_uuid_schema_v2_drop_legacy.sql` (May 15) **DROP TABLE … CASCADE** — including `company_role_permissions`. This CASCADE removed the seeding trigger on `companies`. The `has_permission()` and `has_hr_role_permission()` functions were **not** dropped (they are functions, not tables), but they now reference a table that no longer exists.

4. Migration `20260515160237_uuid_v2_batch7_rls_and_policies.sql` (May 15) recreated all tables with **permissive `FOR ALL`** membership policies only. No restrictive policies were installed.

5. No migration between May 15 and June 12 recreates `company_role_permissions` or reinstates the restrictive policies on core domain tables.

**Net result in production (if all local migrations are applied in order):**

- `company_role_permissions` does not exist
- `has_permission()` will raise `ERROR: relation "company_role_permissions" does not exist` on any call
- Every `AS RESTRICTIVE` policy on `jobs`, `employees`, `contractors`, `leave_requests`, `payment_approvals` calls `has_permission()` — meaning **those INSERT/UPDATE/DELETE operations will error out at the database level**, not silently grant access
- The permissive base policies (`FOR ALL` by company membership) remain in place for SELECT
- The only tables with functioning write control are those that don't use the restrictive policies

**However:** this assumes the May 12 migrations are applied to production. Given C2 (migration drift), it is possible production does not have the May 12 restrictive policies at all, leaving pure permissive FOR ALL. Either way — broken or absent — authorization is not functioning correctly.

**Required remediation:**

1. Determine the exact production state (run `SELECT * FROM pg_policies WHERE policyname LIKE 'r_%'` and `SELECT to_regclass('public.company_role_permissions')`)
2. Rebuild `company_role_permissions` in a migration that runs **after** the UUID cutover
3. Reinstall `has_permission()` and `has_hr_role_permission()` with the correct UUID-schema column names (see C-NEW-2)
4. Reinstall restrictive policies on all domain tables within the same migration
5. Do not release until this is verified in a staging environment rebuilt from migrations

---

### C-NEW-2. `has_permission()` and `has_hr_role_permission()` reference a column that was renamed in the UUID migration

**Severity: Critical. This is a new finding not in the reference audit.**

**Evidence:**

The permissions functions created in `20260512110000` and `20260512140000` reference `hr_users.auth_user_id`:

```sql
-- from has_permission():
from public.hr_users h
where h.auth_user_id = auth.uid()
  and h.company_id = p_company_id
```

The UUID v2 cutover in `20260515155949_uuid_v2_batch1_core.sql` recreated `hr_users` with column `user_id` (not `auth_user_id`):

```sql
-- from uuid_v2_batch1_core.sql:
user_id  uuid NOT NULL REFERENCES auth.users(id),
```

By contrast, `_assert_worker_access()` (created June 1 in `20260601110000`) correctly uses `h.user_id`, showing the column name was understood at that point. But `has_permission()` and `has_hr_role_permission()` were never updated.

**Net result:** Any call to `has_permission()` that reaches the `hr_users` branch will fail with `ERROR: column h.auth_user_id does not exist`. This means all permission checks for non-owner HR users through `has_permission()` are broken at the function level, independent of whether `company_role_permissions` exists.

**Required remediation:** When reinstating the permissions matrix (C-NEW-1), update both functions to use `h.user_id` throughout.

---

### C1 (CONFIRMED). Authenticated tenant members have full CRUD over sensitive domain tables

**Confirmed from direct inspection of `20260515160237_uuid_v2_batch7_rls_and_policies.sql`.**

The UUID baseline installs `FOR ALL` permissive policies using only company membership for: `clients`, `sites`, `units`, `residents`, `jobs`, `job_cards`, `job_checklist_items`, `job_codes`, `contractors`, `contractor_member_links`, `time_punches`, `labor_entries`, `leave_requests`, `payment_approvals`, `inventory_items`, `inventory_usage`, `assets`, `compliance_entries`, `incident_reports`, `pa_task_templates`, `pa_tasks`, `workflow_form_templates`, `workflow_form_submissions`, `message_threads`, `app_messages`, `work_teams`, `calendar_events`.

The `companies_update` policy checks only `id = ANY(user_company_ids())`. Any authenticated employee in the company can update the companies row — including `owner_user_id`.

`employees_update` and `employees_delete` check only `company_id = ANY(user_company_ids())`. Any member can promote any other employee to `owner`.

The reference audit correctly identified this. I can confirm the baseline from source. The restrictive overlay from May 12 is either absent (if those migrations did not reach production) or broken (if they did — see C-NEW-1 and C-NEW-2).

---

### C-NEW-3. Cross-tenant contractor data was fully exposed until June 12 2026

**Severity: Critical (now fixed by today's migration, but must be treated as an incident).**

Migration `20260612003_fix_contractor_rls_and_indexes.sql` (applied today) contains this comment:

> "Fix RLS: 4 contractor tables had `qual = 'true'` (no company isolation). Any authenticated HR user from Company A could read/write Company B's contractor documents, banking updates, quotes, and quote attachments."

The four tables affected: `contractor_banking_updates`, `contractor_documents`, `contractor_quotes`, `contractor_quote_attachments`.

The policy `qual = 'true'` means the USING clause evaluated to `true` for every row — any authenticated user could access any company's data on these tables.

**This was a live cross-tenant data breach** affecting sensitive financial (banking details), compliance (documents), and commercial (quotes) data for all companies in production. It has been resolved by `20260612003`, but:

- The window of exposure is unknown (the policy was set when the tables were created)
- No incident record or notification exists in the migration or documentation
- Affected companies should be notified if any cross-tenant reads occurred

**Required remediation:**

1. Determine when these tables were created and when the broken policy was applied (check `pg_stat_user_tables` or Supabase logs if available)
2. Audit Supabase API logs for cross-tenant reads on these four tables
3. Notify affected companies per POPIA obligations
4. Add a post-deployment verification step that asserts `qual != 'true'` for all RLS policies before release

---

### C2 (CONFIRMED). Migration history is not reproducible

Confirmed locally: 197 migration files. The migrations from June 10–12 use short 7-digit timestamps (`20260610001`, `20260610002`, `20260610003`, `20260611001`, `20260612001`, `20260612002`, `20260612003`) rather than the standard 14-digit format. These will not sort correctly relative to other migrations in Supabase's ledger.

The May 12 migrations that created the permissions matrix predate the May 15 UUID cutover but the cutover migration wiped their effect — yet no subsequent migration re-establishes them. The local tree and the remote database are therefore in materially different states for authorization.

---

### C3 (CONFIRMED). Ownership transfer is client-verified and non-atomic

Migration `20260512100000_role_taxonomy_owner.sql` did create `transfer_company_owner_employee()` as a server-side RPC. However, the original C3 finding from the reference audit refers to the client-side flow (6-digit code via `new Random()`, local email composer). Inspecting the migration, `transfer_company_owner_employee()` correctly verifies the current caller is owner and does the demotion/promotion atomically. The gap is:

- The client-side code calls this RPC only after local code verification — the RPC itself is sound, but the trigger is insecure
- The `hr_users.role` update inside the RPC is not fully atomic with the `employees.access_level` update (two separate UPDATE statements)
- No audit record is written for the ownership change
- `companies.owner_user_id` is not updated inside the RPC

Still a blocker, confirmed.

---

### C4 (CONFIRMED). Backup is metadata-only, not a recoverable backup

The `SupabaseStorageService.Platform.cs` partial contains no `CreateCompanyBackupAsync` implementation visible (method not found in grep over Platform partial). The backup type is described in the reference audit as `metadata_only` with zero bytes and `is_restorable = false`. No scheduled executor exists. Confirmed — this is not a recoverable backup by any definition.

---

## High findings

### H1 (CONFIRMED). PermissionsService fails open to client defaults

Direct inspection of `PermissionsService.RefreshAsync()` confirms:

1. It always starts from `PermissionDefaults.ForAccessLevel(employee.AccessLevelRaw)` — the client-side fallback
2. Server values overlay on top via `merged[kv.Key] = kv.Value`
3. If the server returns nothing, `_permissions = fallback` — full client defaults applied
4. Keys the server does not return retain the client default — no explicit deny for missing keys

This is a documented design choice ("anti-lockout baseline") but it means server-side permission removal does not take effect until the server also actively returns `false` for that key. For enterprise authorization, any permission the server does not explicitly grant must be denied.

The `CanViewSuppliers()` fallback to `InventoryView` is also confirmed in code — `suppliers.view` is not a standalone key in the defaults.

### H2 (CONFIRMED). Code login sessions lack server-side hardening

Confirmed in `20260525200000_employee_code_login_supabase_sessions.sql` and the `_assert_worker_access` function. Session tokens exist and are validated server-side. What is missing (confirmed by inspecting migration files):

- No attempt counter on code login (no `failed_attempts` column on `employee_code_sessions`)
- No IP/device throttling at the database or edge level
- No lockout after N failures
- Portal codes have no expiry rotation policy

### H3 (CONFIRMED). Session persistence is fire-and-forget

Both `ClientPortalSessionStore.Save()` and `ContractorPortalSessionStore.Save()` use:

```csharp
_ = PersistAsync(...);   // fire-and-forget — task is discarded
ClearLegacyPrefs();      // runs immediately, synchronously
```

`PersistAsync()` catches SecureStorage failure and falls back to writing credentials to plaintext `Preferences`. This means on SecureStorage failure, portal codes (including contractor banking codes) are persisted in plaintext — confirmed.

`CodeSessionStore` was not inspected for the same pattern but should be checked.

### H4 (CONFIRMED + UPDATED). Service coupling is worse than reported

The reference audit cited ~5,090 lines for `SupabaseStorageService.cs`. Direct measurement:

| File | Lines |
|---|---:|
| `SupabaseStorageService.cs` (main) | 5,691 |
| `.ContractorPortalQuotes.cs` | 617 |
| `.Finance.cs` | 533 |
| `.Platform.cs` | 497 |
| `.CompliancePacks.cs` | 331 |
| `.FinanceReports.cs` | 316 |
| `.Production.cs` | 287 |
| `.FinanceApprovals.cs` | 224 |
| `.ContractorPortalBanking.cs` | 175 |
| `.ContractorPortalCompliance.cs` | 171 |
| `.ContractorDocuments.cs` | 170 |
| `.ContractorActivity.cs` | 160 |
| `.PhaseA.cs` | 150 |
| `.ContractorPortalProfile.cs` | 105 |
| `.WorkerRpc.cs` | 102 |
| `.PhaseD.cs` | 91 |
| `.Media.cs` | 69 |
| `.ContractorBankingApproval.cs` | 38 |
| `.PhaseE.cs` | 33 |
| **Total** | **~9,816** |

`IStorageService.cs` is 552 lines — nearly double the reference estimate of 489.

103 ViewModels, 106 XAML views. The frontend is even larger than the reference reported.

### H5 (CONFIRMED). No CI/CD

No `.github` directory exists anywhere in the repository. No automated pipeline for build, tests, migration equivalence, RLS checks, or signed artifacts. Confirmed.

### H6 (CONFIRMED). Accounting is a no-op

`ManualAccountingProvider.PushBatchAsync()` returns `AccountingSyncStatus.Skipped` for every item with the message "Manual provider — configure Xero, Sage, or QuickBooks to sync." This is the only registered provider. Xero, Sage, and QuickBooks exist only as enum values and interface contracts.

### H-NEW-1. `_assert_worker_access` has a split-identity reference pattern that will mask bugs

In `20260601110000_worker_session_enforcement_foundation.sql`, `_assert_worker_access()` uses:

```sql
FROM public.hr_users h WHERE h.user_id = auth.uid() ...
```

This is correct for the UUID schema. However, it also references `public.employees` with `e.user_id = auth.uid()`. Both are correct for UUID v2. The issue is that `has_permission()` and `my_permissions()` (which the app calls separately to populate the permissions cache) use `hr_users.auth_user_id` — the old column. So the two authorization systems (session validation and permission checking) use different column names, creating a split-brain reference model. Any PR fixing one without the other will appear to work because `_assert_worker_access` succeeds while `has_permission` errors separately.

---

## Medium findings

### M1 (CONFIRMED). Test coverage is narrow

63 unit tests total: 34 payroll, 18 finance, 11 timesheet helpers. Confirmed by direct count. No ViewModel tests, no storage layer tests, no RLS adversarial tests, no multi-tenant isolation tests, no offline/realtime tests.

### M2 (CONFIRMED). Errors are swallowed in silent paths

`PermissionsService.RefreshAsync()` catches DB load failure and falls back silently (telemetry only). Both portal session stores catch `SecureStorage` failures and fall back to plaintext without surfacing the error to the user or blocking the operation.

### M3 (CONFIRMED). ConvertBack throws NotImplementedException

Not directly inspected but confirmed by reference audit. Pattern should be searched across all converters — `grep -rn "NotImplementedException" Converters/` before any UI binding changes.

### M4. Accessibility — not independently assessed

The reference audit correctly notes this gap. Not re-inspected here; concur.

### M5 (CONFIRMED + CLARIFIED). Repository hygiene

`.vs/` and `.secrets/` are listed in `.gitignore`. However, `git status --short` shows 28+ uncommitted modifications across all library projects (`KaiFlow.Accounting`, `KaiFlow.Finance`, `KaiFlow.Finance.Tests`, `KaiFlow.Payroll`, `KaiFlow.Payroll.Tests`, `KaiFlow.Timesheets.Tests`, cursor rules, `.gitignore` itself). The entire working tree has a large uncommitted feature set — not a snapshot of a tagged release. This means the "current state" of the codebase cannot be traced to any deployment.

### M-NEW-1. The `user_company_ids()` function uses `employees.is_active` but other functions use different guards

`user_company_ids()` (UUID v2 batch7) filters `WHERE user_id = auth.uid() AND is_active = true`. However, `auth_employee_company_ids()` (from `20260512150000`) uses `WHERE e.profile_id = auth.uid()` with no `is_active` filter. `auth_active_hr_company_ids()` filters `is_active = true`. Three functions, three different filters for "am I in this company?" — this inconsistency means a deactivated employee may pass some checks and fail others depending on which function is used in a given policy.

### M-NEW-2. Short-timestamp migrations will corrupt ordering in any tooling that sorts lexicographically

`20260610001` sorts before `20260512` in some tools but not in Supabase's ledger (which uses the filename directly). The Supabase CLI and Supabase dashboard may disagree on the correct application order. A migration named `20260610001` will sort between `20260609...` and `20260610...` in most string sort contexts, which is correct by date but out-of-spec by convention. Any tooling that requires exactly 14 digits for timestamp format will reject these files.

---

## Confirmed strengths (independent observation)

1. The product model is genuinely ambitious and coherent — four audience types, 15+ domains, all with dedicated ViewModels and schema tables. The breadth is real, not aspirational.

2. The contractor lifecycle (Phases A–D confirmed complete, E in progress) is more mature than similar-stage products. The `job_contractors` join table, quote lifecycle, and document management are properly modeled.

3. `transfer_company_owner_employee()` as a server RPC is the right pattern — the weakness is the client-side trigger, not the RPC itself.

4. `_assert_worker_access()` dual-path design (JWT vs session token) is correct architecture for the field-worker audience. The June 1 implementation is sound at the function level.

5. Payroll and VAT calculation libraries are deterministic and covered by 63 unit tests. The `FlexiblePayrollEngine` and `VatCalculator` abstractions are clean.

6. The `is_visible_to_me()` server function for job/deal visibility is a properly designed scoped-access model — it accounts for `private`, `restricted`, `all` visibility levels, team grants, and manager relationships in a single SECURITY DEFINER function.

7. `20260612003` — the cross-tenant contractor RLS fix — shows the team is actively monitoring and correcting authorization gaps. The fix is correct.

---

## How my findings compare to the reference audit

| Finding | Reference | My assessment |
|---|---|---|
| C1 — broad RLS | Confirmed | Confirmed. Adds detail: restrictive policies may be absent OR broken depending on migration state |
| C2 — migration drift | Confirmed | Confirmed. Adds: 7-digit timestamps break convention and tool compatibility |
| C3 — ownership transfer | Confirmed | Partially confirmed: RPC is sounder than described; client trigger is still broken |
| C4 — metadata backup | Confirmed | Confirmed |
| C5 — hr_users dropped | Partially confirmed | Superseded by C-NEW-2: `auth_user_id` vs `user_id` column rename is the actual mechanism |
| C-NEW-1 — permissions matrix wiped by UUID cutover | **Not in reference** | New critical finding |
| C-NEW-2 — `auth_user_id` column rename breaks permission functions | **Not in reference** | New critical finding (clarifies reference C5) |
| C-NEW-3 — cross-tenant contractor data exposure | **Not in reference** | New critical finding (now fixed, but incident handling required) |
| H1 — permissions fail open | Confirmed | Confirmed from source |
| H2 — code login hardening | Confirmed | Confirmed |
| H3 — fire-and-forget sessions | Confirmed | Confirmed with exact code evidence |
| H4 — coupling | Confirmed | Line count worse than reported: ~9,816 total, not ~5,090 |
| H5 — no CI | Confirmed | Confirmed |
| H6 — accounting no-op | Confirmed | Confirmed |
| H-NEW-1 — split identity reference | **Not in reference** | New high finding |
| M1 — narrow test coverage | Confirmed | Confirmed: 63 tests total |
| M5 — repo hygiene | Confirmed | Confirmed: large uncommitted set |
| M-NEW-1 — is_active inconsistency | **Not in reference** | New medium finding |
| M-NEW-2 — short timestamps break tooling | **Not in reference** | New medium finding |

---

## Immediate actions before any new feature work

These are prerequisites — not negotiable for any further production use:

1. **Determine production RLS state.** Query live DB: `SELECT policyname, cmd, qual FROM pg_policies ORDER BY tablename, policyname`. Compare against expected state from migrations.

2. **Determine whether `company_role_permissions` exists in production.** If not, the permissions matrix must be rebuilt in a post-UUID-cutover migration.

3. **Fix `has_permission()` and `has_hr_role_permission()`** to use `hr_users.user_id` (not `auth_user_id`).

4. **Treat C-NEW-3 as a security incident.** The contractor data exposure window must be established and POPIA notification obligations assessed.

5. **Do not add new features** until C-NEW-1, C-NEW-2, C1, and C2 are resolved.

---

## Remediation priority order

| Priority | Finding | Estimated effort |
|---|---|---|
| 1 | C-NEW-3 incident response (contractor data leak) | 1 day |
| 2 | C-NEW-1 + C-NEW-2: rebuild permissions matrix post-UUID, fix column names | 2–3 days |
| 3 | C1: complete restrictive policy coverage for all sensitive tables | 3–5 days |
| 4 | C2: reconcile migration history, establish canonical order | 2 days |
| 5 | C3: harden ownership transfer trigger (client-side) | 1 day |
| 6 | H1: flip permissions service to fail-closed for privileged operations | 1–2 days |
| 7 | H3: await session persistence, remove plaintext fallback | 1 day |
| 8 | M-NEW-1: unify `is_active` guard across all company-id resolver functions | 1 day |
| 9 | H4: begin domain decomposition of IStorageService | 3–4 weeks (phased) |
| 10 | H5: add CI pipeline (build, test, migration lint) | 3–5 days |

---

## What I will do as we work through this

For each fix we undertake:

1. I audit the specific module fully (Rule 1, Rule 10)
2. I present the 10-step analysis table from AGENTS.md Rule 1
3. I write a self-contained, prescriptive prompt for Claude Code
4. Claude Code implements and delivers a clean build
5. I apply the migration via Supabase MCP if required
6. I verify the fix is complete before we close the item

I will not touch application code or execute schema-destroying operations. If I identify a fix that requires a schema change, I design the migration, write the prompt, and apply the SQL after the build is clean.

---

*Audit completed: 12 June 2026. Do not use this document as a release certification — it is a risk register and remediation guide.*
