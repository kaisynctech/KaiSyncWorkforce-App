# Module — Jobs

> **Module key:** `ticketing` · **Permissions:** `jobs.view`, `jobs.view_all`, `jobs.create`, `jobs.edit` · **Maturity:** Production

## Purpose

The operational job lifecycle: HR creates/manages jobs; employees see Assigned/My-Jobs/All scopes, execute job cards (site visits, checklist, photos, documents), and can create their own jobs; assignment is normalized across client and server; jobs link to CRM projects.

## ViewModels & screens

| Side | ViewModel | Screen |
|------|-----------|--------|
| HR | `HrJobsViewModel` | `HrJobsPage.xaml` (+ shared `HrJobsTableView`) — also drives Projects list |
| HR | `HrCreateJobViewModel` | `HrCreateJobPage.xaml` |
| HR | `HrJobDetailsViewModel` | `HrJobDetailsPage.xaml` (labor, checklist, documents) |
| Employee | `MyJobsViewModel` | `MyJobsPage.xaml` (+ `EmployeeJobsTableView`) |
| Employee | `JobCardViewModel` | `JobCardPage.xaml` |
| Employee | `EmployeeJobRequestViewModel` | `EmployeeJobRequestPage.xaml` |

## Tab semantics

**Employee (`MyJobsViewModel.Scope`):**

| Tab | Scope | Filter (`Helpers/JobOwnershipHelper.cs`) |
|-----|-------|-------------------------------------------|
| Assigned | `assigned` | `IsAssignedByOthers` — assigned to me, **not** created by me |
| My Jobs | `created` | `IsCreatedBy` — requires `created_by_employee_id` |
| All | `all` | `IsInAllJobsScope` — created OR assigned-by-others |

Status filter: `all/open/scheduled/inProgress/completed/cancelled`.

**HR (`HrJobsViewModel.ScopeFilter`):** `all` (full company list, needs `jobs.view_all`/`projects.view_all`) vs `mine` (assigned to current employee; for projects: manager or has an assigned job on the deal). Defaults to `all` if allowed, else `mine`.

Helpers: `JobAssignmentHelper` (`Normalize`, `IsAssignedTo` — must mirror RPC visibility), `AssignableEmployeeRules` (who an employee may assign when creating a job).

## Models

`Job` (incl. `created_by_employee_id`, `job_code`, `deal_id`, `assigned_employee_ids[]`, `assignee_employee_id`, `visibility`, `photo_urls[]`), `JobCard`, `JobChecklistItem`, `JobDocument`, `JobCode`, `JobSiteVisit`, `LaborEntry`.

## Storage methods

`GetJobsAsync`, `GetJobAsync`, `CreateJobAsync`, `EmployeeCreateJobAsync`, `UpdateJobAsync`, `DeleteJobAsync`, `GetJobCardAsync`, `SaveJobCardAsync`, checklist CRUD, `GetJobDocumentsAsync`/`UploadJobDocumentAsync`, `UploadJobPhotoAsync`/`AppendJobPhotoAsync`/`GetJobPhotoUrlsAsync`, `GenerateNextJobCodeAsync`, `EmployeeJobSiteSignIn/SignOut/OpenVisitAsync`, labor CRUD, `LinkClientDealToJobAsync`/`GetJobsByDealIdAsync`, `GetOrCreateJobThreadAsync`, `NotifyManagerJobCreatedAsync`.

## RPCs

`employee_create_job` (`..._employee_create_job_enterprise.sql`), `employee_get_jobs_for_employee`, `employee_get_job_for_employee`, `employee_update_job_status`, `employee_get_job_card_for_employee`, `employee_upsert_job_card`, `employee_get_checklist_for_job`, `employee_insert_checklist_item`, `employee_get_job_documents`/`employee_insert_job_document`, `employee_get_job_thread`, `append_job_photo`/`get_job_photo_urls`, `hr_set_job_assignments`. Creator backfill: `..._phase33_job_creator_ownership_backfill.sql`.

## Tables

`jobs`, `job_cards`, `job_checklist_items`, `job_documents`, `job_codes`, `job_site_visits`, `labor_entries`, linked `client_deals` (`deal_id`/`job_id`).

## Permissions

`jobs.*` plus `projects.view_all` for the combined All scope. HR nav gate: `CompanyModules.Ticketing`. Employees with `jobs.view` see their scoped jobs; creating requires the employee-create RPC (no direct insert under code-login).

## Realtime / Offline

- **No dedicated jobs realtime channel.** `EmployeeCreateJobAsync` fires `NotifyPunchChanged()` to nudge dashboard refresh.
- **No offline queue** for jobs/job cards/photos — these require a live RPC.

## Telemetry

`my_jobs_query`, `my_jobs_creator_mismatch`, `jobs_missing_creator_id`, `job_card_saved`.

## Interoperability

- **→ Incidents:** incidents can be linked to a job (`job_id`).
- **→ Inventory:** inventory usage is allocated against a job.
- **→ Projects/CRM:** jobs link to `client_deals` via `deal_id`; project codes via `JobCode`.
- **→ My PA:** jobs sync into the PA timeline (`sync_operational_pa_tasks`).
- **→ Messaging:** job-team threads (`GetOrCreateJobThreadAsync`, subject `Job:{id}`).
- **↔ Contractors:** jobs assignable to contractors; contractor portal records site visits.

## Risks & gaps

1. **`created_by_employee_id` null on legacy rows** breaks the My-Jobs (Created) tab — telemetry warns; backfill migration exists but stragglers possible.
2. **Code-login must use `employee_create_job`** (no direct insert).
3. **`JobAssignmentHelper.Normalize` must stay aligned** with `employee_get_jobs_for_employee` visibility rules.
