namespace KaiFlow.Payroll.Tests;

public class PayrollUpgradeTests
{
    [Fact]
    public void Ytd_merge_includes_current_payslip()
    {
        var prior = new PayrollYtdTotals(10000, 7500, 2500, 2000, 500, 10000, 1);
        var current = new PayrollCalculationResult(
            PayBasis.MonthlySalary, 20000, 20, 0, 0, 0, 160, 0,
            20000, 0, 20000, 5000, 15000, 0, 0,
            [new PayrollLineItem("Salary", 20000, "earning")],
            [new PayrollLineItem("PAYE", 4000, "statutory"), new PayrollLineItem("UIF", 200, "statutory")],
            null);

        var merged = PayrollYtdHelper.Merge(prior, current);

        Assert.Equal(30000, merged.GrossPay);
        Assert.Equal(6000, merged.Paye);
        Assert.Equal(700, merged.Uif);
        Assert.Equal(2, merged.PayslipCount);
    }

    [Fact]
    public void Salary_history_resolves_effective_rate()
    {
        var history = new List<SalaryHistoryEntry>
        {
            new(new DateOnly(2026, 1, 1), 15000, 0, 0),
            new(new DateOnly(2026, 4, 1), 20000, 0, 0)
        };

        var (monthly, _, _) = SalaryResolver.ResolveAsOf(10000, 0, 0, new DateOnly(2026, 5, 25), history);
        Assert.Equal(20000, monthly);

        var (monthlyFeb, _, _) = SalaryResolver.ResolveAsOf(10000, 0, 0, new DateOnly(2026, 2, 15), history);
        Assert.Equal(15000, monthlyFeb);
    }

    [Fact]
    public void Unpaid_leave_reduces_monthly_salary()
    {
        var emp = new PayrollEmployeeSnapshot(
            Guid.NewGuid(), 30000, 0, 0, 8, 5, 1.5,
            PayBasis.MonthlySalary, null, false);
        var leave = new List<PayrollLeaveSnapshot>
        {
            new("Unpaid Leave", new DateOnly(2026, 5, 12), new DateOnly(2026, 5, 13),
                false, false, 2, true)
        };

        var result = PayrollCalculator.Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), new DateOnly(2026, 5, 1), new DateOnly(2026, 5, 31),
            [], leave, [], 8, 1.5));

        Assert.NotNull(result);
        Assert.Equal(2, result.UnpaidLeaveDays);
        Assert.True(result.GrossPay < 30000);
    }

    [Fact]
    public void Irp5_builder_aggregates_tax_year()
    {
        var payslips = new List<PayrollYtdPayslipRow>
        {
            new(new DateOnly(2026, 4, 30), "approved", 20000, 15000, 5000,
                [new PayrollLineItem("PAYE", 4000), new PayrollLineItem("UIF", 200)]),
            new(new DateOnly(2026, 5, 31), "approved", 20000, 15000, 5000,
                [new PayrollLineItem("PAYE", 4000), new PayrollLineItem("UIF", 200)])
        };

        var records = Irp5RecordBuilder.BuildForTaxYear(2026, [
            (Guid.NewGuid(), "Jane Doe", "900101", "1234567890", payslips)
        ]);

        Assert.Single(records);
        Assert.Equal(40000, records[0].YtdGross);
        Assert.Equal(8000, records[0].YtdPaye);
    }

    [Fact]
    public void Bank_formatter_fnb_has_expected_columns()
    {
        var rows = BankPaymentFileFormatter.Format("fnb", [
            new BankPaymentRow("Jane", "FNB", "250655", "62000000000", 15000, "May 2026", "900101")
        ]);

        Assert.Equal(7, rows.Headers.Length);
        Assert.Single(rows.Rows);
        Assert.Equal("62000000000", rows.Rows[0][0]);
    }
}
