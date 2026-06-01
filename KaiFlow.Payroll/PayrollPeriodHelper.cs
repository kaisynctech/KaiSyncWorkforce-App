namespace KaiFlow.Payroll;

public static class PayrollPeriodHelper
{
    public static (DateOnly Start, DateOnly End, bool IsValid) EffectivePeriod(
        DateOnly periodStart,
        DateOnly periodEnd,
        DateOnly? employmentDate,
        DateOnly? terminationDate)
    {
        var start = periodStart;
        var end = periodEnd;

        if (employmentDate.HasValue && employmentDate.Value > start)
            start = employmentDate.Value;

        if (terminationDate.HasValue && terminationDate.Value < end)
            end = terminationDate.Value;

        return (start, end, end >= start);
    }

    public static bool IsEmployedInPeriod(
        DateOnly periodStart,
        DateOnly periodEnd,
        DateOnly? employmentDate,
        DateOnly? terminationDate)
    {
        if (employmentDate.HasValue && employmentDate.Value > periodEnd)
            return false;
        if (terminationDate.HasValue && terminationDate.Value < periodStart)
            return false;
        return true;
    }

    public static double ProRateFactor(
        DateOnly periodStart,
        DateOnly periodEnd,
        DateOnly? employmentDate,
        DateOnly? terminationDate)
    {
        var (effStart, effEnd, valid) = EffectivePeriod(periodStart, periodEnd, employmentDate, terminationDate);
        if (!valid) return 0;

        var periodDays = periodEnd.DayNumber - periodStart.DayNumber + 1;
        var effectiveDays = effEnd.DayNumber - effStart.DayNumber + 1;
        return periodDays > 0 ? effectiveDays / (double)periodDays : 0;
    }

    /// <summary>
    /// Salary factor for monthly-paid employees. Returns 1.0 when employed for the
    /// full calendar month. Pro-rates only for joiners/leavers within that month.
    /// Does not reduce salary just because payroll is generated before month-end.
    /// </summary>
    public static double MonthlySalaryFactor(
        DateOnly periodStart,
        DateOnly periodEnd,
        DateOnly? employmentDate,
        DateOnly? terminationDate)
    {
        var monthStart = new DateOnly(periodEnd.Year, periodEnd.Month, 1);
        var daysInMonth = DateTime.DaysInMonth(periodEnd.Year, periodEnd.Month);
        var monthEnd = new DateOnly(periodEnd.Year, periodEnd.Month, daysInMonth);

        if (employmentDate.HasValue && employmentDate.Value > monthEnd) return 0;
        if (terminationDate.HasValue && terminationDate.Value < monthStart) return 0;

        var effStart = monthStart;
        if (employmentDate.HasValue && employmentDate.Value > effStart)
            effStart = employmentDate.Value;

        var effEnd = monthEnd;
        if (terminationDate.HasValue && terminationDate.Value < effEnd)
            effEnd = terminationDate.Value;

        if (effEnd < effStart) return 0;

        if (effStart <= monthStart && effEnd >= monthEnd)
            return 1.0;

        var employedDays = effEnd.DayNumber - effStart.DayNumber + 1;
        return employedDays / (double)daysInMonth;
    }
}
