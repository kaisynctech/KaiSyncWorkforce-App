# MISSION BRIEF — Systemic RPC Fix (All Employee Pages)
**Scope:** All employee portal pages + DB function definitions  
**Files:** 7 code files + 1 SQL script  
**Status:** READY TO IMPLEMENT  
**Priority:** CRITICAL — fixes Jobs, PA, Incidents, Shifts, Payslips, Forms, Messages, Notifications all at once

---

## Background

The browser console on the Dashboard showed:

```
[Dashboard] init failed: TypeError: Cannot read properties of undefined (reading 'rest')
    at rpc (...)
```

And separate 405 network errors for `employee_get_jobs_for_employee` and `employee_get_pa_tasks`.

Investigation revealed **two completely separate root causes** that together break every employee portal page that reads data.

---

## Root Cause 1 — JavaScript Method Binding (7 files)

### What's broken

Several pages assign `supabase.rpc` to a local variable:

```ts
const rpc = supabase.rpc as any
// ...later...
rpc('employee_get_jobs_for_employee', {...})
```

When you assign a class method to a variable like this, it **detaches** from its instance. When `rpc(...)` is called, `this` inside the function is `undefined` (strict mode). The Supabase client immediately tries to access `this.rest` → `TypeError: Cannot read properties of undefined (reading 'rest')`.

This throws **before any network request is made**. The `Promise.all` rejects, and any page without a try/catch hangs forever on "Loading…".

### Files affected

| File | Impact |
|------|--------|
| `src/app/dashboard/employee/overview/page.tsx` | Dashboard crash (now shows error screen) |
| `src/app/dashboard/employee/notifications/page.tsx` | Notifications stuck on Loading |
| `src/app/dashboard/employee/leave/page.tsx` | Leave may partially fail |
| `src/app/dashboard/employee/forms/page.tsx` | Forms crash |
| `src/app/dashboard/employee/incidents/[id]/page.tsx` | Incident detail fails |
| `src/app/dashboard/employee/jobs/[id]/page.tsx` | Job detail fails |
| `src/app/dashboard/employee/pa/_editor.tsx` | PA task editor fails |

### Fix — search and replace across all 7 files

Find this exact pattern in every affected file:
```ts
const rpc = supabase.rpc as any
```

Replace with:
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
```

This creates a wrapper arrow function. Arrow functions capture their context lexically, so `supabase.rpc` is always called as a **method of `supabase`** — `this` is preserved.

**No other changes needed** to any of these files for this fix. The call sites (`rpc('function_name', {...})`) stay exactly the same.

---

## Root Cause 2 — STABLE Functions Return 405 (37 DB functions)

### What's broken

In PostgreSQL, functions can be marked `VOLATILE`, `STABLE`, or `IMMUTABLE`. Read-only functions are typically marked `STABLE`. However, **PostgREST v12 (used by Supabase) only allows POST for VOLATILE functions**. STABLE functions must be called via GET. The Supabase JavaScript client **always sends POST** for `.rpc()` calls.

Result: every `employee_*` read function marked `STABLE` returns **HTTP 405 Method Not Allowed** when called from the web app. The Supabase client returns `{data: null, error: {code: '405'}}`. Pages that check for errors show "Failed to load"; pages that don't check show empty data.

### DB query proof

```sql
SELECT proname FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname LIKE 'employee_%' AND p.provolatile = 's';
```
Returns 37 functions — ALL the read-side employee RPCs.

Functions confirmed working: `employee_get_my_punches`, `employee_get_last_punch`, `employee_is_on_leave_today`, `employee_get_leave_requests` — these are `VOLATILE` and work fine.

### Fix — SQL script (run in Supabase Dashboard → SQL Editor)

> **Important:** This is a safe, reversible change. Changing `STABLE → VOLATILE` does not alter function logic or data. It only affects how PostgREST routes the HTTP request (now: POST, same as the JS client sends).

```sql
-- ============================================================
-- Fix: Change all STABLE employee read-functions to VOLATILE
-- so PostgREST accepts POST requests from the Supabase JS client.
-- ============================================================

