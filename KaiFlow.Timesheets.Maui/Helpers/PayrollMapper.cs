using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Helpers;

public static class PayrollMapper
{
    public static PayrollEmployeeSnapshot ToSnapshot(Employee emp)
    {
        var snap = new PayrollEmployeeSnapshot(
            emp.Id,
            emp.MonthlySalary,
            emp.HourlyRate,
            emp.DailyRate,
            emp.DailyHours,
            emp.WorkDaysWeekly,
            emp.OvertimeRate,
            string.IsNullOrWhiteSpace(emp.PayBasisRaw) ? null : emp.PayBasisRaw,
            emp.PayeRatePercent,
            emp.UifExempt,
            emp.EmploymentDate,
            emp.TerminationDate,
            emp.WorkerTypeRaw,
            emp.MedicalAidDeduction,
            emp.PensionDeduction,
            emp.UnionDeduction,
            emp.PayFullMonthlySalary,
            emp.PayeFixedAmount,
            emp.UifRatePercent,
            emp.UifFixedAmount,
            emp.DateOfBirth,
            emp.TaxDirectiveRatePercent,
            emp.CostCenter);
        return PayrollGenerationHelper.NormalizePayBasis(snap);
    }

    public static PayrollSessionSnapshot ToSnapshot(PunchSession s) => new(
        s.Date, s.RegularHours, s.OvertimeHours, s.IsLate, s.IsLeftEarly, s.IsOpen);

    public static PayrollLeaveSnapshot ToSnapshot(LeaveRequest r) => new(
        r.LeaveType, r.StartDate, r.EndDate, r.HalfDayStart, r.HalfDayEnd, r.TotalDays, r.IsApproved);

    public static PayrollAbsenceSnapshot ToSnapshot(DailyAbsence a) => new(a.Date);

    public static PayrollPayslipOverrides ToOverrides(PaymentApproval p) => new(
        p.PayFullBaseSalary,
        p.WaivePenalties,
        p.ManualPayeOverride,
        p.ManualAdjustment,
        p.AdjustmentNote,
        p.BonusAmount,
        p.BonusNote);

    public static void ApplyResult(PaymentApproval payment, PayrollCalculationResult result)
    {
        payment.PayBasisRaw = result.PayBasis;
        payment.BaseSalary = result.BaseSalary;
        payment.WorkingDays = result.WorkingDays;
        payment.LeaveDays = result.LeaveDays;
        payment.AbsentDays = result.AbsentDays;
        payment.UnpaidLeaveDays = result.UnpaidLeaveDays;
        payment.RegularHours = result.RegularHours;
        payment.OvertimeHours = result.OvertimeHours;
        payment.RegularPay = result.RegularPay;
        payment.OvertimePay = result.OvertimePay;
        payment.GrossPay = result.GrossPay;
        payment.Deductions = result.TotalDeductions;
        payment.NetPay = result.NetPay;
        payment.Notes = result.Notes;
        payment.EarningsBreakdownJson = JsonConvert.SerializeObject(result.EarningsLines);
        payment.DeductionsBreakdownJson = JsonConvert.SerializeObject(result.DeductionLines);
        PayrollYtdService.StoreYtd(payment, result.YtdTotals);
    }

    public static void StorePolicySnapshot(PaymentApproval payment, PayrollPolicy policy) =>
        payment.PolicySnapshotJson = JsonConvert.SerializeObject(policy);

    public static bool IsPayrollEligible(Employee emp) =>
        PayrollReadinessHelper.IsEligibleForPayroll(emp);
}
