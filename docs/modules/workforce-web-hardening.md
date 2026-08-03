# Workforce web — legacy objects (do not use)

KaiSync web (`kaisync-web`) is the product source of truth for Workforce. Prefer these live objects:

| Use | Do not use |
|---|---|
| `employee_shift_templates` (UUID) | Legacy `shift_templates` (bigint) |
| `branches` (+ `employees.branch_id`) | `company_branches` for employee org assignment |
| Current `time_punches` | Any legacy bigint `punches` table |
| `work_teams.member_ids[]` + `leader_employee_id` | Invented `work_team_members` join table |
| `company_settings.payroll_preferences` / `leave_settings` | Invented `payroll_settings` / `leave_types` tables |
| `payment_approvals` | Invented `payroll_runs` / `payslips` tables |

Dual-write mirrors kept for MAUI readers (do not drop without MAUI migration):

- `employees.branch` (text) alongside `branch_id`
- `employees.cost_center` alongside `department`
- `employees.manager_user_id` alongside `manager_id`

## Soft-delete policy

1. **Employees:** prefer `set_employee_active` / `setEmployeeActive(false)`. Hard `delete_employee` is owner/HR only for purge.
2. **Work teams:** prefer `is_active = false` (`setWorkTeamActive`). No hard delete in web UI.

## Security follow-ups (DB — not applied in Phase 5)

- Review `EXECUTE` grants on `hr_generate_payroll`, `hr_lock_payroll_period`, `hr_unlock_payroll_period`, `hr_recalculate_payslip` (historically permissive). Revoke anon / add permission checks only via approved migration.
