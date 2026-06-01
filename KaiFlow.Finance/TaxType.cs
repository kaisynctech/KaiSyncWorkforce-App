namespace KaiFlow.Finance;

/// <summary>
/// Tax treatment for a financial line or document.
/// Mirrors the <c>tax_type</c> column persisted on finance entities.
/// </summary>
public enum TaxType
{
    /// <summary>Standard-rated supply. The configured VAT rate is applied.</summary>
    Standard = 0,

    /// <summary>Zero-rated supply (VAT-applicable but charged at 0%).</summary>
    ZeroRated = 1,

    /// <summary>Exempt supply (no VAT charged, not part of VAT return as output).</summary>
    Exempt = 2,

    /// <summary>Counterparty is not VAT-registered; no VAT applies.</summary>
    NoVat = 3
}

public static class TaxTypeExtensions
{
    /// <summary>True only when VAT should actually be charged at the configured rate.</summary>
    public static bool AppliesVat(this TaxType taxType) => taxType == TaxType.Standard;

    /// <summary>Canonical lowercase token used for persistence / RPC payloads.</summary>
    public static string ToToken(this TaxType taxType) => taxType switch
    {
        TaxType.Standard => "standard",
        TaxType.ZeroRated => "zero_rated",
        TaxType.Exempt => "exempt",
        TaxType.NoVat => "no_vat",
        _ => "standard"
    };

    /// <summary>Parse a persisted token back into a <see cref="TaxType"/>, defaulting to Standard.</summary>
    public static TaxType ParseTaxType(string? token) => (token ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "zero_rated" or "zero-rated" or "zerorated" => TaxType.ZeroRated,
        "exempt" => TaxType.Exempt,
        "no_vat" or "no-vat" or "novat" or "none" => TaxType.NoVat,
        _ => TaxType.Standard
    };
}
