using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Helpers;

public static class PayrollYtdService
{
    public static PayrollYtdTotals BuildPriorYtd(
        IEnumerable<PaymentApproval> allPayments,
        Guid employeeId,
        DateOnly currentPeriodEnd)
    {
        var rows = allPayments
            .Where(p => p.EmployeeId == employeeId && p.PeriodEnd < currentPeriodEnd)
            .Select(ToRow);
        return PayrollYtdHelper.Aggregate(rows, currentPeriodEnd);
    }

    public static PayrollYtdPayslipRow ToRow(PaymentApproval p) => new(
        p.PeriodEnd,
        p.StatusRaw,
        p.GrossPay,
        p.NetPay,
        p.Deductions,
        p.DeductionLines.ToList());

    public static void StoreYtd(PaymentApproval payment, PayrollYtdTotals? ytd) =>
        payment.YtdJson = ytd == null ? null : JsonConvert.SerializeObject(ytd);
}

public static class PayrollPeriodLockHelper
{
    public static bool IsLocked(
        IEnumerable<PayrollPeriodLock> locks,
        Guid companyId,
        DateOnly periodStart,
        DateOnly periodEnd) =>
        locks.Any(l =>
            l.CompanyId == companyId
            && l.PeriodStart == periodStart
            && l.PeriodEnd == periodEnd);
}

public static class PayrollRegisterExporter
{
    public static IReadOnlyList<string[]> BuildRows(
        IEnumerable<PaymentApproval> payments,
        IReadOnlyDictionary<Guid, Employee> employees)
    {
        return payments
            .OrderBy(p => employees.GetValueOrDefault(p.EmployeeId)?.FullName ?? "")
            .Select(p =>
            {
                var emp = employees.GetValueOrDefault(p.EmployeeId);
                return new[]
                {
                    emp?.FullName ?? "Unknown",
                    emp?.Branch ?? p.BranchLabel ?? "",
                    p.CostCenter ?? emp?.CostCenter ?? "",
                    p.PeriodLabel,
                    p.PayBasisRaw ?? "",
                    p.BaseSalary.ToString("F2"),
                    p.GrossPay.ToString("F2"),
                    p.Deductions.ToString("F2"),
                    p.NetPay.ToString("F2"),
                    p.StatusRaw,
                    p.Version.ToString()
                };
            }).ToList();
    }

    public static string[] Headers =>
    [
        "Employee", "Branch", "Cost Center", "Period", "Pay Basis",
        "Base Salary", "Gross", "Deductions", "Net Pay", "Status", "Version"
    ];
}
