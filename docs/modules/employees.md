# Module — Employees

> **Module key:** `employees` · **Permissions:** `employees.view`, `employees.create`, `employees.edit` · **Maturity:** Production

## Purpose

The system of record for people: employee profiles, access levels, worker types, employment/payroll configuration, documents, registration/approval, multi-company membership, work teams, and the manager/team scoping that drives "team" vs "all" visibility across other modules.

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `HrEmployeesViewModel` | `HrEmployeesPage.xaml` | Roster; sub-tabs Employees / Teams / Time Templates; leave admin actions |
| `HrCreateEmployeeViewModel` | `HrCreateEmployeePage.xaml` | Create employee |
| `HrEditEmployeeViewModel` | `HrEditEmployeePage.xaml` | Edit employee + payroll config |
| `HrEmployeeDashboardViewModel` | `HrEmployeeDashboardPage.xaml` | Per-employee 360° view |
| `HrImportEmployeesViewModel` | `HrImportEmployeesPage.xaml` | Bulk import (Excel template) |
| `HrWorkTeamsViewModel` | `HrWorkTeamsPage.xaml` | Work teams |
| `MyProfileViewModel` | `MyProfilePage.xaml` | Employee self-profile |
| `MyDocumentsViewModel` | `MyDocumentsPage.xaml` | Employee documents |

Self-registration & onboarding: `EmployeeSelfRegisterViewModel`, `EmployeeRegisterVerifyViewModel`, `EmployeeRegistrationStatusViewModel`, `EmployeeLinkCompanyViewModel`, `EmployeeMandatoryPasswordViewModel`, `EmployeeCompanySelectorViewModel`.

## Models

`Employee` (`employees`), `EmployeeMembership`, `EmployeeDocument` (`employee_documents`), `WorkTeam` (`work_teams`), `EmployeeShiftTemplate`, `Branch`, `ManagerOption`, `EmployeeImport*`, `SelfRegisterResult`.

`Employee` carries identity (`name`, `surname`, `employee_code`), classification (`access_level`, `worker_type`, `employment_type`), payroll config (rates, PAYE/UIF, deductions, banking), and `registration_status`.

## Scoping

`EmployeeScopeService` filters employees/teams by manager line + work-team membership + permission keys (`attendance.view_team` vs `attendance.view_all`, etc.), giving managers a team-scoped view while HR/admins see all.

## Storage methods

Employee CRUD, `GetMyMembershipsAsync`, `GetEmployeeForCompanyAsync`, self-register/approve/reject (`employee_self_register`, `approve_pending_employee`, `reject_pending_employee`), `hr_delete_employee_safe`, document upload, work-team CRUD, import parsing.

## RPCs / migrations

`employee_self_register`, `approve_pending_employee`, `reject_pending_employee`, `hr_delete_employee_safe`, `employee_get_my_memberships`(`_by_code`), `link_employee_profile`. Migrations: `..._employee_email_auth.sql`, `..._employee_self_registration.sql`, `..._fix_employee_self_registration.sql`, `..._multi_company_memberships_notifications.sql`, `..._employee_banking_audit_and_hr_notify.sql`, `..._employee_documents_storage_and_update.sql`, `..._employee_resolve_company_fields.sql`.

## Permissions / gating

`employees.view/create/edit`. HR nav: `ShowEmployeesNav = CompanyModules.Employees && EmployeesView`. Banking changes raise HR notifications/audit.

## Realtime

Account channel on `employees` (`user_id`) → `MembershipChanged` (e.g. approval status changes propagate to the company selector).

## Interoperability

- **Foundation for every module** — employees are assignees, punchers, payees, leave applicants, reporters, task owners.
- **↔ Contractors:** member employees can be linked to contractors.
- **↔ Payroll:** rates/statutory config live on the employee.

## Risks & gaps

1. **Registration/approval has many states** (`pending`/`active`/`rejected`) spread across self-register, link-company, and approval flows — keep state transitions consistent.
2. **Legacy alias mapping** (`hr`/`hrAdmin` → `hr_admin`) exists in both SQL and C# — keep aligned.
