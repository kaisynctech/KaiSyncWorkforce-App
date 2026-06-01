namespace KaiFlow.Payroll.Tests;

public class PayrollPeriodHelperTests
{
    [Fact]
    public void IsEmployedInPeriod_false_when_terminated_before_period()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 31);
        var termination = new DateOnly(2026, 4, 30);

        Assert.False(PayrollPeriodHelper.IsEmployedInPeriod(start, end, null, termination));
    }

    [Fact]
    public void IsEmployedInPeriod_false_when_starts_after_period()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 31);
        var employment = new DateOnly(2026, 6, 1);

        Assert.False(PayrollPeriodHelper.IsEmployedInPeriod(start, end, employment, null));
    }

    [Fact]
    public void ProRateFactor_half_when_joined_mid_period()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 31);
        var employment = new DateOnly(2026, 5, 16);

        var factor = PayrollPeriodHelper.ProRateFactor(start, end, employment, null);
        Assert.Equal(16 / 31.0, factor, 3);
    }

    [Fact]
    public void MonthlySalaryFactor_full_month_when_employed_before_month()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 25);
        Assert.Equal(1.0, PayrollPeriodHelper.MonthlySalaryFactor(start, end, null, null));
    }

    [Fact]
    public void MonthlySalaryFactor_pro_rates_mid_month_joiner()
    {
        var start = new DateOnly(2026, 5, 1);
        var end = new DateOnly(2026, 5, 25);
        var joined = new DateOnly(2026, 5, 22);
        Assert.Equal(10 / 31.0, PayrollPeriodHelper.MonthlySalaryFactor(start, end, joined, null), 3);
    }
}
