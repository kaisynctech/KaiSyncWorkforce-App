using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public static class PayrollCalculationHelper
{
    public static PayrollYtdTotals BuildPriorYtd(
        IEnumerable<PaymentApproval> allPayments,
        Guid employeeId,
        DateOnly periodEnd,
        Guid? excludePaymentId = null)
    {
        var prior = allPayments
            .Where(p => p.EmployeeId == employeeId
                        && p.PeriodEnd < periodEnd
                        && p.Id != excludePaymentId)
            .ToList();
        return PayrollYtdService.BuildPriorYtd(prior, employeeId, periodEnd);
    }

    public static IReadOnlyList<SalaryHistoryEntry> ToSalaryHistoryEntries(
        IEnumerable<EmployeeSalaryHistory> rows) =>
        rows.OrderBy(r => r.EffectiveDate)
            .Select(r => new SalaryHistoryEntry(r.EffectiveDate, r.MonthlySalary, r.HourlyRate, r.DailyRate))
            .ToList();

    public static PayrollCalculationInput BuildInput(
        Employee emp,
        PayrollPolicy policy,
        DateOnly periodStart,
        DateOnly periodEnd,
        IReadOnlyList<PayrollSessionSnapshot> sessions,
        IReadOnlyList<PayrollLeaveSnapshot> leave,
        IReadOnlyList<PayrollAbsenceSnapshot> absences,
        double dailyHours,
        double companyOtMult,
        PayrollPayslipOverrides? overrides = null,
        PayrollYtdTotals? priorYtd = null,
        IReadOnlyList<SalaryHistoryEntry>? salaryHistory = null) =>
        new(
            PayrollGenerationHelper.NormalizePayBasis(PayrollMapper.ToSnapshot(emp)),
            policy,
            periodStart,
            periodEnd,
            sessions,
            leave,
            absences,
            dailyHours,
            companyOtMult,
            overrides,
            priorYtd,
            salaryHistory);

    public static (int lateMin, int otMin, double companyOtMult) ReadTimingSettings(
        IReadOnlyDictionary<string, object> settings)
    {
        int lateMin = settings.TryGetValue("late_threshold_minutes", out var lv) && int.TryParse(lv?.ToString(), out var li) ? li : 30;
        int otMin = settings.TryGetValue("ot_start_after_minutes", out var ov) && int.TryParse(ov?.ToString(), out var oi) ? oi : 30;
        double companyOtMult = settings.TryGetValue("overtime_multiplier", out var om)
            && double.TryParse(om?.ToString(), out var omD) && omD > 0 ? omD : 1.5;
        return (lateMin, otMin, companyOtMult);
    }
}
