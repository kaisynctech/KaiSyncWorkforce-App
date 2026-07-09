# KaiSync Workforce Enterprise Full-System Audit

**Audit date:** 12 June 2026  
**Scope:** MAUI client, product workflows, payroll, finance, accounting, Supabase schema and migrations, RLS, RPCs, storage, deployment, website, testing, and operations  
**Assessment basis:** Current working tree plus the linked Supabase migration ledger

## Executive verdict

KaiSync Workforce is a broad, serious product with strong domain coverage and a substantial amount of working implementation. Its payroll and finance calculation cores are deterministic and tested, the MAUI application has clear audience-specific workflows, and recent contractor lifecycle work is materially stronger than the older platform baseline.

It is **not enterprise-ready for unrestricted production deployment**.

The principal blocker is authorization. The post-UUID RLS baseline treats company membership as full administrative authority. Any authenticated member of a company can update or delete core company data through PostgREST, regardless of the role and permission checks shown in the client. This includes company settings, employee roles, payroll approvals, jobs, inventory, and other tenant records. An authenticated employee can therefore bypass the UI and directly exercise privileges intended for owners or HR.

The second blocker is database reproducibility. The live migration ledger and repository migration directory have diverged in both directions. Production contains migrations that are absent locally, while multiple local June migrations are not recorded remotely. The repository is therefore not a complete, reproducible source of truth for the live database.

**Overall enterprise readiness: 48/100**

| Area | Score | Verdict |
|---|---:|---|
| Product/domain coverage | 82 | Broad and coherent |
| Frontend architecture and UX | 61 | Functional, but oversized and difficult to verify |
| Backend/data access | 52 | Capable, highly coupled |
| Authentication | 58 | Multiple working paths; portal and fallback risks remain |
| Authorization/tenant isolation | 20 | Critical role-escalation exposure |
| Database engineering | 43 | Rich schema, irreproducible migration state |
| Payroll/finance correctness | 78 | Good deterministic cores and tests |
| Reliability/offline/realtime | 64 | Good foundations, incomplete operational proof |
| Testing/quality gates | 38 | Unit tests pass; no meaningful integration/E2E/CI gate |
| Operations/DR/compliance | 31 | Metadata backups are not backups; weak release governance |

## What the application is intended to do

KaiSync Workforce is a multi-tenant workforce and operations platform for four audiences:

1. Owners, HR, admins, and managers authenticate with Supabase JWT and use the management dashboard.
2. Field employees use company/employee codes or email/password and access attendance, jobs, leave, incidents, messaging, documents, payslips, forms, and My PA.
3. Contractors use a code-based portal for profile, banking, compliance, quotes, assigned jobs, site visits, incidents, photos, messages, invoices, and payouts.
4. Clients use a code-based portal for projects, documents, payments, progress, and messaging.

The main domains are attendance, employees, scheduling, leave, jobs, projects/CRM, incidents, inventory, suppliers, contractors, payroll, finance, property management, messaging, notifications, My PA, reports, SaaS administration, and operational release management.

The architecture is a .NET 10 MAUI application backed by Supabase PostgreSQL, Auth, Storage, and Realtime. Payroll, finance, and accounting abstractions are separate class libraries. The website is a static Vercel-hosted marketing/download site.

## Critical findings

### C1. Authenticated tenant members have full CRUD over sensitive domain tables

The UUID RLS baseline permits any authenticated user whose company appears in `user_company_ids()` to update the company and any employee row in that company. It also defines `FOR ALL` policies for core domain tables.

Evidence:

- `companies_update` checks only company membership.
- `employees_update` and `employees_delete` check only company membership.
- `company_relationships_update` checks only company membership.
- Core tables such as `jobs`, `time_punches`, `payment_approvals`, `inventory_items`, and `leave_requests` use full CRUD membership policies.

Impact:

- A normal authenticated employee can promote themselves or another employee to `owner`.
- A member can change `companies.owner_user_id`.
- A member can alter or delete payroll, attendance, employee, job, inventory, and leave data using direct PostgREST calls.
- Client-side `PermissionsService` checks do not protect the database.

Required remediation:

