# Module — Payroll

> **Module key:** `payroll` · **Permissions:** `payments.view_payroll`, `payments.approve` · **Maturity:** Production (financially sensitive — change with extreme care)

## Purpose

Compute and approve worker pay for a pay period, producing payslips with itemized earnings/deductions, statutory withholdings (South African PAYE & UIF), year-to-date totals, and bank payment files / IRP5 records. Payroll **consumes** data from Attendance (sessions), Leave (paid/unpaid days), and Employee records (rates, statutory config).

## Architecture: dedicated calculation library

Payroll math is isolated in a separate project, **`KaiFlow.Payroll`**, referenced by the MAUI app. This keeps the financially-critical engine pure, testable, and free of UI/Supabase concerns.

| File | Responsibility |
|------|----------------|
| `PayrollCalculator.cs` | The core `Calculate(input) → result` engine |
| `PayrollModels.cs` | Input/result records (`PayrollCalculationInput/Result`, snapshots, line items, overrides) |
| `PayrollPolicy.cs` | Company payroll policy (penalties, statutory config, holiday rules, pay-basis defaults) |
| `SalaryResolver.cs` | Resolves effective salary/rates as-of a date from salary history |
| `SarsPayeCalculator.cs` | SARS monthly PAYE tax-table calculation (age-based rebates) |
| `PayrollPeriodHelper.cs` | Employment-in-period checks, pro-rating, monthly salary factor |
| `LeaveDayCalculator.cs` | Counts paid/unpaid leave days within a period (half-days aware) |
| `PayrollYtdHelper.cs` | Merges current result into prior YTD totals |
| `Irp5RecordBuilder.cs` | Builds SARS IRP5 tax-certificate records |
| `BankPaymentFileFormatter.cs` | Formats bank payment export files |
| `EmploymentPayrollDefaults.cs` | Default rates/config by employment type |

MAUI-side helpers in `KaiFlow.Timesheets.Maui/Helpers/` bridge the engine to data and UI:
`PayrollCalculationHelper`, `PayrollGenerationHelper`, `PayrollMapper`, `PayrollEmployeePersistence`, `PayrollAuditHelper`, `PayrollReadiness`, `PayrollYtdService`.

## The calculation pipeline

`PayrollCalculator.Calculate(PayrollCalculationInput)` (`KaiFlow.Payroll/PayrollCalculator.cs`) executes in this order:

1. **Employment guard** — returns `null` if the employee wasn't employed during the period (`PayrollPeriodHelper.IsEmployedInPeriod`).
2. **Salary resolution** — `SalaryResolver.ResolveAsOf` picks the salary/rates effective at `PeriodEnd` from salary history (so mid-history raises are honored).
3. **Pay basis resolution** — `ResolvePayBasis`: explicit `emp.PayBasis`, else inferred from which rate is set (monthly → hourly → daily), else policy default.
4. **Pro-rating** — `PayrollPeriodHelper.ProRateFactor` for mid-period joiners/leavers, unless `PayFullBaseSalary` override is set.
5. **Session aggregation** — closed, non-absent sessions → working days, late count, early count, overtime hours.
6. **Leave classification** — approved leave split into paid vs unpaid days (`LeaveDayCalculator.IsUnpaidLeave`), with overlap/leave-only day handling.
7. **Earnings** by pay basis:
   - **Monthly salary:** base salary × salary factor (full or pro-rated); overtime only if policy `AllowOvertimeForSalary`.
   - **Daily:** (days worked + paid leave days) × daily rate.
   - **Hourly:** (worked hours + paid-leave hours) × hourly rate.
   - Plus **public-holiday earnings** (policy-dependent), **overtime**, and **bonus** (override).
8. **Deductions:**
   - **Unpaid leave** (monthly basis): days × daily rate.
   - **Attendance penalties** (absent / late / early) per `PayrollPolicy` penalty modes (`per_day`, `threshold`, `per_occurrence`) — skippable via `WaivePenalties`.
   - **Fixed deductions:** medical aid, pension, union (`AddFixedEmployeeDeductions`).
   - **Manual adjustment** (override).
   - **Statutory** (non-contractors only): **UIF** (rate up to monthly ceiling, or fixed, unless `UifExempt`) and **PAYE** (manual override → fixed amount → SARS tax tables → flat percent).
9. **Totals:** gross = regular + overtime + bonus; net = max(0, gross − deductions).
10. **Notes:** human-readable explanation string (pro-rating, lates, absences, leave, holidays, overrides).
11. **YTD merge:** `PayrollYtdHelper.Merge(priorYtd, result)` if prior YTD supplied.

