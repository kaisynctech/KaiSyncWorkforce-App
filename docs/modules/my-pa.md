# Module — My PA (Personal Assistant)

> **Module key:** `my_pa` · **Permissions:** none dedicated · **Maturity:** Production (calendar OAuth is placeholder)

## Purpose

A personal/operational assistant layer: tasks, a calendar that aggregates jobs/projects/deals (plus external Google/Outlook placeholders), briefings, focus mode, and — in HR mode — a company-wide manager digest. My PA is a **first-class module**: an embedded HR sidebar tab (index 22) *and* a standalone employee page.

## ViewModels, services & screens

| Component | Path | Role |
|-----------|------|------|
| `MyPaSectionViewModel` | `ViewModels/Employee/MyPaSectionViewModel.cs` | Core PA logic; `IsHrWorkspace` mode |
| `MyPaTaskEditorViewModel` | `MyPaTaskEditorPage.xaml` | Task create/edit |
| `MyPaCalendarConnectService` | `Services/MyPaCalendarConnectService.cs` | Google/Outlook OAuth (placeholder) |
| `MyPaHelper` | `Helpers/MyPaHelper.cs` | Digest/briefing builders |
| `MyPaSectionView` | `Views/Shared/MyPaSectionView.xaml` | Reusable view (HR tab 22) |
| `MyPaSectionPage` | `Views/Employee/MyPaSectionPage.xaml` | Standalone employee page hosting the view |

## HR embedded sidebar

`HrDashboardPage.xaml` hosts `<shared:MyPaSectionView BindingContext="{Binding MyPa}" />`. `HrDashboardViewModel` injects `MyPaSectionViewModel`, sets `HrMode = "true"`, and `GoToMyPaAsync` switches to tab 22 (no page navigation).

- **HR mode (`IsHrWorkspace`):** loads **all company tasks** (`ownerId = null`), shows the **manager digest** (`MyPaHelper.BuildManagerDigest`), company-wide subtitle.
- **Employee mode:** scopes to `employee.Id`, enqueues PA-task notifications.

## Models

`PaTask` (`pa_tasks`), `PaTaskTemplate` (`pa_task_templates`), `MyPaCalendarEntry`, `EmployeePaSettings` (`employee_pa_settings`), plus digest/briefing/timeline/search helper models, `EmployeeCalendarConnection` (`employee_calendar_connections`).

## Storage methods

`SyncOperationalPaTasksAsync` (RPC `sync_operational_pa_tasks`), `GetPaTasksAsync` (`employee_get_pa_tasks`), `CreatePaTaskAsync`/`EmployeeCreatePaTaskAsync`/`UpdatePaTaskAsync`/`UpdatePaTaskStatusAsync`/`DeletePaTaskAsync`, `GetPaTaskTemplatesAsync`, `GetEmployeePaSettingsAsync`/`SaveEmployeePaSettingsAsync` (`employee_get_pa_settings`, `upsert_employee_pa_settings`), `GetMyPaCalendarEntriesMergedAsync`, `GetCalendarConnectionsAsync`, `EnqueuePaTaskNotificationsAsync`, `NotifyPaTaskDelegatedAsync`.

## RPCs / migrations

`..._my_pa_uuid_and_job_manager_notify.sql`, `..._my_pa_rich_schema_and_sync.sql`, `..._my_pa_tier_features.sql`, `..._employee_code_email_parity.sql`. Tables: `pa_tasks`, `pa_task_templates`, `employee_pa_settings`, `employee_calendar_connections`.

## Permissions / gating

Module: `CompanyModules.MyPa`. No dedicated permission keys.

## Realtime / Offline

None; sync runs on each `LoadAsync`. Calendar OAuth opens a browser and requires a `calendar-oauth-callback` Edge Function (not deployed by default).

## Interoperability

- **← Jobs / Projects / Deals:** `sync_operational_pa_tasks` aggregates operational items into the PA timeline.
- **→ Notifications:** PA-task reminders enqueue notifications.
- **HR digest:** aggregates company tasks for managers.

## Risks & gaps

1. **Google/Outlook connect is a placeholder** (needs client IDs + Edge Function); `DisconnectAsync` is a no-op.
2. **Operational sync silently returns 0** on RPC failure.
3. **HR sidebar view is compact** — full calendar/connect UX only on the standalone page.