1. Freeze broad authenticated writes.
2. Replace table-wide membership policies with operation-specific policies.
3. Restrict sensitive writes to audited SECURITY DEFINER RPCs that verify role and permission server-side.
4. Make own-profile writes column-safe through RPCs; do not allow unrestricted employee-row updates.
5. Add adversarial authorization tests for every role and table.

### C2. Database migration history is not reproducible

`supabase migration list` shows bidirectional drift:

- Local migrations such as `20260605000000`, `20260608100000`, `20260608110000`, and the contractor migrations `20260610001` through `20260612003` are not represented by matching remote versions.
- Production includes numerous June 8-12 migration versions that have no local file.

Impact:

- A clean environment cannot be proven to reproduce production.
- Rollback and disaster recovery are unreliable.
- Security fixes cannot be confidently shown as deployed merely because a similarly described change exists locally.
- Migration ordering is ambiguous because several local versions use short, nonstandard timestamps.

Required remediation:

1. Export the live schema, policies, grants, functions, triggers, and migration ledger.
2. Reconcile every remote-only and local-only migration.
3. Establish one canonical forward-only history with 14-digit unique timestamps.
4. Rebuild an empty staging database from migrations and compare schema fingerprints.
5. Block release when local/remote migration equivalence fails.

### C3. Ownership transfer is client-verified, non-atomic, and authorization-incomplete

The UI generates a six-digit code with `new Random()`, opens the local email composer, and displays the code in-app if email composition is unavailable. The code is never created, sent, expired, or verified by the server.

After local verification, the storage service directly updates `companies.owner_user_id` and the target employee's access level in separate requests. It does not atomically demote the prior owner or update company relationships.

Impact:

- The confirmation step provides no security boundary.
- Partial failure can leave multiple owners or inconsistent ownership records.
- The broad RLS finding makes direct ownership mutation especially dangerous.

Required remediation:

- Replace the entire flow with one server transaction.
- Require recent authentication or server-issued OTP/MFA.
- Verify current owner, target membership, and target authenticated user server-side.
- Update company owner, employee roles, relationships, and audit log atomically.

### C4. Production backups are metadata records, not recoverable backups

`CreateCompanyBackupAsync` counts only employees and branches, records a `.meta.json` path that is never written, sets size to zero, labels the type `metadata_only`, and marks the record non-restorable. Scheduled backup jobs are inserted but no executor is present.

Impact:

- The in-app backup feature cannot recover tenant data.
- A successful status can create false operational confidence.
- Tenant-level restore objectives are undefined and untested.

Required remediation:

- Rename the current feature to "snapshot metadata" immediately.
- Implement actual encrypted exports or rely explicitly on tested Supabase PITR/project backups.
- Define RPO/RTO, retention, restore ownership, and quarterly restore drills.
- Do not show "completed backup" for a metadata-only record.

### C5. Repository authorization foundations still reference dropped schema

`hr_users` and `company_role_permissions` were dropped in the UUID cutover. The worker authorization foundation still queries `hr_users`, and no post-cutover migration recreates `company_role_permissions`.

Impact:

- JWT calls through `_assert_worker_access` can fail or behave differently from the documented model.
- Server permission functions and client permissions can drift.
- The repository cannot demonstrate one coherent role authority.

Required remediation:

- Standardize identity and roles on `company_relationships` plus `employees`.
- Recreate a UUID permission model or enforce a smaller fixed role matrix in server functions.
- Remove all active references to dropped tables and test function compilation on a clean database.

## High findings

### H1. Permissions fail open to client defaults

When server permissions are unavailable or empty, `PermissionsService` grants role defaults. Missing server keys retain client defaults during merge. This is described as anti-lockout behavior, but enterprise authorization must fail closed for privileged actions.

The defaults also omit `suppliers.view` and `suppliers.edit`; supplier visibility currently relies on the inventory fallback.

### H2. Code login is appropriate, but identity proof and sessions need hardening

Code-based employee login is an appropriate product decision for the target workforce. Many field workers may not have an email address, may not know their email credentials, or may find conventional email/password onboarding unnecessarily difficult. Enterprise readiness does **not** require replacing this accessible login path with email authentication.

The intended employee experience should remain simple:

