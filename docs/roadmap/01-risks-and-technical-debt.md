# 10 — Known Risks & Technical Debt

This is a candid, code-grounded register. Severity reflects production impact, not effort. Items are cross-referenced to the relevant doc.

## Critical

| # | Risk | Where | Detail |
|---|------|-------|--------|
| C1 | **Inventory worker-path stock bug** | `modules/inventory.md`, `backend/02-rpcs.md` | `employee_set_inventory_usage_for_job` references `stock_count`; the column is `quantity_on_hand`. Worker-side stock deduction likely fails. HR manual path masks it. **✅ Fixed** in `20260529230000_inventory_usage_stock_fix.sql` (column corrected + `FOR UPDATE` row locking; new atomic `hr_allocate_inventory_to_job` for the HR path). |
| C2 | **Permissions drift (server vs client)** | `security/02-permissions-and-rls.md`, `backend/01-database.md` | `company_role_permissions` was CASCADE-dropped in the uuid cutover and not recreated. `my_permissions`/`has_permission` may be absent; the app falls back to client-side `PermissionDefaults`. UI gating and DB RLS can disagree. **◑ Mitigated** in `PermissionsService.RefreshAsync`: fallback-baseline + server-overlay merge (no lockouts on missing keys) with `permissions_drift_detected` / `permissions_fallback_used` telemetry to drive server-side reconciliation. Fallback retained by design. |
| C3 | **Worker RPCs trust client-supplied IDs** | `security/01-authentication.md` | The code-login `session_token` is used only for refresh/revoke. Worker RPCs validate `(company_id, employee_id)` by existence, not by token. With the publishable anon key, knowledge of valid UUIDs is enough to call worker RPCs. No visible rate limiting on portal/worker resolve RPCs. **◑ Mitigated** in `20260529250000_worker_session_validation.sql`: `_employee_session_is_valid` token-binding primitive + `employee_validate_session` gate with rate-limit-friendly `worker_session_audit`; client binds the token on session restore (`worker_session_invalid` telemetry). Per-RPC adoption can follow incrementally. |

## High

| # | Risk | Where | Detail |
|---|------|-------|--------|
| H1 | **Offline punch duplication** | `architecture/04-offline-and-realtime.md`, `modules/attendance.md` | No idempotency key on queued punches. A punch that succeeds server-side but appears to fail can be replayed → duplicate. Optimistic `SetLastPunch` can briefly diverge from server truth. **✅ Fixed** in `20260529240000_punch_idempotency.sql`: `time_punches.idempotency_key` + partial unique index; `employee_insert_punch` returns the existing row on replay; client stamps the key before the first attempt so it survives the offline queue. |
| H2 | **Backdated clock-in bypasses absence block** | `modules/attendance.md` | Server block uses `current_date`, not the punch `date_time`. |
| H3 | **No realtime reconnect/backoff** | `architecture/04-offline-and-realtime.md` | If the websocket drops mid-session, recovery relies on the next `StateChanged` or app foreground. Handlers run on the socket thread with inconsistent MainThread marshaling; some are `async void`. **✅ Fixed** in `RealtimeService`: cancellation-token reconnect supervisor with exponential backoff + jitter, connectivity-restored trigger, desired-vs-live state tracking, consistent MainThread event marshaling, and `realtime_reconnect_attempt`/`_success`/`_failed` telemetry. |
| H4 | **Duplicate punch implementations** | `modules/attendance.md` | Dashboard inline clock vs `PunchPage` — logic can drift. |
| H5 | **Legacy schema references survive** | `backend/01-database.md` | Policies/RPCs still reference dropped `hr_users`; messaging has dual lineage (`app_message_threads` vs `message_threads`). Reconcile against `company_relationships` + `employees.access_level`. |

## Medium

