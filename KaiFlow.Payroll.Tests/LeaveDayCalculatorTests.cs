namespace KaiFlow.Payroll.Tests;

public class LeaveDayCalculatorTests
{
    [Fact]
    public void Single_half_day_counts_as_half()
    {
        var d = new DateOnly(2026, 5, 10);
        var result = LeaveDayCalculator.CountDaysInPeriod(
            d, d, d, d, halfDayStart: true, halfDayEnd: false, totalDaysHint: 0.5);
        Assert.Equal(0.5, result);
    }

    [Fact]
    public void Three_day_span_with_half_start_is_two_and_half()
    {
        var start = new DateOnly(2026, 5, 10);
        var end = new DateOnly(2026, 5, 12);
        var result = LeaveDayCalculator.CountDaysInPeriod(
            start, end, start, end, halfDayStart: true, halfDayEnd: false, totalDaysHint: 0);
        Assert.Equal(2.5, result);
    }

    [Fact]
    public void Overlap_with_period_clips_correctly()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 31);
        var periodStart = new DateOnly(2026, 5, 10);
        var periodEnd = new DateOnly(2026, 5, 20);
        var result = LeaveDayCalculator.CountDaysInPeriod(
            start, end, periodStart, periodEnd, false, false, 0);
        Assert.Equal(11, result);
    }
}
