namespace KaiFlow.Finance;

/// <summary>
/// Pure, deterministic VAT math. Every public method is side-effect free and
/// rounds to <see cref="VatConstants.MoneyDecimals"/> using banker-free
/// "away from zero" rounding so results are stable and auditable across runs.
/// </summary>
public static class VatCalculator
{
    /// <summary>
    /// Rounds a money value deterministically (half away from zero) to the given precision.
    /// </summary>
    public static decimal RoundFinancialValues(decimal value, int decimals = VatConstants.MoneyDecimals)
        => Math.Round(value, decimals, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Normalises a VAT rate to a fraction. Accepts either a fraction (0.15) or a
    /// percentage (15) and always returns the fraction form (0.15).
    /// </summary>
    public static decimal NormalizeRate(decimal vatRate)
    {
        if (vatRate < 0m)
            throw new ArgumentOutOfRangeException(nameof(vatRate), "VAT rate cannot be negative.");
        return vatRate > 1m ? vatRate / 100m : vatRate;
    }

    /// <summary>
    /// Resolves the effective rate to actually apply given the tax treatment.
    /// Zero-rated, exempt and no-vat lines always resolve to 0.
    /// </summary>
    public static decimal EffectiveRate(decimal vatRate, TaxType taxType)
        => taxType.AppliesVat() ? NormalizeRate(vatRate) : 0m;

    /// <summary>
    /// Calculates VAT and total from a VAT-EXCLUSIVE subtotal.
    /// Example: 1000 @ 15% =&gt; subtotal 1000, vat 150, total 1150.
    /// </summary>
    public static VatCalculationResult CalculateVatExclusive(decimal subtotal, decimal vatRate, TaxType taxType = TaxType.Standard)
    {
        var rate = EffectiveRate(vatRate, taxType);
        var sub = RoundFinancialValues(subtotal);
        var vat = RoundFinancialValues(sub * rate);
        var total = RoundFinancialValues(sub + vat);
        return new VatCalculationResult
        {
            Subtotal = sub,
            VatRate = rate,
            VatAmount = vat,
            TotalAmount = total,
            IsVatInclusive = false,
            TaxType = taxType
        };
    }

    /// <summary>
    /// Calculates the embedded VAT and net subtotal from a VAT-INCLUSIVE total.
    /// Example: 1150 incl @ 15% =&gt; subtotal 1000, vat 150, total 1150.
    /// </summary>
    public static VatCalculationResult CalculateVatInclusive(decimal totalAmount, decimal vatRate, TaxType taxType = TaxType.Standard)
    {
        var rate = EffectiveRate(vatRate, taxType);
        var total = RoundFinancialValues(totalAmount);
        var sub = rate == 0m ? total : RoundFinancialValues(total / (1m + rate));
        var vat = RoundFinancialValues(total - sub);
        return new VatCalculationResult
        {
            Subtotal = sub,
            VatRate = rate,
            VatAmount = vat,
            TotalAmount = total,
            IsVatInclusive = true,
            TaxType = taxType
        };
    }

    /// <summary>Adds a (already-rounded) subtotal and VAT into a rounded total.</summary>
    public static decimal CalculateTotal(decimal subtotal, decimal vatAmount)
        => RoundFinancialValues(subtotal + vatAmount);

    /// <summary>
    /// Extracts the VAT portion embedded in a VAT-inclusive total (reverse VAT).
    /// Returns 0 for non-standard tax treatments.
    /// </summary>
    public static decimal ReverseCalculateVat(decimal totalInclusive, decimal vatRate, TaxType taxType = TaxType.Standard)
    {
        var rate = EffectiveRate(vatRate, taxType);
        if (rate == 0m) return 0m;
        var total = RoundFinancialValues(totalInclusive);
        var sub = RoundFinancialValues(total / (1m + rate));
        return RoundFinancialValues(total - sub);
    }
}