| # | Risk | Where | Detail |
|---|------|-------|--------|
| M1 | **`SupabaseStorageService` is a ~5,500-line monolith** | `architecture/02-tech-stack.md` | High coupling; mixed System.Text.Json + Newtonsoft parsers; RPC parse failures often return empty lists silently (`catch { return []; }`), hiding errors. Hard to unit-test per domain. |
| M2 | **Messaging has no realtime/read-receipts/attachments UI** | `modules/messaging.md` | Pull-only; stale lists; `HrSimpleThreadChatViewModel` may break under code-login-only sessions. |
| M3 | **Property Management is early-stage** | `modules/property-management.md` | `HrResidentsViewModel` ignores the `siteId` query param (functional gap); no deletes; compliance read-only. |
| M4 | **Reports is a CSV placeholder** | `modules/reports.md`, `reporting/01-...md` | Date filters inconsistent; inventory report omits usage; Supabase reporting views unused; no charts. |
| M5 | **Telemetry is fire-and-forget** | `reporting/01-...md` | `_ = PersistAsync(...)`; events lost on app kill; no sampling/rate limiting → `app_events` could flood on RPC error storms. `LogPageView` defined but unused. |
| M6 | **Suppliers conflated with contractors** | `modules/suppliers.md` | Shared table/permissions; `suppliers.edit` not seeded in `PermissionDefaults`. |
| M7 | **Contractor member invite incomplete** | `modules/contractors.md` | OTP sent but member not auto-linked. |
| M8 | **Multiple session types + complex restore chain** | `security/01-authentication.md` | JWT (Preferences+SecureStorage) + three Preferences-based code/portal stores; dual Supabase init (App + IdEntry) guarded by `InitGate`. |
| M9 | **Inventory HR allocation non-transactional** | `modules/inventory.md` | Usage insert + manual `QuantityOnHand` decrement can diverge on partial failure. **✅ Fixed**: HR allocation now routes through the atomic, row-locked `hr_allocate_inventory_to_job` RPC (`20260529230000`) via `AllocateInventoryToJobAsync` — single transaction, no manual decrement. |

## Low

| # | Risk | Where | Detail |
|---|------|-------|--------|
| L1 | **Config not multi-env** | `architecture/02-tech-stack.md` | Anon key committed in `SupabaseConfig.cs`; env override exists but no real multi-env pipeline. |
| L2 | **Location cache unbounded** | infra audit | Static `HttpClient` + static geocode memory cache grows over long sessions; Geoapify dependency. |
| L3 | **App update is soft** | infra audit | "Later" allowed; non-semver version strings can throw (caught silently). |
| L4 | **Settings stubs** | `modules/settings.md` | No branding upload (despite `LogoUrl`); plan upgrade stub; ownership transfer uses local code + email, not verified OTP. |
| L5 | **Leave balances client-computed** | `modules/leave.md` | Static `LeavePolicy` defaults can drift from company entitlements; leave-type string vs CHECK-constraint drift. |
| L6 | **Unused incident photo-append RPC** | `modules/incidents.md` | `employee_append_incident_photos` defined but not wired. |

## Temporary compatibility logic (intentional shims)

- **Suppliers ↔ inventory** module fallback; **Property Management ↔ legacy `properties`**; **Incidents ↔ `paperless`**.
- **`inventory.view` as `suppliers.view` fallback** in `CanViewSuppliers`.
- **Company-code numeric equality shim** (`"28"` ↔ `"0028"`) in `employee_resolve_by_code`.
- **JWT expiry sign-out before anon RPCs** (PGRST303 mitigation).
- **PGRST203 overload drops** across several migrations.

These are deliberate and should be retained until their migration/seed counterparts catch up — removing them prematurely would break existing tenants.

## Cross-cutting hardening themes

1. **Payroll is financially sensitive and order-dependent** — never refactor `PayrollCalculator` without calculation tests.
2. **Never reintroduce bigint RPC overloads** (PGRST203).
3. **Preserve anon RPC grants + `_employee_valid` scoping** on any new worker/portal RPC.
4. **Company-scope every new table** with RLS.

See `roadmap/02-enterprise-roadmap.md` for the prioritized remediation plan.
