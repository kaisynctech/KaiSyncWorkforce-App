namespace KaiFlow.Payroll;

public static class LeaveDayCalculator
{
    public static double CountDaysInPeriod(
        DateOnly start,
        DateOnly end,
        DateOnly periodStart,
        DateOnly periodEnd,
        bool halfDayStart,
        bool halfDayEnd,
        double totalDaysHint)
    {
        var overlapStart = start < periodStart ? periodStart : start;
        var overlapEnd = end > periodEnd ? periodEnd : end;
        if (overlapEnd < overlapStart) return 0;

        if (overlapStart == overlapEnd && overlapStart == start && overlapEnd == end && totalDaysHint > 0)
            return totalDaysHint;

        double days = 0;
        for (var d = overlapStart; d <= overlapEnd; d = d.AddDays(1))
        {
            if (d == start && d == end)
            {
                if (totalDaysHint > 0 && totalDaysHint < 1)
                    days += totalDaysHint;
                else if (halfDayStart || halfDayEnd)
                    days += 0.5;
                else
                    days += 1;
            }
            else if (d == start && halfDayStart)
                days += 0.5;
            else if (d == end && halfDayEnd)
                days += 0.5;
            else
                days += 1;
        }

        return days;
    }

    public static bool IsUnpaidLeave(string leaveType) =>
        leaveType.Equals("Unpaid Leave", StringComparison.OrdinalIgnoreCase);
}
