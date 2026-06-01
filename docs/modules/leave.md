# Module — Leave

> **Module key:** `leave` · **Permissions:** `leave.view_all`, `leave.approve` · **Maturity:** Production

## Purpose

Employee self-service leave requests with attachments; HR apply-on-behalf; approve/decline workflow; balance display; and integration that **blocks attendance** when leave is approved. Leave is a **first-class HR sidebar tab** (index 20) and an employee More-menu entry.

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `MyLeaveViewModel` | `MyLeavePage.xaml` | Employee submit/edit-pending + balances |
| `HrApplyLeaveViewModel` | `HrApplyLeavePage.xaml` | HR applies on behalf of an employee |
| `HrEmployeesViewModel` | (Employees / Leave admin) | Approve/decline (`LeaveRequestDisplay`) |
| `HrDashboardViewModel` | Leave tab (20) | Dashboard leave queue + approve/reject |

## Models

`LeaveRequest` (`leave_requests`), `LeaveRequestDisplay` (UI record), `LeavePolicy` (static BCEA-style defaults), `LeaveBalance` (computed in VM).

## Approval flow

```
create (employee_submit_leave_request or PostgREST)  →  status=pending
HR approve → UpdateLeaveStatusAsync(id, "approved")
HR decline → UpdateLeaveStatusAsync(id, "declined", note)
employee edits pending → UpdatePendingLeaveAsync
approved leave → employee_is_on_leave_today → punch block
realtime: leave_requests → LeaveChanged → Hr list refresh
```

## Storage methods

`GetLeaveRequestsAsync`, `GetMyLeaveRequestsAsync`, `CreateLeaveRequestAsync`, `UpdateLeaveStatusAsync`, `UpdatePendingLeaveAsync`, `UploadLeaveAttachmentAsync`, `IsOnLeaveTodayAsync`.

## RPCs / migrations

`employee_submit_leave_request`, `employee_get_leave_requests`, `employee_get_company_approved_leave`, employee update-pending RPC, `employee_is_on_leave_today`. Migrations: `..._leave_requests_core.sql`, `..._leave_requests_anon_rpc_and_attachment.sql`, `..._leave_requests_employee_update_rpc.sql`, `..._employee_get_leave_requests_rpc.sql`, `..._employee_is_on_leave_today.sql`, `..._punch_block_leave_absence.sql`.

## Permissions

`leave.view_all` (HR leave admin nav, tab 20) and `leave.approve` (approve/decline). Module gate: `CompanyModules.Leave`.

## Realtime / Offline

- **Realtime:** `leave_requests` (all events) → `LeaveChanged` → HR list refresh.
- **Offline:** none (leave submission requires connectivity).

## Interoperability

- **→ Attendance:** approved leave blocks clock-in (`employee_is_on_leave_today`).
- **→ Payroll:** approved leave splits into paid/unpaid days consumed by `PayrollCalculator` (`LeaveDayCalculator`).
- **→ Scheduling:** scheduling warns when assigning shifts to employees on leave.

## Risks & gaps

1. **Balances are client-computed** from `LeavePolicy` defaults, not server entitlements — can drift from company policy.
2. **Leave-type string drift:** app strings (e.g. `"Annual Leave"`) vs early CHECK constraints (`'annual'`) — verify live DB constraints match app values.
3. **Enforcement depends on `CURRENT_DATE`** semantics in `employee_is_on_leave_today`.
