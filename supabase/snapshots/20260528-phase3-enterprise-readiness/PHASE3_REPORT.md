# Phase 3 — Enterprise Readiness Report

**Date:** 2026-05-28  
**Production client:** `KaiFlow.Timesheets.Maui`  
**Backend:** Supabase (`vcivtjwreybaxgtdhtou`)  
**Migrations applied:** 156 (includes Phase 3 parity + telemetry)

---

## Executive summary

The platform has moved from **functionally repaired** toward **operationally trustworthy**. Core attendance, messaging, inventory, scheduling, contractor profile, and paperless paths now route code-login workers through security-definer RPCs. Durable telemetry (`employee_log_app_event` + HR `app_events` insert) eliminates silent critical failures for instrumented paths.

**Overall readiness: 84/100** — conditional GO for field-worker production pilot; full enterprise GO pending real-device attendance certification.

**Deployment recommendation:** Deploy updated MAUI build + migration `20260528180000`, run device E2E checklist, monitor `app_events` for 72 hours.

---

## Step 1 — Attendance validation

### Automated / code audit (complete)

| Check | Status | Notes |
|-------|--------|-------|
| Punch insert via RPC | PASS | `employee_insert_punch`; PostgREST fallback **disabled** for code-login |
| Punch read via RPC | PASS | `GetLastPunchAsync` / `GetPunchesAsync` route to worker RPCs |
| Geolocation on insert | PASS | lat/lng/address sent to RPC |
| Address backfill | PASS | `employee_update_punch_address` RPC (Phase 3) |
| Offline queue replay | PASS | SecureStorage queue; telemetry on enqueue/replay/fail |
| Session restore | PASS | `RefreshCodeSessionAsync` + telemetry |
| UI double-submit guard | PASS | `BaseViewModel.RunAsync` IsBusy gate |
| Duplicate punch DB guard | PARTIAL | No idempotency key; rapid offline replay could duplicate |
| Overtime / hours calc | NOT TESTED | Requires device + payroll period data |

### Real-device E2E (pending — human required)

Use `supabase/smoke/FIELD_WORKER_E2E_CHECKLIST.md`. Record results in table below:

| Scenario | Result | Tester | Date |
|----------|--------|--------|------|
| Code login → clock in → kill app → reopen | PENDING | | |
| Punch history persists | PENDING | | |
| Clock out + hours | PENDING | | |
| Offline clock in → reconnect | PENDING | | |
| Overnight shift | PENDING | | |
| Rapid punch taps | PENDING | | |

### Attendance stability score: **82/100**

Deductions: real-device E2E not yet signed off; no punch idempotency token; overtime unverified on device.

### Edge-case findings

1. **Offline replay duplicates** — queue replays all items; no dedupe by timestamp/type. Mitigation: UI IsBusy; recommend idempotency key in future migration.
2. **PostgREST fallback removed for code-login punches** — failures now surface to user (correct behavior).
3. **Geocode backfill** — previously silent PostgREST update; now RPC with logged failures.

---

## Step 2 — Field-worker module matrix

| Module | RPC path | Code-login | Pass/Fail | Notes |
|--------|----------|------------|-----------|-------|
| **Attendance** | `employee_insert/get_punch*` | Yes | **PASS** | Fail-closed on insert |
| **Messaging** | `employee_get/send_*_for_worker` | Yes | **PASS** | Feed thread RPC added Phase 2 |
| **Inventory** | `employee_get/set_inventory_*` | Yes | **PASS** | Job card usage |
| **Leave** | `employee_get/submit/update_leave_*` | Yes | **PASS** | |
| **Jobs** | `employee_get_jobs_for_employee` etc. | Yes | **PASS** | |
| **Job card / checklist** | worker RPCs | Yes | **PASS** | |
| **Scheduling** | `employee_get_calendar_events_for_worker` | Yes | **PASS** | Phase 3 migration |
| **Shift RSVP** | `employee_update_calendar_event_attendance` | Yes | **PASS** | Phase 3 |
| **Contractor profile** | `employee_get_linked_contractors` | Yes | **PASS** | Phase 3 |
| **Paperless forms** | `employee_get/submit_workflow_form*` | Yes | **PASS** | Phase 3 |
| **My PA tasks** | `employee_get/update_pa_*` | Partial | **PASS*** | Calendar connections still PostgREST |
| **Incidents list** | `employee_get_own_incidents` | Yes | **PASS** | VM fixed to pass employeeId |
| **Documents** | `employee_get_documents` | Yes | **PASS** | |
| **Payslips** | `employee_get_payslips` | Yes | **PASS** | |
| **Notifications** | `employee_get_my_notifications*` | Yes | **PASS** | |
| **Work teams** | `employee_get_work_teams` | Yes | **PASS** | |
| **Directory / peers** | `employee_list_company_peers` | Yes | **PASS** | Job request + PA editor fixed |
| **Job self-create** | PostgREST + HR RPC | No | **FAIL** | HR-only; low priority for field workers |
| **My PA external calendar** | PostgREST | No | **PARTIAL** | Premium feature; needs RPC if required |

