namespace KaiFlow.Finance;

/// <summary>
/// DI-friendly service that applies a company's configured default VAT rate when
/// a caller does not supply an explicit rate. Stateless aside from the configured
/// default, so it is safe to register as a singleton and reconfigure per company.
/// </summary>
public sealed class TaxCalculationService
{
    private decimal _companyDefaultVatRate = VatConstants.DefaultSouthAfricaVatRate;

    public TaxCalculationService() { }

    public TaxCalculationService(decimal companyDefaultVatRate)
        => CompanyDefaultVatRate = companyDefaultVatRate;

    /// <summary>The active company's default VAT rate (stored as a fraction, e.g. 0.15).</summary>
    public decimal CompanyDefaultVatRate
    {
        get => _companyDefaultVatRate;
        set => _companyDefaultVatRate = VatCalculator.NormalizeRate(value);
    }

    /// <summary>Apply the current company's default rate to a value (defaults to VAT-exclusive).</summary>
    public VatCalculationResult Calculate(
        decimal amount,
        bool isVatInclusive = false,
        decimal? vatRate = null,
        TaxType taxType = TaxType.Standard)
    {
        var rate = vatRate ?? CompanyDefaultVatRate;
        return isVatInclusive
            ? VatCalculator.CalculateVatInclusive(amount, rate, taxType)
            : VatCalculator.CalculateVatExclusive(amount, rate, taxType);
    }

    /// <summary>Compute a document line using the company default when no rate is provided.</summary>
    public VatCalculationResult CalculateLine(
        decimal quantity,
        decimal unitPrice,
        bool isVatInclusive = false,
        decimal? vatRate = null,
        TaxType taxType = TaxType.Standard,
        decimal discountAmount = 0m,
        decimal discountPercent = 0m)
        => FinanceCalculationHelper.CalculateLine(
            quantity, unitPrice, vatRate ?? CompanyDefaultVatRate,
            isVatInclusive, taxType, discountAmount, discountPercent);

    /// <summary>Resolve the rate that would be applied for the given inputs (transparency/audit).</summary>
    public decimal ResolveEffectiveRate(decimal? vatRate, TaxType taxType)
        => VatCalculator.EffectiveRate(vatRate ?? CompanyDefaultVatRate, taxType);
}
