# Module — Scheduling & Shifts

> **Module key:** `scheduling` · **Permissions:** none dedicated (role/module-gated) · **Maturity:** Production

## Purpose

HR shift/calendar scheduling; employee shift accept/decline; shift templates that define paid hours and breaks for both attendance session aggregation and payroll; a configurable default template for onboarding.

## ViewModels & screens

| ViewModel | Screen |
|-----------|--------|
| `HrSchedulingViewModel` | `HrSchedulingPage.xaml` |
| `MyShiftsViewModel` | `MyShiftsPage.xaml` |
| `HrShiftTemplatesViewModel` | `HrShiftTemplatesPage.xaml` |
| `HrCreateTimeTemplateViewModel` | `HrCreateTimeTemplatePage.xaml` |

## Models

`CalendarEvent` (`calendar_events`; `attendee_ids`, `attendance_responses`, `event_type`, `linked_job_id`), `EmployeeShiftTemplate` (`employee_shift_templates`; `is_default`), `BreakSlot` (jsonb `breaks`).

## Storage methods

`GetCalendarEventsAsync`, `CreateCalendarEventAsync`, `UpdateCalendarEventAsync`, `UpdateCalendarEventAttendanceAsync`, shift-template CRUD (`GetShiftTemplatesAsync`, `CreateShiftTemplateAsync`, `UpdateShiftTemplateAsync`, `DeleteShiftTemplateAsync`, `SetDefaultShiftTemplateAsync`), plus leave/absence reads for conflict warnings.

## RPCs / migrations

`employee_get_calendar_events_for_worker`, `employee_update_calendar_event_attendance`, shift-template security-definer RPCs, `hr_set_default_shift_template`. Migrations: `..._add_employee_shift_templates.sql`, `..._employee_shift_templates_rls_and_breaks.sql`, `..._shift_template_security_definer_rpcs.sql`, `..._employee_shift_template_default.sql`, `..._shifts_job_link.sql`.

## Permissions

No dedicated keys — gated by HR role + `CompanyModules.Scheduling`. Employees access via My Shifts; HR manages templates from payroll settings.

## Realtime / Offline / Telemetry

- No realtime subscription for `calendar_events`; no offline support.
- Telemetry: `shift_attendance_updated`.

## Behavior

- `HrSchedulingViewModel.CreateEventAsync` warns (but allows override) if an assignee is on leave/absent.
- `MyShiftsViewModel` accept/decline → `UpdateCalendarEventAttendanceAsync(..., "accepted"|"declined")`.
- HR creates events via direct PostgREST insert; employees update attendance via RPC (intentional asymmetry).

## Interoperability

- **→ Attendance & Payroll:** shift templates feed `PunchSession` (late/OT/paid-hours) and `PayrollGenerationHelper` (`dailyHours`).
- **↔ Jobs:** `calendar_events.linked_job_id` exists (job-linked shifts).

## Risks & gaps

1. **Single default template per company** (`hr_set_default_shift_template`) affects all new-employee onboarding.
2. **Job link not prompted** in the current HR create flow despite `linked_job_id` existing.
