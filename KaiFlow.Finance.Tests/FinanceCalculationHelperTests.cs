using KaiFlow.Finance;
using Xunit;

namespace KaiFlow.Finance.Tests;

public class FinanceCalculationHelperTests
{
    [Fact]
    public void CalculateLine_Quantity_UnitPrice_Exclusive()
    {
        var line = FinanceCalculationHelper.CalculateLine(
            quantity: 3m, unitPrice: 100m, vatRate: 0.15m, isVatInclusive: false);

        Assert.Equal(300m, line.Subtotal);
        Assert.Equal(45m, line.VatAmount);
        Assert.Equal(345m, line.TotalAmount);
    }

    [Fact]
    public void ApplyDiscount_Percent_Then_Fixed()
    {
        // 1000 - 10% = 900, then -50 = 850
        Assert.Equal(850m, FinanceCalculationHelper.ApplyDiscount(1000m, discountAmount: 50m, discountPercent: 10m));
    }

    [Fact]
    public void ApplyDiscount_Never_Negative()
        => Assert.Equal(0m, FinanceCalculationHelper.ApplyDiscount(100m, discountAmount: 250m));

    [Fact]
    public void SummariseLines_Aggregates_Subtotal_Vat_Total()
    {
        var lines = new[]
        {
            VatCalculator.CalculateVatExclusive(100m, 0.15m),
            VatCalculator.CalculateVatExclusive(200m, 0.15m),
            VatCalculator.CalculateVatExclusive(50m, 0.15m, TaxType.ZeroRated)
        };

        var totals = FinanceCalculationHelper.SummariseLines(lines);

        Assert.Equal(350m, totals.Subtotal);
        Assert.Equal(45m, totals.VatAmount);  // only the two standard lines
        Assert.Equal(395m, totals.TotalAmount);
    }

    [Fact]
    public void BalanceDue_Clamped_To_Zero()
    {
        Assert.Equal(150m, FinanceCalculationHelper.BalanceDue(1150m, 1000m));
        Assert.Equal(0m, FinanceCalculationHelper.BalanceDue(1150m, 1200m));
    }

    [Fact]
    public void ResolvePaymentState_Covers_All_States()
    {
        var due = new DateOnly(2026, 1, 31);
        var before = new DateOnly(2026, 1, 15);
        var after = new DateOnly(2026, 2, 15);

        Assert.Equal(PaymentState.Paid, FinanceCalculationHelper.ResolvePaymentState(1000m, 1000m, due, before));
        Assert.Equal(PaymentState.PartiallyPaid, FinanceCalculationHelper.ResolvePaymentState(1000m, 400m, due, before));
        Assert.Equal(PaymentState.Unpaid, FinanceCalculationHelper.ResolvePaymentState(1000m, 0m, due, before));
        Assert.Equal(PaymentState.Overdue, FinanceCalculationHelper.ResolvePaymentState(1000m, 0m, due, after));
        Assert.Equal(PaymentState.Overdue, FinanceCalculationHelper.ResolvePaymentState(1000m, 400m, due, after));
    }

    [Fact]
    public void SummariseVatPeriod_Computes_Net_Due()
    {
        var summary = FinanceCalculationHelper.SummariseVatPeriod(
            outputVat: new[] { 150m, 75m },
            inputVat: new[] { 30m, 20m });

        Assert.Equal(225m, summary.OutputVat);
        Assert.Equal(50m, summary.InputVat);
        Assert.Equal(175m, summary.VatDue);
    }

    [Fact]
    public void Profitability_Computes_Profit_And_Margin()
    {
        var (profit, margin) = FinanceCalculationHelper.Profitability(revenue: 1000m, totalCost: 750m);
        Assert.Equal(250m, profit);
        Assert.Equal(0.25m, margin);
    }

    [Fact]
    public void TaxCalculationService_Uses_Company_Default_When_Rate_Omitted()
    {
        var svc = new TaxCalculationService(0.15m);
        var result = svc.Calculate(1000m);
        Assert.Equal(150m, result.VatAmount);

        svc.CompanyDefaultVatRate = 14m; // percentage form accepted
        Assert.Equal(0.14m, svc.CompanyDefaultVatRate);
    }
}
