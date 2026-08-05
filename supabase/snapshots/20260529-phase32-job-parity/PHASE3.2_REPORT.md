# Phase 3.2 — Employee Job Parity + Incident Visibility Report

**Date:** 2026-05-29  
**Scope:** `KaiFlow.Timesheets.Maui`

---

## Issue 1 — Employee Job Experience Parity

### Root cause
Employee job detail (`JobCardPage`) was field-execution focused while HR (`HrJobDetailsPage`) had full enterprise tooling. Same `jobs` table/RPCs, different UI surface.

### HR vs Employee capability matrix (after Phase 3.2)

| Capability | HR | Employee (before) | Employee (after) |
|------------|----|--------------------|------------------|
| Job metadata (code, priority, client, site) | Yes | Partial | **Yes** |
| Team assignment / costs | Yes | No | No (role-restricted) |
| Documentation upload/list | Yes | No | **Yes** (worker RPC) |
| Checklist add/toggle | Yes | Toggle only | **Add + toggle** (worker RPC) |
| Job photos | Yes | Yes | Yes |
| Inventory usage | Yes | Yes | Yes |
| Job team chat | Yes | No | **Yes** (worker RPC) |
| Incidents | Yes | Yes | Yes (module-gated) |
| On-site GPS / job card | No | Yes | Yes |
| Client feedback | No | Yes | Yes |
| Edit/delete job | Yes | No | No (role-restricted) |

### Worker RPCs added (`20260529160000`)
- `employee_get_job_documents`
- `employee_insert_job_document`
- `employee_insert_checklist_item`
- `employee_get_job_thread` (+ anon grant on `ensure_job_team_message_thread`)

---

## Issue 2 — Leadership Assignment Fallback

### Root cause
Manager picker required `UserId` and filtered narrowly; HR admins/owners without linked auth users were excluded.

### Fix
- `AssignableEmployeeRules.IsAssignableLeadership()` — Manager, Admin, HrAdmin, Owner
- Removed `UserId` requirement (notify uses `EmployeeId` via RPC)
- UI label: **Notify leadership (optional)** — HR, managers, owners

---

## Issue 3 — Incident Module Visibility

### Root cause
Incidents were gated behind `CompanyModules.Paperless` with `defaultIfMissing: false`. Most companies never opt in → module hidden on employee Home and HR nav.

### Fix
- New module key: `CompanyModules.Incidents` — **enabled by default**
- `CompanyModules.IsIncidentsEnabled()` — legacy fallback to `paperless` flag
- Employee **More** menu: **Incidents** row added (alongside Jobs)
- HR dashboard: `ShowIncidentsNav` uses `IsIncidentsEnabled()`
- Paperless split to forms-only module label

---

## Files changed (summary)

| Area | Key files |
|------|-----------|
| Modules | `Helpers/CompanyModules.cs` |
| Assignment | `Helpers/AssignableEmployeeRules.cs`, `EmployeeJobRequestViewModel.cs` |
| Navigation | `EmployeeDashboardPage.xaml`, `EmployeeDashboardViewModel.cs`, `HrDashboardViewModel.cs` |
| Job parity | `JobCardViewModel.cs`, `JobCardPage.xaml`, `SupabaseStorageService.cs` |
| DB | `20260529160000_phase32_job_parity_worker_rpcs.sql` |

---

## Validation checklist (device)

- [ ] Employee More → **Incidents** opens module
- [ ] HR nav → **Incidents** tab visible (default companies)
- [ ] Job card → upload document, add checklist, open chat (code-login)
- [ ] Create job → leadership picker shows HR/admin/owner
- [ ] Job metadata (code, priority, client, site) on employee job card

---

## Build / deploy

- MAUI Windows build: **0 errors**
- Migration: deploy with `supabase db push --linked`
