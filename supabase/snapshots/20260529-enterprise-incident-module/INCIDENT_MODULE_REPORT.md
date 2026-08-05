# Enterprise Incident Management Module — Certification Report

**Date:** 2026-05-29  
**Scope:** `KaiFlow.Timesheets.Maui` + Supabase  
**Migration:** `20260529140000_enterprise_incident_module.sql`

---

## Architecture Summary

**One unified incident system** — single table `incident_reports`:

| Type | Condition |
|------|-----------|
| Standalone | `job_id IS NULL` |
| Job-linked | `job_id IS NOT NULL` |

No duplicate tables or parallel workflows. Job Card, HR Job Details, and Incident Module all route through the same `CreateIncidentAsync` → `employee_insert_incident` RPC path.

---

## Database Additions

### Extended `incident_reports`
- `title`, `category`, `status` (open/investigating/resolved/closed)
- `occurred_at`, `updated_at`
- `latitude`, `longitude`, `location_text`

### New tables
- `incident_comments` — threaded discussion per incident
- `incident_status_history` — audit trail for status transitions

### Worker RPCs (security definer, anon + authenticated)
| RPC | Purpose |
|-----|---------|
| `employee_insert_incident` | Create (standalone or job-linked) |
| `employee_get_incidents` | List visible incidents (reporter, assignee, job team) |
| `employee_get_incident` | Single incident detail |
| `employee_update_incident` | Status, assignee, resolution (HR/manager/assignee) |
| `employee_add_incident_comment` | Add comment |
| `employee_get_incident_comments` | List comments |
| `employee_get_incident_status_history` | Audit history |
| `employee_append_incident_photos` | Append uploaded photo URLs |

---

## MAUI Module

### Centralized screens
| Screen | Role |
|--------|------|
| `MyIncidentsPage` | Employee incident hub — All / Standalone / Job-linked tabs, search, offline pending count |
| `HrIncidentsPage` | HR incident hub — same scope filters + open/all + search |
| `IncidentReportPage` | **Unified create form** — standalone or pre-linked via `JobId` query param |
| `HrIncidentDetailsPage` | Shared details — comments, status history, assign, close (HR/manager) |

### Job integration
- **Job Card** and **HR Job Details** → navigate to `IncidentReportPage` with job context (no more prompt-only flow)
- Job incidents list uses `employee_get_incidents` filtered by `job_id`

### Offline
- `PendingIncident` queue in `OfflineQueueService`
- Enqueue on no connectivity; replay uploads photos then creates via RPC
- Telemetry: `offline_incident_enqueued`, `offline_incident_replay`

### Realtime
- `MyIncidentsViewModel` and `HrIncidentsViewModel` subscribe to `IncidentChanged`
- Lists auto-refresh on company incident channel updates

### Telemetry
| Event | Trigger |
|-------|---------|
| `incident_created` | Successful RPC create |
| `incident_updated` | Status/assignee change |
| `incident_comment_added` | New comment |
| `incident_photo_uploaded` | Storage upload success |
| Errors logged | RPC/upload/create failures (no silent catch on create) |

### Photo attachments
- `UploadIncidentPhotoAsync` → `workforce-media/incident_reports/{company}/{employee}/{uuid}.ext`
- URLs persisted in `photo_urls[]` via create RPC

---

## Auth Consistency

| Auth | Create | List | Detail | Update | Comments |
|------|--------|------|--------|--------|----------|
| Code-login (anon) | RPC | RPC | RPC | RPC | RPC |
| JWT employee | RPC | RPC | RPC | RPC | RPC |
| HR JWT | RPC or PostgREST insert | PostgREST | PostgREST | PostgREST | RPC + PostgREST read |

---

## Validation Checklist (device E2E — pending human run)

- [ ] Employee code-login: standalone incident → persists, appears in module
- [ ] Employee code-login: job-linked incident from Job Card → appears in job + module
- [ ] HR: create incident from module with optional job link
- [ ] HR: assign, investigate, close with resolution notes
- [ ] Comments visible to reporter and HR
- [ ] Photos upload and render for other users
- [ ] Offline create → queue → reconnect replay
- [ ] Realtime list refresh without manual pull
- [ ] App restart persistence
- [ ] Contractor portal incidents unchanged (separate RPC)

---

## Build / Deploy

- MAUI Windows build: **0 errors**
- Unit tests: **12/12 passed**
- Migration: **deployed** to linked Supabase