ALTER FUNCTION employee_find_direct_thread_peer VOLATILE;
ALTER FUNCTION employee_get_calendar_events_for_worker VOLATILE;
ALTER FUNCTION employee_get_checklist_for_job VOLATILE;
ALTER FUNCTION employee_get_company_approved_leave VOLATILE;
ALTER FUNCTION employee_get_company_feed_thread VOLATILE;
ALTER FUNCTION employee_get_company_messages_for_worker VOLATILE;
ALTER FUNCTION employee_get_daily_absences VOLATILE;
ALTER FUNCTION employee_get_direct_peer_thread_map VOLATILE;
ALTER FUNCTION employee_get_incident VOLATILE;
ALTER FUNCTION employee_get_incident_comments VOLATILE;
ALTER FUNCTION employee_get_incident_status_history VOLATILE;
ALTER FUNCTION employee_get_incidents VOLATILE;
ALTER FUNCTION employee_get_inventory_items VOLATILE;
ALTER FUNCTION employee_get_inventory_usage_for_job VOLATILE;
ALTER FUNCTION employee_get_job_card_for_employee VOLATILE;
ALTER FUNCTION employee_get_job_card_for_job VOLATILE;
ALTER FUNCTION employee_get_job_documents VOLATILE;
ALTER FUNCTION employee_get_job_feedback VOLATILE;
ALTER FUNCTION employee_get_job_for_employee VOLATILE;
ALTER FUNCTION employee_get_job_photo_urls VOLATILE;
ALTER FUNCTION employee_get_jobs_for_employee VOLATILE;
ALTER FUNCTION employee_get_linked_contractors VOLATILE;
ALTER FUNCTION employee_get_message_threads_for_worker VOLATILE;
ALTER FUNCTION employee_get_my_notifications_for_employee VOLATILE;
ALTER FUNCTION employee_get_own_incidents VOLATILE;
ALTER FUNCTION employee_get_pa_settings VOLATILE;
ALTER FUNCTION employee_get_pa_tasks VOLATILE;
ALTER FUNCTION employee_get_punches VOLATILE;
ALTER FUNCTION employee_get_thread_messages_for_worker VOLATILE;
-- employee_get_work_teams has two overloads — must specify parameter types:
ALTER FUNCTION employee_get_work_teams(bigint, bigint) VOLATILE;
ALTER FUNCTION employee_get_work_teams(uuid, uuid, text) VOLATILE;
ALTER FUNCTION employee_get_workflow_form_submissions VOLATILE;
ALTER FUNCTION employee_get_workflow_form_templates VOLATILE;
ALTER FUNCTION employee_has_contractor_job_scope VOLATILE;
ALTER FUNCTION employee_has_shift_overlap VOLATILE;
ALTER FUNCTION employee_job_site_open_visit VOLATILE;
ALTER FUNCTION employee_list_company_peers VOLATILE;
```

**How to run:** Supabase Dashboard → your project → SQL Editor → paste → Run.

---

## Expected outcome after BOTH fixes

| Page | Before | After |
|------|--------|-------|
| Dashboard | "Failed to load" / hanging | Loads — clock widget, jobs count, PA tasks ✅ |
| My Jobs | "No jobs assigned" | Shows actual jobs ✅ |
| My PA | "Failed to load tasks" | Shows PA tasks ✅ |
| My Shifts | "Failed to load shifts" | Shows shifts ✅ |
| My Incidents | "No incidents found" (wrong) | Shows actual incidents ✅ |
| Forms | JS crash | Loads template list ✅ |
| Messages | Partially broken | Loads threads ✅ |
| Notifications | Stuck on Loading | Shows notifications ✅ |
| Leave | May show empty | Shows leave requests ✅ |

---

## Checklist

### Code changes (engineer commits to repo)
- [ ] `overview/page.tsx` — replace `const rpc = supabase.rpc as any` with bound wrapper
- [ ] `notifications/page.tsx` — same
- [ ] `leave/page.tsx` — same
- [ ] `forms/page.tsx` — same
- [ ] `incidents/[id]/page.tsx` — same
- [ ] `jobs/[id]/page.tsx` — same
- [ ] `pa/_editor.tsx` — same

### DB change (run SQL in Supabase SQL Editor — NOT via apply_migration)
- [ ] Run the 37 ALTER FUNCTION statements above in the Supabase SQL Editor
- [ ] Verify: `SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname LIKE 'employee_%' AND p.provolatile = 's'` should return 0 rows

---

## Verification (after deploy)

1. Navigate to **My Jobs** → should show a list of jobs (not "No jobs assigned")
2. Navigate to **My PA** → should show tasks (not "Failed to load tasks")
3. Navigate to **My Incidents** → should show incidents (not "No incidents found")
4. Navigate to **Dashboard** → should load fully with active jobs count > 0 and PA tasks
5. Navigate to **Notifications** → should load (not stuck on Loading)

---

## What this brief does NOT cover

Pages that may still have issues after this fix (separate briefs to follow):
- My Shifts — shifts may still fail if there's a separate data issue
- My Payslips — payslips RPC not confirmed VOLATILE
- Forms — may still crash on response parsing
- Messages — may have additional issues
