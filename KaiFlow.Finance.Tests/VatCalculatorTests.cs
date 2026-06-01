using KaiFlow.Finance;
using Xunit;

namespace KaiFlow.Finance.Tests;

public class VatCalculatorTests
{
    [Fact]
    public void Exclusive_1000_At_15_Percent_Yields_150_Vat_And_1150_Total()
    {
        var result = VatCalculator.CalculateVatExclusive(1000m, 0.15m);

        Assert.Equal(1000m, result.Subtotal);
        Assert.Equal(150m, result.VatAmount);
        Assert.Equal(1150m, result.TotalAmount);
        Assert.False(result.IsVatInclusive);
        Assert.Equal(0.15m, result.VatRate);
    }

    [Fact]
    public void Inclusive_1150_At_15_Percent_Yields_1000_Subtotal_And_150_Vat()
    {
        var result = VatCalculator.CalculateVatInclusive(1150m, 0.15m);

        Assert.Equal(1000m, result.Subtotal);
        Assert.Equal(150m, result.VatAmount);
        Assert.Equal(1150m, result.TotalAmount);
        Assert.True(result.IsVatInclusive);
    }

    [Fact]
    public void NormalizeRate_Accepts_Percentage_Or_Fraction()
    {
        Assert.Equal(0.15m, VatCalculator.NormalizeRate(15m));
        Assert.Equal(0.15m, VatCalculator.NormalizeRate(0.15m));
    }

    [Fact]
    public void Exclusive_Accepts_Percentage_Form_Rate()
    {
        var result = VatCalculator.CalculateVatExclusive(1000m, 15m);
        Assert.Equal(150m, result.VatAmount);
        Assert.Equal(1150m, result.TotalAmount);
    }

    [Theory]
    [InlineData(TaxType.ZeroRated)]
    [InlineData(TaxType.Exempt)]
    [InlineData(TaxType.NoVat)]
    public void NonStandard_TaxTypes_Charge_No_Vat(TaxType taxType)
    {
        var result = VatCalculator.CalculateVatExclusive(1000m, 0.15m, taxType);

        Assert.Equal(0m, result.VatAmount);
        Assert.Equal(1000m, result.TotalAmount);
        Assert.Equal(0m, result.VatRate);
    }

    [Fact]
    public void ReverseCalculateVat_Extracts_Embedded_Vat()
    {
        Assert.Equal(150m, VatCalculator.ReverseCalculateVat(1150m, 0.15m));
        Assert.Equal(0m, VatCalculator.ReverseCalculateVat(1150m, 0.15m, TaxType.Exempt));
    }

    [Fact]
    public void Rounding_Is_Deterministic_Half_Away_From_Zero()
    {
        Assert.Equal(2.35m, VatCalculator.RoundFinancialValues(2.345m));
        Assert.Equal(2.35m, VatCalculator.RoundFinancialValues(2.346m));
        Assert.Equal(2.34m, VatCalculator.RoundFinancialValues(2.344m));
    }

    [Fact]
    public void Inclusive_Then_Total_Reconciles()
    {
        var r = VatCalculator.CalculateVatInclusive(99.99m, 0.15m);
        Assert.Equal(r.TotalAmount, VatCalculator.CalculateTotal(r.Subtotal, r.VatAmount));
    }

    [Fact]
    public void Negative_Rate_Is_Rejected()
        => Assert.Throws<ArgumentOutOfRangeException>(() => VatCalculator.NormalizeRate(-1m));
}
