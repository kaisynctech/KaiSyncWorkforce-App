using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;

namespace KaiFlow.Timesheets.Helpers;

public record PayrollGenerationResult(
    int Created,
    int SkippedDuplicate,
    int SkippedIneligible);

public static class PayrollGenerationHelper
{
    public static async Task<PayrollGenerationResult> GenerateAsync(
        IStorageService storage,
        Guid companyId,
        DateOnly periodStart,
        DateOnly periodEnd,
        IEnumerable<Employee> employees,
        IEnumerable<PaymentApproval> existingPayments,
        Dictionary<string, object> settings,
        string? generatedByName,
        IReadOnlyCollection<Guid>? onlyEmployeeIds = null)
    {
        var policy = PayrollPolicy.FromSettings(settings);
        var (lateMin, otMin, companyOtMult) = PayrollCalculationHelper.ReadTimingSettings(settings);

        var existingIds = existingPayments
            .Where(p => p.PeriodStart == periodStart && p.PeriodEnd == periodEnd && p.StatusRaw != "rejected")
            .Select(p => p.EmployeeId)
            .ToHashSet();

        var templates = await storage.GetShiftTemplatesAsync(companyId);
        var templateMap = templates.ToDictionary(t => t.Id, t => t);
        var allPunches = await storage.GetPunchesAsync(companyId, periodStart, periodEnd);
        var allLeave = await storage.GetLeaveRequestsAsync(companyId);
        var allAbsences = await storage.GetDailyAbsencesRangeAsync(companyId, periodStart, periodEnd);
        var salaryHistoryRows = await storage.GetEmployeeSalaryHistoryAsync(companyId);
        var salaryHistoryByEmployee = salaryHistoryRows.GroupBy(h => h.EmployeeId)
            .ToDictionary(g => g.Key, g => PayrollCalculationHelper.ToSalaryHistoryEntries(g));

        var empList = employees.Where(e => e.IsActive).ToList();
        if (onlyEmployeeIds is { Count: > 0 })
            empList = empList.Where(e => onlyEmployeeIds.Contains(e.Id)).ToList();

        var empMap = empList.ToDictionary(e => e.Id, e => e);
        var sessions = PunchSession.Build(allPunches, empMap, templateMap, lateMin, otMin);

        var created = 0;
        var skippedDuplicate = 0;
        var skippedIneligible = 0;

        foreach (var emp in empList)
        {
            if (!PayrollReadinessHelper.IsEligibleForPeriod(emp, periodStart, periodEnd))
            {
                skippedIneligible++;
                continue;
            }

            if (existingIds.Contains(emp.Id))
            {
                skippedDuplicate++;
                continue;
            }

            if (!PayrollReadinessHelper.IsEligibleForPayroll(emp))
            {
                skippedIneligible++;
                continue;
            }

            EmployeeShiftTemplate? tmpl = null;
            if (emp.ShiftTemplateId.HasValue)
                templateMap.TryGetValue(emp.ShiftTemplateId.Value, out tmpl);
            var dailyHours = tmpl?.PaidHours ?? emp.DailyHours;

            var empSessions = sessions
                .Where(s => s.EmployeeId == emp.Id && !s.IsOpen)
                .Select(PayrollMapper.ToSnapshot)
                .ToList();

            salaryHistoryByEmployee.TryGetValue(emp.Id, out var salaryHistory);
            var priorYtd = PayrollCalculationHelper.BuildPriorYtd(existingPayments, emp.Id, periodEnd);

            var result = PayrollCalculator.Calculate(PayrollCalculationHelper.BuildInput(
                emp,
                policy,
                periodStart,
                periodEnd,
                empSessions,
                allLeave.Where(r => r.EmployeeId == emp.Id).Select(PayrollMapper.ToSnapshot).ToList(),
                allAbsences.Where(a => a.EmployeeId == emp.Id).Select(PayrollMapper.ToSnapshot).ToList(),
                dailyHours,
                companyOtMult,
                salaryHistory: salaryHistory,
                priorYtd: priorYtd));

            if (result == null)
            {
                skippedIneligible++;
                continue;
            }

            var payment = new PaymentApproval
            {
                EmployeeId = emp.Id,
                CompanyId = companyId,
                PeriodStart = periodStart,
                PeriodEnd = periodEnd,
                StatusRaw = "pending",
                CreatedAt = DateTime.UtcNow,
                AuditLogJson = "[]",
                BranchLabel = emp.Branch,
                CostCenter = emp.CostCenter,
                Version = 1
            };
            PayrollMapper.ApplyResult(payment, result);
            PayrollMapper.StorePolicySnapshot(payment, policy);
            PayrollAuditHelper.Append(payment, "generated", generatedByName);

            await storage.CreatePaymentApprovalAsync(payment);
            existingIds.Add(emp.Id);
            created++;
        }

        return new PayrollGenerationResult(created, skippedDuplicate, skippedIneligible);
    }

    /// <summary>
    /// Monthly salary always wins unless explicitly set to hourly/daily.
    /// </summary>
    public static PayrollEmployeeSnapshot NormalizePayBasis(PayrollEmployeeSnapshot emp)
    {
        if (emp.MonthlySalary <= 0) return emp;

        if (string.IsNullOrWhiteSpace(emp.PayBasis)
            || emp.PayBasis is PayBasis.MonthlySalary
            || emp.PayBasis == "hourly")
            return emp with { PayBasis = PayBasis.MonthlySalary };

        return emp;
    }
}
