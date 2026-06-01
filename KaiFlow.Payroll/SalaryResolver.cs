namespace KaiFlow.Payroll;

public record SalaryHistoryEntry(DateOnly EffectiveDate, double MonthlySalary, double HourlyRate, double DailyRate);

public static class SalaryResolver
{
    public static (double MonthlySalary, double HourlyRate, double DailyRate) ResolveAsOf(
        double currentMonthly,
        double currentHourly,
        double currentDaily,
        DateOnly asOfDate,
        IReadOnlyList<SalaryHistoryEntry>? history)
    {
        if (history == null || history.Count == 0)
            return (currentMonthly, currentHourly, currentDaily);

        var applicable = history
            .Where(h => h.EffectiveDate <= asOfDate)
            .OrderByDescending(h => h.EffectiveDate)
            .FirstOrDefault();

        return applicable != null
            ? (applicable.MonthlySalary, applicable.HourlyRate, applicable.DailyRate)
            : (currentMonthly, currentHourly, currentDaily);
    }
}
