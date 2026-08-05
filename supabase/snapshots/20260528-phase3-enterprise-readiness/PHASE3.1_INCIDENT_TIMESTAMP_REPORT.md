# Phase 3.1 — Incident & Job Timestamp Stabilization

**Date:** 2026-05-28  
**Migration:** `20260529000000_fix_incident_jobcard_feedback_rpc.sql` (deployed)

---

## Issue 1 — Incident save failure

### Root cause (confirmed via production RPC probe)

**PGRST203 — function overload ambiguity**

Production had **two** `employee_insert_incident` functions:

| Overload | Params |
|----------|--------|
| Legacy (bigint) | `p_company_id bigint, p_employee_id bigint, p_employee_code text, ...` |
| UUID (correct) | `p_company_id uuid, p_employee_id uuid, p_description text, ...` |

PostgREST could not choose which to call → RPC failed → C# showed misleading message *"Apply migration 20260526240000"* even though that migration **was already applied**.

The UUID migration used `CREATE OR REPLACE` but did **not DROP** the legacy bigint overload (same class of bug as `employee_insert_punch` PGRST203).

### Auth path (correct)

- Code-login workers → `employee_insert_incident` RPC (security definer) ✓
- Not using PostgREST insert for field workers ✓

### Fix

1. `DROP FUNCTION` legacy bigint overload
2. Re-assert canonical UUID function
3. C#: surface real RPC error text; telemetry on success/failure; fail-closed for code-login

### Incident flow map

```
JobCardViewModel.ReportIncidentAsync / IncidentReportViewModel.SubmitAsync
  → SupabaseStorageService.CreateIncidentAsync
    → RPC employee_insert_incident (code-login + HR with employeeId)
    → incident_reports table
    → RealtimeService.NotifyIncidentChanged
    → app_events via AppTelemetry
```

Reads: `GetIncidentsAsync(companyId, employeeId)` → `employee_get_own_incidents` RPC

---

## Issue 2 — Job timestamp disappears

### Root causes (two compounding bugs)

1. **DB upsert wiped timestamps on partial save**  
   `employee_upsert_job_card` used `start_time = EXCLUDED.start_time`. When UI saved checklist/work without hydrated timestamps, `NULL` overwrote stored values.

2. **UI hydration gap**  
   `JobCard.StartTime` lacked `[JsonProperty("start_time")]` — RPC JSON might not deserialize into `ActualStart` on reload.

### Fix

1. SQL: `COALESCE(excluded.start_time, job_cards.start_time)` (same for end_time, work fields)
2. C#: merge existing card timestamps before upsert if UI fields empty
3. C#: sync `ActualStart`/`ActualEnd` from saved card after persist
4. JsonProperty on `start_time` / `end_time`

### Timestamp lifecycle

```
StampActualStartAsync → ActualStart = Now → PersistCardAsync
  → SaveJobCardAsync → employee_upsert_job_card → job_cards.start_time
Reload → GetJobCardAsync → employee_get_job_card_for_employee → ActualStart hydrated
```

---

## Client feedback (your question)

**Before:** `CaptureClientFeedbackAsync` was a **UI-only stub** — showed "Submitted" alert but **saved nothing**. Legacy `job_feedback` table was dropped in UUID schema v2.

**After Phase 3.1:**

| Action | Where |
|--------|-------|
| Save | `employee_submit_job_feedback` RPC → `job_feedback` table |
| Show (field worker) | Job card **Client Feedback** section → `FeedbackSummary` label |
| Show (HR) | Query `job_feedback` by job (HR UI not yet built in MAUI) |

Example query:

```sql
select rating, comments, submitted_at, employee_id
from job_feedback
where job_id = '<job_uuid>'
order by submitted_at desc;
```

---

## Re-test on device

1. Redeploy MAUI build with Phase 3.1 changes
2. Job card → Report incident → should save (check `incident_reports`)
3. Stamp actual start → navigate away → return → timestamp persists
4. Capture feedback → see summary on job card → verify `job_feedback` row

Monitor telemetry:

```sql
select * from app_events
where action in ('incident_created', 'job_card_saved', 'job_feedback_submitted')
order by created_at desc limit 20;
```