1. First login uses company code plus employee number or ID number.
2. The worker creates a simple personal PIN.
3. Future login uses company code plus employee code/PIN.
4. The server issues a revocable, expiring employee session token.
5. A trusted device may retain the session so the worker does not repeatedly authenticate.
6. HR can revoke devices and reset the worker's PIN.

Email/password login may remain available for workers who want it, but both login methods should produce the same **employee-level capabilities**. Authentication method must not determine business permissions.

An ID number should not remain the worker's permanent password because it is difficult to rotate and may be known by employers or exposed in documents. It is suitable as part of initial identity verification when combined with company context, rate limiting, and a subsequent PIN-enrolment step.

Client and contractor portals may also retain code-based access, but the reviewed migrations show no attempt counter, lockout, IP/device throttling, code rotation policy, or server-side contractor/client session.

SecureStorage protects codes at rest when available, but failures currently fall back to plaintext MAUI Preferences.

Required controls include PIN hashing, high-entropy rotatable portal codes, rate limiting at the edge, server-side sessions, expiry/revocation, device/session audit events, and optional step-up verification for banking, payout, or sensitive profile changes.

### H3. Session persistence is fire-and-forget and can race navigation

All three code/portal session stores call `PersistAsync` without awaiting it and immediately clear legacy preferences. A fast app termination or immediate restore can lose the newly established session. On SecureStorage failure, credentials and session tokens are written to Preferences.

Make save operations asynchronous and awaited before routing. Do not persist secrets in plaintext as a silent fallback.

### H4. Core data access is excessively coupled

`SupabaseStorageService.cs` is approximately 5,090 lines before its many partial files. `IStorageService` is approximately 489 lines. The main HR and contractor portal screens and ViewModels are also exceptionally large.

This makes authorization routing, error handling, RPC contracts, and regression testing difficult. Split by bounded domain behind smaller interfaces and introduce contract tests.

### H5. No CI quality or security gate

There is no `.github` workflow directory or equivalent repository CI definition. No automated gate was found for:

- build and unit tests,
- migration equivalence,
- database lint,
- RLS authorization tests,
- dependency vulnerability checks,
- secret scanning,
- XAML/UI smoke tests,
- signed release artifacts.

### H6. Accounting integration is a foundation, not production synchronization

Only `ManualAccountingProvider` is registered. The retry queue and audit log are in-memory and capped, so they are lost on restart. Xero, Sage, and QuickBooks are enum values and contracts, not operational integrations.

### H7. The application build is not currently proven by this audit

The three test projects passed, but the Windows MAUI build did not complete within the audit timeout. The initial sandboxed attempt was blocked by Windows SDK path permissions; the elevated build remained long-running beyond three minutes.

Release readiness should require a clean, reproducible Release build on a controlled agent.

## Medium findings

### M1. Test coverage is concentrated in pure calculations and helpers

Passing tests:

- Payroll: 34
- Finance: 20
- Timesheet helpers: 12

Missing coverage includes ViewModels, storage methods, RPC payload compatibility, RLS, migrations, auth restore, offline replay, realtime reconnection, portal flows, exports, ownership transfer, and database transactions.

### M2. Secure and operational errors are frequently swallowed

Empty catches exist in storage initialization, location, exports, leave, and reverse-geocoding update paths. Several failures become empty lists or nulls, making data absence indistinguishable from infrastructure failure.

### M3. Converter `ConvertBack` paths throw `NotImplementedException`

Several XAML converters throw when used in reverse binding. This is acceptable only when every binding is permanently OneWay. A future TwoWay binding would cause a runtime failure.

### M4. Accessibility is not governed as a release requirement

The UI has many explicit sizes and controls, but no demonstrated automated accessibility checks, keyboard navigation suite, screen-reader acceptance criteria, contrast audit, or reduced-motion/text-scaling verification.

### M5. Repository hygiene is weak

Visual Studio `.vs` cache artifacts are tracked and actively changing. The working tree contains a very large uncommitted feature set. Generated IDE state obscures meaningful review and increases accidental commit risk.

### M6. Release and readiness documentation overstates the current state

Existing reports call infrastructure and modules launch-ready while also acknowledging metadata-only backups, missing payment automation, unsigned/manual distribution, and incomplete smoke-test sign-off. Those documents should be treated as planning records, not current certification.

