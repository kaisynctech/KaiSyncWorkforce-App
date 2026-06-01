# 11 — Enterprise Roadmap

A prioritized plan derived from the architecture audit. Ordering follows the platform's stated **enterprise implementation priority**: (1) preserve working functionality, (2) eliminate instability, (3) complete missing parity, (4) complete module visibility/navigation, (5) expand reporting, (6) expand property management, (7) improve UX incrementally.

## Stabilization priorities (do first — eliminate instability)

| Priority | Action | Refs |
|----------|--------|------|
| P0 | **Fix inventory `stock_count` → `quantity_on_hand`** in `employee_set_inventory_usage_for_job`; make HR allocation transactional. | C1, M9 |
| P0 | **Resolve permissions drift:** recreate `company_role_permissions`/`my_permissions` for the uuid schema, or formally adopt `PermissionDefaults` + server RLS as the single model and remove stale `has_permission` references. | C2 |
| P0 | **Add punch idempotency keys** + reconcile optimistic local state so offline replay can't duplicate. | H1 |
| P1 | **Harden code-login/portal security:** bind worker RPCs to the session token (or add per-call validation), add rate limiting to resolve RPCs. | C3 |
| P1 | **Fix backdated clock-in absence check** (use punch `date_time`, not `current_date`). | H2 |
| P1 | **Add realtime reconnect/backoff** + consistent MainThread marshaling; replace `async void` handlers. | H3 |
| P1 | **Reconcile legacy schema references** (`hr_users`, dual messaging lineage). | H5 |

## Scalability priorities

| Action | Refs |
|--------|------|
| **Decompose `SupabaseStorageService`** into per-domain repositories behind `IStorageService`; standardize on one JSON library; stop silently swallowing RPC parse errors. | M1 |
| **Add structured retry/queue for telemetry** (or accept best-effort explicitly) and add sampling/rate limiting to protect `app_events`. | M5 |
| **Bound the geocode cache**; centralize `HttpClient` usage. | L2 |
| **Introduce a real multi-environment config pipeline** (dev/staging/prod via env at build). | L1 |

## Enterprise hardening priorities

| Action | Refs |
|--------|------|
| Token-bound worker/portal RPCs; rotate-able portal codes; optional server-side portal sessions. | C3 |
| Audit trails for sensitive mutations beyond payroll (inventory adjustments, permission changes). | M1 |
| Consolidate session/restore logic; single Supabase init path. | M8 |
| Per-module telemetry coverage + dashboards for error monitoring. | M5 |

## Parity completion

| Action | Refs |
|--------|------|
| Backfill all `created_by_employee_id` so the My-Jobs (Created) tab is reliable. | `modules/jobs.md` |
| Wire `employee_append_incident_photos` (post-submit photo add). | L6 |
| Messaging: realtime subscription, read receipts, attachment UI; fix `HrSimpleThreadChatViewModel` code-login path. | M2 |
| Complete contractor member-invite linking. | M7 |
| Seed `suppliers.edit` in `PermissionDefaults`/DB. | M6 |

## Module visibility / navigation (largely complete)

Suppliers, Leave, and My PA are now first-class HR sidebar modules; employee More-menu carries the relevant employee-facing modules. Remaining:
- Confirm every approved module has both nav identity **and** a permission gate (audit `RefreshModuleNavigation`).
- Keep employee surface to **relevant** modules only (no admin domains).

## Reporting expansion (high priority)

Target: a **centralized, enterprise-grade Reports module** (see `reporting/01-reporting-and-telemetry.md`).

| Step | Detail |
|------|--------|
| 1 | Cross-domain aggregation (attendance, payroll, jobs, incidents, leave, inventory, contractors, properties). |
| 2 | **Native MAUI charts (no Python)** — KPI tiles + trend/bar/distribution via a MAUI charting control or `GraphicsView`. |
| 3 | Filters: date range, branch, team, employee, module, status. |
| 4 | Export every report to PDF (QuestPDF) + Excel (ClosedXML); keep payroll/IRP5/bank formatters. |
| 5 | Consume the **existing-but-unused Supabase reporting views**; add telemetry-backed adoption/error reports from `app_events`. |
| 6 | Fix the misleading date filters on jobs/payments/incidents/inventory exports; add inventory usage history. |

## Property management expansion

| Step | Detail |
|------|--------|
| 1 | Fix `HrResidentsViewModel` `siteId` query-param binding (functional bug). |
| 2 | Unit↔resident linking (set `unit_id` on create); delete flows. |
| 3 | Compliance CRUD + certificate document upload + expiry alerts. |
| 4 | Inspection scheduling tied to `PaTask`/jobs/incidents; per-unit reporting. |
| 5 | Property maps / geofencing (reuse `BranchGeofenceService` patterns). |

## Telemetry expansion

- Guaranteed-or-sampled delivery; wire `LogPageView`; per-module event taxonomy; surface `app_events`-backed dashboards in Reports.

## Testing strategy

| Layer | Approach |
|-------|----------|
| **Payroll** | Unit tests around `KaiFlow.Payroll` (pure, deterministic) — the highest-value test target. Lock down PAYE/UIF/pro-rating/penalty/leave cases before any engine change. |
| **Storage** | Per-domain repositories (post-decomposition) become mockable; contract tests against RPC shapes. |
| **RPC/DB** | Expand the existing migration smoke-test pattern (`*_smoke_test.sql`) into a CI suite; assert single function signatures (PGRST203 guard). |
| **Offline/realtime** | Simulated connectivity loss/replay; duplicate-prevention tests. |

## Deployment & update strategy

- **Windows-first** desktop deployment (`win-x64`, unpackaged); mobile (Android/iOS) share code.
- Keep the **snapshot + ROLLBACK.md** discipline for sensitive migrations (payroll, RPC parity).
- `AppUpdateService` reads `config/app-version.json` from Storage — consider a hard-block tier for breaking backend changes, and robust semver parsing.

## Update/migration discipline (standing rules)

1. Forward-only schema; never depend on dropped bigint tables.
2. No bigint RPC overloads beside uuid functions.
3. Company-scope + RLS every new table; `GRANT EXECUTE … TO anon` + `_employee_valid` for worker/portal RPCs.
4. Pair payroll/punch changes with tests and a rollback note.
5. Preserve documented compatibility shims until their counterparts catch up.

---

_This roadmap should be revisited as items close. The risk register (`roadmap/01-risks-and-technical-debt.md`) is the companion tracking list._
