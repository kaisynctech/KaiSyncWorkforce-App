using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public record PayrollReadinessInfo(
    bool IsReady,
    string StatusLabel,
    string StatusColor,
    IReadOnlyList<string> Issues);

public record PayrollGeneratePreview(
    int ReadyCount,
    int MissingRatesCount,
    int MissingShiftCount,
    int MissingBankCount,
    int DuplicateCount,
    int NotInPeriodCount,
    int ContractorCount,
    IReadOnlyList<string> DetailLines);

public static class PayrollReadinessHelper
{
    public static PayrollReadinessInfo Assess(Employee emp)
    {
        var issues = new List<string>();

        if (!emp.IsActive)
            issues.Add("Employee is inactive");

        if (emp.MonthlySalary <= 0 && emp.HourlyRate <= 0 && emp.DailyRate <= 0)
            issues.Add("No monthly salary or hourly/daily rate");

        if (!emp.ShiftTemplateId.HasValue)
            issues.Add("No shift template — grace period and OT may not apply");

        if (!emp.HasBankingDetails)
            issues.Add("Banking details not set");

        if (emp.WorkerTypeRaw is "contractor" or "subcontractor")
            issues.Add("Contractor — review statutory deductions");

        if (issues.Count == 0)
            return new PayrollReadinessInfo(true, "Payroll ready", "#166534", issues);

        if (issues.Any(i => i.Contains("salary") || i.Contains("rate")))
            return new PayrollReadinessInfo(false, "Missing pay rates", "#991B1B", issues);

        return new PayrollReadinessInfo(false, "Needs attention", "#B45309", issues);
    }

    public static bool IsEligibleForPayroll(Employee emp) =>
        emp.IsActive && (emp.MonthlySalary > 0 || emp.HourlyRate > 0 || emp.DailyRate > 0);

    public static bool IsEligibleForPeriod(Employee emp, DateOnly periodStart, DateOnly periodEnd)
    {
        if (!IsEligibleForPayroll(emp)) return false;
        if (emp.EmploymentDate.HasValue && emp.EmploymentDate.Value > periodEnd) return false;
        if (emp.TerminationDate.HasValue && emp.TerminationDate.Value < periodStart) return false;
        return true;
    }

    public static PayrollGeneratePreview BuildPreview(
        IEnumerable<Employee> employees,
        DateOnly periodStart,
        DateOnly periodEnd,
        HashSet<Guid> existingEmployeeIds)
    {
        int ready = 0, missingRates = 0, missingShift = 0, missingBank = 0, duplicate = 0, notInPeriod = 0, contractor = 0;
        var details = new List<string>();

        foreach (var emp in employees.Where(e => e.IsActive))
        {
            if (!IsEligibleForPeriod(emp, periodStart, periodEnd))
            {
                notInPeriod++;
                continue;
            }

            if (existingEmployeeIds.Contains(emp.Id))
            {
                duplicate++;
                details.Add($"{emp.FullName}: payslip already exists for this period");
                continue;
            }

            var info = Assess(emp);
            if (emp.MonthlySalary <= 0 && emp.HourlyRate <= 0 && emp.DailyRate <= 0)
                missingRates++;
            if (!emp.ShiftTemplateId.HasValue)
                missingShift++;
            if (!emp.HasBankingDetails)
                missingBank++;
            if (emp.WorkerTypeRaw is "contractor" or "subcontractor")
                contractor++;

            if (info.IsReady || (emp.MonthlySalary > 0 || emp.HourlyRate > 0))
                ready++;
            else
                details.Add($"{emp.FullName}: {string.Join(", ", info.Issues)}");
        }

        return new PayrollGeneratePreview(ready, missingRates, missingShift, missingBank, duplicate, notInPeriod, contractor, details);
    }
}
