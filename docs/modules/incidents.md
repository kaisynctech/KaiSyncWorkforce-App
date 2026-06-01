# Module — Incidents

> **Module key:** `incidents` (enabled by default; legacy `paperless` fallback) · **Permissions:** none dedicated · **Maturity:** Production

## Purpose

Enterprise incident reporting and lifecycle: standalone or job-linked reports with severity/category/GPS/occurred-at metadata, HR assignment and status workflow, threaded comments, status history, photo evidence, contractor-portal submissions, and offline employee queueing.

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `HrIncidentsViewModel` | `HrIncidentsPage.xaml` | HR list; scope `all`/`standalone`/`job`; search; close |
| `HrIncidentDetailsViewModel` | `HrIncidentDetailsPage.xaml` | Assignee, status transitions, comments, history |
| `MyIncidentsViewModel` | `MyIncidentsPage.xaml` | Employee list (RPC-scoped); offline pending count; CSV export |
| `IncidentReportViewModel` | `IncidentReportPage.xaml` | Create: standalone or job-linked (`?JobId=`) |
| `JobCardViewModel` | `JobCardPage.xaml` | Embedded incident list + "Report" shortcut |

## Standalone vs job-linked

- **Standalone:** `JobId == null`; reporter optionally picks client → site, open job, manager assignee.
- **Job-linked:** navigated with `?JobId=`; RPC enforces `_employee_assigned_to_job`.
- Both converge on `CreateIncidentAsync` → `employee_insert_incident`.

Status machine: `open → investigating → resolved/closed` (HR list quick-close can skip intermediate states).

## Models

`IncidentReport` (`incident_reports`), `IncidentComment` (`incident_comments`), `IncidentStatusHistory` (`incident_status_history`), `PendingIncident` (local SecureStorage queue payload).

## Storage methods

`GetIncidentsAsync`, `GetIncidentAsync`, `CreateIncidentAsync` (with local photo paths), `UpdateIncidentAsync`, `GetIncidentCommentsAsync`/`AddIncidentCommentAsync`, `GetIncidentStatusHistoryAsync`, `UploadIncidentPhotoAsync`, plus `ContractorPortalCreateIncidentAsync`.

## RPCs

`employee_insert_incident`, `employee_get_incidents`, `employee_get_incident`, `employee_get_own_incidents`, `employee_update_incident`, `employee_add_incident_comment`, `employee_get_incident_comments`, `employee_get_incident_status_history`, `employee_append_incident_photos` (**defined but unused by app**). Helpers: `_employee_can_view_incident`, `_employee_can_manage_incident`, `_incident_apply_status`. Migrations: `..._employee_insert_incident.sql`, `..._fix_incident_jobcard_feedback_rpc.sql` (PGRST203 cleanup), `..._enterprise_incident_module.sql`.

## Tables

`incident_reports`, `incident_comments`, `incident_status_history`. RLS company-scoped on comments/history; worker visibility enforced inside RPCs (reporter, assignee, or job-assignee).

## Permissions

No dedicated `incidents.*` keys — gated by `CompanyModules.IsIncidentsEnabled()` (legacy `paperless` fallback). HR list uses PostgREST under RLS; worker path uses RPC scope.

## Realtime / Offline

- **Realtime:** `incident_reports` (all events) → `IncidentChanged`; local `NotifyIncidentChanged()` after create/update/comment.
- **Offline:** `OfflineQueueService` (`offline_incident_queue`); `IncidentReportViewModel` enqueues `PendingIncident` when offline; photos uploaded at replay. Telemetry: `offline_incident_enqueued`, `offline_incident_replay`.

## Photo upload

Bucket `workforce-media`, path `incident_reports/{companyId}/{employeeId}/{guid}{ext}`; URLs passed to `employee_insert_incident` as `p_photo_urls`. (Post-create append RPC exists but is unused.)

## Interoperability

- **↔ Jobs:** optional `job_id` link; reachable from the job card.
- **↔ Sites:** optional `site_id` (property linkage exists in schema, not surfaced).
- **↔ Contractors:** contractor portal can create incidents (`contractor_id`).

## Risks & gaps

1. **`employee_append_incident_photos` not wired** — no post-submit photo add from details.
2. **HR (unscoped PostgREST) vs worker (strict RPC) visibility split** — code-login HR may behave differently.
3. **No incident permission matrix** — any HR with the module enabled sees all incidents via RLS.
4. **Offline queue not surfaced HR-side** (only `MyIncidentsViewModel.PendingOfflineCount`).
