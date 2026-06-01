# Employee-Created Jobs — Enterprise Integration Report

**Date:** 2026-05-29  
**Scope:** `KaiFlow.Timesheets.Maui` (production)  
**Migration:** `20260529120000_employee_create_job_enterprise.sql`

---

## Summary

Employee-created jobs are now first-class enterprise jobs — same `jobs` table, HR visibility, scheduling calendar events, messaging threads, and assignment model as HR-created jobs. Code-login field workers use a **security-definer RPC** (`employee_create_job`); no direct PostgREST inserts.

The employee UI is consolidated into a single **Jobs** hub (dashboard no longer has a separate “Add Job” row).

---

## Architecture

| Layer | HR path | Employee path |
|-------|---------|---------------|
| Create | `CreateJobAsync` → PostgREST insert + `hr_set_job_assignments` | `EmployeeCreateJobAsync` → `employee_create_job` RPC |
| List | PostgREST / HR queries | `employee_get_jobs_for_employee` RPC |
| Audit | `created_by_hr_user_id` (JWT) | `created_by_employee_id` (new column) |

### RPC: `employee_create_job`

- Validates company isolation via `_employee_valid`
- Inserts job with assignments, job code, `created_by_employee_id`
- Creates job team message thread (`ensure_job_team_message_thread`)
- Inserts `calendar_events` when scheduled start is set
- Optionally notifies manager via `employee_notify_manager_job_created`
- Granted to `anon, authenticated`

---

## UI Changes

| Before | After |
|--------|-------|
| Dashboard: “My Jobs” + “Add Job” | Dashboard: single **Jobs** entry |
| `MyJobsPage`: status filters only | **Assigned \| My Jobs \| All** scope tabs + status filters |
| Create from dashboard | **+ Job** toolbar on Jobs page → Create Job form |
| PostgREST create (broken for code-login) | RPC create with coworker multi-select + manager notify |

### Tab logic

- **Assigned:** jobs where employee is on the team but did not create the job
- **My Jobs:** `created_by_employee_id == current employee`
- **All:** full RPC result set

---

## Telemetry

| Event | Trigger |
|-------|---------|
| `employee_job_created` | Successful RPC create |
| Error + context | RPC failure, permission/validation errors |

---

## Validation Checklist (device E2E — pending human run)

- [ ] Code-login employee creates job → persists after app restart
- [ ] Job appears on HR dashboard / manager job list
- [ ] Assigned coworkers see job in **Assigned** tab
- [ ] Creator sees job in **My Jobs** tab
- [ ] Calendar event visible in scheduling (when start time set)
- [ ] Job card, attendance, messaging thread accessible
- [ ] Manager notification received (when selected)
- [ ] HR-created jobs unchanged (regression)

---

## Auth Consistency

| Auth mode | Create | List |
|-----------|--------|------|
| Code-login (anon) | `employee_create_job` RPC | `employee_get_jobs_for_employee` RPC |
| JWT employee | `EmployeeCreateJobAsync` (same RPC) | RPC |
| HR JWT | PostgREST (unchanged) | PostgREST |

---

## Build / Deploy Status

- MAUI Windows build: **0 errors**
- Unit tests: **12/12 passed**
- Migration: **deployed** to linked Supabase project