## Strengths

1. The product model is coherent and unusually broad for its stage.
2. Audience-specific navigation is clearer than a single overloaded interface.
3. Payroll and VAT calculations are deterministic and have useful unit coverage.
4. Offline punch idempotency and realtime reconnect work show good reliability instincts.
5. Contractor lifecycle modeling includes compliance, banking approvals, quotes, assignments, invoices, and payouts.
6. Company scoping is consistently present in the data model, even though role enforcement within a tenant is insufficient.
7. Recent storage hardening and worker token-binding work move in the right direction.
8. Documentation captures many architectural decisions and known risks.

## Enterprise target architecture

The application should retain MAUI and Supabase, but enforce these boundaries:

1. **Identity:** Accessible code/PIN login for field workers, Supabase Auth where appropriate, and revocable server sessions for employee, contractor, and client code-login paths.
2. **Authorization:** server-owned RBAC/ABAC with role and permission checks on every sensitive operation.
3. **Data access:** direct table reads only where policies are narrow; sensitive writes through audited RPCs.
4. **Domain services:** separate repositories/services for identity, workforce, attendance, jobs, contractors, payroll, finance, documents, reporting, and platform administration.
5. **Audit:** immutable actor/action/before/after records for role, payroll, banking, inventory, ownership, and finance changes.
6. **Operations:** reproducible migrations, staging parity, CI/CD, signed artifacts, PITR, restore drills, monitoring, and SLOs.

## Remediation roadmap

### Phase 0: Immediate release freeze

- Do not onboard unrestricted production tenants until C1 and C2 are resolved.
- Preserve employee code login, but disable or restrict any employee JWT path that exposes broad authenticated RLS until authorization is repaired.
- Disable ownership transfer.
- Rename or hide metadata-only backup actions.
- Capture a verified production schema and grants snapshot.

### Phase 1: Authorization repair

- Build a complete table/operation/role matrix.
- Replace membership-wide write policies.
- Add server permission helpers with UUID schema.
- Move privileged mutations to transactional RPCs.
- Ensure code/PIN and email login produce equivalent employee permissions through the same server authorization rules.
- Add tests proving employee, manager, admin, owner, contractor, client, anon, and service-role boundaries.

### Phase 2: Database reconciliation

- Reconcile migration history.
- Rebuild staging from zero.
- Run Supabase lint with an authenticated CLI session.
- Add schema and function signature snapshots to CI.
- Eliminate active references to dropped objects.

### Phase 3: Reliability and modularity

- Split `IStorageService` and `SupabaseStorageService`.
- Standardize JSON parsing and error contracts.
- Await session persistence.
- Add durable telemetry and accounting queues.
- Add integration tests for offline replay and realtime reconnect.

### Phase 4: Enterprise operations

- Implement tested backups/PITR and restore drills.
- Add CI/CD and signed release artifacts.
- Add dependency, secret, and SAST scanning.
- Define SLOs, incident response, audit retention, data retention, and privacy controls.
- Validate POPIA/GDPR handling for identity, banking, payroll, geolocation, and employee documents.

### Phase 5: Product maturity

- Complete accounting providers and durable reconciliation.
- Expand reporting using server-side aggregates.
- Complete accessibility and keyboard/screen-reader acceptance.
- Add end-to-end tests for the four audience journeys.

## Verification performed

- Read architecture, module, security, backend, deployment, and roadmap documentation.
- Inspected MAUI composition, services, ViewModels, XAML, calculation libraries, session stores, and migrations.
- Compared local and linked Supabase migration ledgers.
- Ran all existing unit tests: **66 passed, 0 failed**.
- Attempted the Windows MAUI build; result was inconclusive due SDK sandbox access followed by timeout.
- Attempted linked Supabase database lint; it could not run because the CLI lacked an access token.

## Final recommendation

Treat the current system as a strong pilot-stage product with enterprise ambitions, not as an enterprise-certified platform. The accessible company-code and PIN approach should be preserved because it fits the field-worker audience. The required change is server-enforced authorization, not forcing workers to adopt email. Fix authorization and database reproducibility first; adding more modules before those controls are resolved would increase risk and remediation cost.