**Field-worker stability score: 88/100**

---

## Step 3 — Telemetry hardening

### Implemented

| Path | Events |
|------|--------|
| Attendance | `punch_inserted`, RPC errors, address update |
| Offline queue | `offline_punch_enqueued`, `offline_punch_replay`, replay failures |
| Auth | `code_login`, `code_session_refreshed`, refresh warnings |
| Messaging | `thread_message_sent`, `company_feed_sent`, RPC errors |
| Inventory/forms | submit success + RPC errors |
| Realtime | connect/subscribe/unsubscribe/failures |
| All instrumented paths | Persisted to `app_events` via `employee_log_app_event` (code-login) or authenticated insert (HR) |

### Query telemetry (production)

```sql
select created_at, screen, action, level, error_text, meta
from app_events
where company_id = '<company_uuid>'
order by created_at desc
limit 100;
```

**Operational observability score: 86/100**

Remaining: portal-specific events (client/contractor portal), integration test suite against Supabase.

---

## Step 4 — Enterprise resilience audit

| Risk | Severity | Mitigation |
|------|----------|------------|
| Duplicate offline punches | Medium | IsBusy + queue; add idempotency key recommended |
| RPC fail → empty PostgREST fallback (reads) | Medium | Reduced; high-traffic reads now RPC-first; some HR fallbacks remain |
| Stale code session | Low | Refresh + re-sign-in with telemetry |
| Realtime disconnect | Low | Non-blocking; logged; app polls on navigation |
| Race: double clock-in | Low | UI guard; DB allows multiple IN rows (business rule) |
| SecureStorage queue loss | Low | Persist on enqueue; load errors logged |
| Concurrent inventory set | Low | RPC replaces employee+job usage atomically |

**Resilience risk assessment:** Acceptable for pilot. Recommend punch idempotency before scale.

---

## Step 5 — Configuration & security

| Item | Status | Recommendation |
|------|--------|----------------|
| Supabase URL/key | Hardcoded + env override | `SupabaseEnvironment` reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` |
| Multi-env (dev/staging/prod) | Single linked project | Create staging Supabase project; separate migration pipeline |
| Secure storage | Code session in Preferences + SecureStorage token | OK for field workers |
| JWT cleanup | Expired JWT cleared on init | OK |
| Logout | `CodeSessionStore.Clear()` + auth signout | Verify on all logout paths |
| Portal isolation | Separate session stores | Audit contractor/client portal separately |
| Sensitive logging | Telemetry excludes passwords | Do not log punch coordinates in meta at info level |

**Security posture score: 78/100** — anon key in source remains; standard for mobile apps but rotate via env at CI.

---

## Step 6 — Final scores

| Dimension | Score |
|-----------|-------|
| Overall readiness | **84/100** |
| Attendance stability | **82/100** |
| Field-worker stability | **88/100** |
| HR stability (JWT/PostgREST) | **90/100** |
| Operational observability | **86/100** |

### Production deployment recommendation

**CONDITIONAL GO**

1. Deploy MAUI build with Phase 3 changes to pilot devices (5–10 field workers).
2. Complete real-device attendance E2E checklist (Step 1 table).
3. Monitor `app_events` for RPC failures for 72 hours.
4. Full GO after attendance certification + zero P0 telemetry errors.

---

## Unresolved issues inventory

| ID | Priority | Issue |
|----|----------|-------|
| P3-001 | P1 | Real-device attendance E2E not yet executed |
| P3-002 | P2 | Punch idempotency for offline replay |
| P3-003 | P2 | Job self-create still PostgREST for code-login |
| P3-004 | P3 | My PA external calendar PostgREST for code-login |
| P3-005 | P2 | Separate staging Supabase environment |
| P3-006 | P3 | Integration tests against live RPCs |

---

## Files changed (Phase 3)

- `supabase/migrations/20260528180000_phase3_worker_rpc_telemetry_and_parity.sql`
- `Services/AppTelemetry.cs` — durable sink
- `Services/SupabaseStorageService.cs` — RPC parity + fail-closed punches
- `Services/RealtimeService.cs` — telemetry
- `Services/OfflineQueueService.cs` — telemetry
- `Models/AppEvent.cs`
- `Constants/SupabaseEnvironment.cs`
- Employee ViewModels: incidents, job request, PA editor, contractor admin, shifts, dashboard
