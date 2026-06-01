# Module — Attendance & Time Punch

> **Module key:** `attendance` · **Permissions:** `attendance.view_team`, `attendance.view_all` · **Maturity:** Production

## Purpose

Clock-in/out for field workers and HR-driven team punch; geofenced branch sign-in; job-linked punches; daily-absence reporting; session aggregation feeding attendance reports and payroll. Server-side rules block clock-in when an employee is on approved leave or has reported an absence.

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `PunchViewModel` | `Views/Employee/PunchPage.xaml` | Full time-clock: history, filters, geofence, missed sign-out recovery, absence report |
| `EmployeeDashboardViewModel` | `EmployeeDashboardPage.xaml` | **Primary live punch path** — inline clock card (`GoToPunchAsync`) |
| `HrTeamPunchViewModel` | `HrTeamPunchPage.xaml` | Manager bulk clock-in/out for work teams |
| `HrAttendanceViewModel` | `HrAttendancePage.xaml` | HR attendance report from `PunchSession.Build` |

Shared view: `Views/Shared/AttendanceSessionTableView.xaml`; calendar helper `Helpers/AttendanceCalendarHelper.cs`.

> **Note:** `PunchPage` is registered but the dashboard's inline clock is the live entry point, so two punch implementations coexist (drift risk — see Risks).

## Models

| Model | Table |
|-------|-------|
| `TimePunch` | `time_punches` |
| `PunchSession` | client-side aggregate (`Build()` pairs in/out, applies shift-template late/OT/break rules, synthesizes absent/leave rows) |
| `BreakSlot` | jsonb `breaks` on `employee_shift_templates` |
| `DailyAbsence` | `daily_absences` |
| `EmployeeShiftTemplate` | `employee_shift_templates` |

## Storage methods

`GetPunchesAsync`, `GetLastPunchAsync`, `InsertPunchAsync`, `GetMyLastPunchAsync`, `GetMyPunchesAsync`, `GetEmployeesLastPunchAsync`, `InsertTeamPunchAsync`, `UpdatePunchAddressAsync`, `IsOnLeaveTodayAsync`, `GetDailyAbsencesAsync`, `ReportAbsenceAsync`, `GetBranchesAsync`, `GetShiftTemplatesAsync`.

## RPCs

`employee_insert_punch` (blocks on leave/absence; single uuid signature after `..._fix_employee_insert_punch_overload.sql`), `employee_get_my_punches`, `employee_get_last_punch`, `employee_update_punch_address`, `employee_is_on_leave_today`, `employee_report_absence` / `employee_upsert_daily_absence`, `employee_get_daily_absences`, `hr_get_employees_last_punch`.

## Geofencing

`BranchGeofenceService` reads `Company.EnforceBranchSignInRadius` + `BranchSignInRadiusMeters`, matches the employee's `Branch` to an active `Branch` record (`GetBranchesAsync`), and validates the punch coordinates by haversine distance via `LocationService` (Geoapify/Nominatim reverse geocode, with disk cache). Used by `PunchViewModel`, `EmployeeDashboardViewModel`, `HrTeamPunchViewModel`.

## Permissions

`attendance.view_team` (managers) and `attendance.view_all` (HR/admin) scope HR views via `EmployeeScopeService`. Any worker may punch (`CanPunch` is always true). Module gate: `CompanyModules.Attendance`. Pending-membership employees are blocked from punching.

## Realtime

`RealtimeService` subscribes to `time_punches` **inserts** filtered by `company_id` → `PunchChanged`. `InsertPunchAsync` also calls `NotifyPunchChanged()` for an immediate local echo. Subscribers: HR + employee dashboards, `HrAttendanceViewModel`, `HrEmployeeDashboardViewModel`.

## Offline

Failed punches are queued by `OfflineQueueService` (`offline_punch_queue` in SecureStorage) and replayed on connectivity restore (reverse-geocoding the address at replay time). Telemetry: `offline_punch_enqueued`, `offline_punch_replay`.

## Telemetry

`punch_inserted`, `punch_address_updated`, plus the offline/realtime events above.

## Interoperability

- **→ Payroll:** closed `PunchSession`s drive hours/days/overtime and late/early/absent penalties.
- **← Leave / Absence:** clock-in is blocked by `employee_is_on_leave_today` and `daily_absences`.
- **↔ Jobs:** punches can carry `job_id` (clock against a job).

## Risks & gaps

1. **Duplicate punch logic** between `PunchPage` and the dashboard inline clock — keep them in sync.
2. **Backdated clock-in:** server block checks `current_date`, not the punch `date_time`, so a backdated `in` could bypass the absence check.
3. **Offline replay** doesn't re-evaluate leave/absence at original intent time (server RPC will still reject if state changed), and lacks idempotency keys (duplicate-punch risk).
4. **Optimistic local state** (`SetLastPunch`) is set before sync on some paths — can briefly diverge from server truth.
5. **PGRST203 guardrail:** keep exactly one `employee_insert_punch(uuid,…)` signature.
