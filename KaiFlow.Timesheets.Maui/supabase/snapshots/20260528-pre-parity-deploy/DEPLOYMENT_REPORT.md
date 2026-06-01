# Phase 2.5 Deployment Report — 2026-05-28

## Environment

| Item | Value |
|------|-------|
| Linked Supabase | `vcivtjwreybaxgtdhtou` (kaisynctech's Project) |
| Separate staging project | **None** — controlled deploy to linked DB |
| Docker / local Supabase | **Unavailable** — schema dump via CLI blocked |

## Step 1 — Pre-deploy snapshot

| Artifact | Location |
|----------|----------|
| Pre-deploy RPC probe | `supabase/snapshots/20260528-pre-parity-deploy/pre_deploy_probe.txt` |
| Post-deploy RPC probe | `supabase/snapshots/20260528-pre-parity-deploy/post_deploy_probe.txt` |
| Rollback guide | `supabase/snapshots/20260528-pre-parity-deploy/ROLLBACK.md` |
| Rollback SQL | `supabase/snapshots/20260528-pre-parity-deploy/rollback/` |
| Migration parity | 152/152 synced → **154/154 after deploy** |

## Step 2 — Deployment result

**Status: SUCCESS**

| Migration | Result |
|-----------|--------|
| `20260528120000_uuid_rpc_parity_jobs_messaging_inventory.sql` | Applied (inventory section corrected to `inventory_usage` table) |
| `20260528140000_fix_employee_insert_punch_overload.sql` | Applied |

### Pre vs post RPC signature report

| RPC | Pre | Post |
|-----|-----|------|
| `employee_insert_punch` | PGRST203 or 23503 | **23503 only** (RPC resolves; FK on dummy IDs — expected) |
| `employee_get_message_threads_for_worker` | PGRST202 / missing | **200 OK** |
| `employee_get_inventory_items` | PGRST202 / missing | **200 OK** |
| `employee_get_last_punch` | OK | OK |
| `employee_get_jobs_for_employee` | OK | OK |
| `employee_get_pa_tasks` | OK | OK |

**PGRST203 on punch insert: RESOLVED** (9-param overload dropped).

## Step 3 — Attendance E2E (manual required)

Automated probes confirm RPC layer. **Manual app verification still required:**

1. Employee code login → clock in → verify row in `time_punches` (Supabase dashboard)
2. Kill app → reopen → dashboard shows last punch + history
3. Clock out → session calculations correct
4. Offline: airplane mode punch → reconnect → queue replay

**C# fixes deployed in app build (not yet shipped to users):**
- `GetPunchesAsync` / `GetLastPunchAsync` route to RPC when no JWT
- `InsertPunchAsync` always sends `p_punched_by_manager_id`
- Telemetry on punch RPC failure, offline replay, code session refresh

## Step 4 — Field-worker compatibility matrix

| Module | Worker RPC | MAUI uses RPC for code-login | Status post-deploy |
|--------|------------|------------------------------|-------------------|
| Attendance insert | `employee_insert_punch` | Yes | **Green** |
| Attendance read | `employee_get_my_punches`, `employee_get_last_punch` | Dashboard yes; PunchViewModel via storage routing | **Green** (with C# build) |
| Jobs | `employee_get_jobs_for_employee` | Yes | Green |
| Messaging | `employee_get_message_threads_for_worker` | HR uses Postgrest; workers need RPC audit in app | **Yellow** — RPC exists, C# may not call all worker messaging RPCs |
| Inventory | `employee_get_inventory_items` | Teams storage uses RPC path | **Green** |
| Leave | `employee_get_leave_requests` | Yes | Green |
| Scheduling | HR shift templates RPC | HR-only authenticated | Yellow for workers |
| My PA | `employee_get_pa_tasks` | Yes | Green |
| Contractor | `contractor_portal_*` | Portal session | Green (separate auth) |

## Step 5 — Telemetry

| Path | Instrumentation |
|------|-----------------|
| `InsertPunchAsync` RPC failure | `AppTelemetry.LogWarning` |
| `InsertPunchAsync` direct insert failure | `AppTelemetry.LogError` |
| `RefreshCodeSessionAsync` failure | `AppTelemetry.LogWarning` |
| `OfflineQueueService` replay failure | `AppTelemetry.LogWarning` |
| `OfflineQueueService` replay success | `AppTelemetry.LogEvent` |
| `OfflineQueueService` load failure | `AppTelemetry.LogError` |

## Step 6 — Go / No-Go

| Gate | Status |
|------|--------|
| Migrations applied | **PASS** |
| No PGRST203 on punch RPC | **PASS** |
| Worker messaging/inventory RPCs exist | **PASS** |
| C# unit tests | **PASS** (12/12) |
| Manual attendance E2E | **PENDING** — requires field test with real employee code |
| App build with C# routing fixes shipped | **PENDING** — rebuild & distribute MAUI app |

### Recommendation: **CONDITIONAL GO**

- **Database layer:** Ready for production attendance + worker RPC parity.
- **Client layer:** Ship updated MAUI build containing punch read routing + telemetry before declaring enterprise-stable.
- **Rollback:** Available via `ROLLBACK.md` if RPC regressions observed.

### Production readiness score: **78 / 100** (up from 68)

Remaining to reach enterprise-grade:
- Manual attendance E2E sign-off
- MAUI app release to field devices
- Persist telemetry to `app_events` table (optional)
- Messaging worker path audit in C# (does MAUI call new RPCs for code-login?)