The result is an immutable `PayrollCalculationResult` record with full `EarningsLines` / `DeductionLines` for transparent payslips.

### Statutory detail (SA-specific)

```430:461:KaiFlow.Payroll/PayrollCalculator.cs
        if (!emp.UifExempt && grossPay > 0)
        {
            double? uif = null;
            if (emp.UifFixedAmount > 0)
                uif = emp.UifFixedAmount;
            else if (emp.UifRatePercent.HasValue && emp.UifRatePercent.Value > 0)
            {
                var ceiling = policy.Statutory.UifCeilingMonthly * periodFactor;
                var uifBase = Math.Min(grossPay, ceiling);
                uif = Math.Round(uifBase * emp.UifRatePercent.Value / 100.0, 2);
            }
            ...
```

PAYE supports manual override, employee fixed amount, **SARS tax tables** (`SarsPayeCalculator.CalculateMonthlyPaye` with date-of-birth rebates and tax-directive rate), or a flat percentage — in that precedence.

## Employee payroll configuration

`Models/Employee.cs` carries the per-employee payroll fields: `HourlyRate`, `DailyRate`, `WeeklyRate`, `MonthlySalary`, `OvertimeRate`, `DoubleTimeRate`, `PayBasisRaw`, `PayeRatePercent`, `PayeFixedAmount`, `UifExempt`, `UifRatePercent`, `UifFixedAmount`, plus medical/pension/union deductions and banking details. `WorkerType` (`employee`/`contractor`/`subcontractor`) determines whether statutory deductions apply.

## ViewModels & screens

| Side | ViewModel | Screen | Role |
|------|-----------|--------|------|
| HR | `HrPaymentsViewModel` | `HrPaymentsPage` | Generate/approve payroll for the company |
| HR | `HrPayrollSettingsViewModel` | `HrPayrollSettingsPage` | Configure company payroll policy |
| HR | `HrPayslipDetailViewModel` | `HrPayslipDetailPage` | View/edit a single payslip; apply overrides |
| Employee | `MyPayslipsViewModel` | `MyPayslipsPage` | Worker self-service payslip history |

Shared view `Views/Shared/PayrollLineItemsTableView.xaml` renders earnings/deductions consistently across HR and employee surfaces.

## Backend (RPCs / tables / migrations)

Payroll has the **most migration history** of any module, reflecting its sensitivity. Key migrations (`supabase/migrations`):

| Migration | Establishes |
|-----------|-------------|
| `..._payroll_upgrade_phase1.sql` | First-class payroll data model |
| `..._flexible_payroll_engine.sql` | Flexible pay-basis / policy-driven engine support |
| `..._employee_payroll_deductions.sql` | Per-employee fixed deductions & statutory config |
| `..._pay_full_salary_payslip_release.sql` | Full-salary override + payslip release flow |
| `..._payroll_hardening.sql` | Hardening / correctness fixes |

> Payment approvals are modeled by `Models/PaymentApproval.cs`; payroll persistence/audit flows through the MAUI payroll helpers and corresponding payslip tables. Exact table/RPC names are catalogued in `backend/01-database.md` / `backend/02-rpcs.md`.

## Permissions

- **View:** `payments.view_payroll` — Owner & HR Admin/Admin only by default. Managers and employees cannot see payroll.
- **Approve:** `payments.approve` — same set. `PermissionsService.CanApprovePayments` gates the approval action.
- Employees only ever see **their own** released payslips (via `MyPayslipsViewModel`), never company payroll.

## Exports

PDF payslips via **QuestPDF**; bank payment files via `BankPaymentFileFormatter`; tax certificates via `Irp5RecordBuilder`; Excel via **ClosedXML** through `ExportService`.

## Realtime / Offline

- Payroll is an **online, management-side** workflow — it is not part of the offline field-capture queue.
- Released payslips appear to employees on next refresh.

## Interoperability

- **← Attendance:** closed sessions drive hours/days/overtime and late/early/absent penalties.
- **← Leave:** approved leave drives paid vs unpaid day handling.
- **← Employees:** rates, statutory config, banking, worker type.
- **← Scheduling:** `DailyHours` / expected work pattern informs hourly derivation.

## Risks & guardrails

- **Do not destabilize the engine.** `PayrollCalculator` is pure and order-sensitive; changes can silently alter pay. Any change should be paired with calculation tests.
- **Money rounding** is done at statutory line level (`Math.Round(..., 2)`); keep rounding consistent if extending.
- **Contractors** are intentionally excluded from statutory deductions — preserve the `isContractor` branch.
- See `roadmap/01-risks-and-technical-debt.md` for payroll-specific hardening notes.
