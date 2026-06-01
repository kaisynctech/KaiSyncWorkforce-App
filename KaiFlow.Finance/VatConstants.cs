namespace KaiFlow.Finance;

/// <summary>
/// Shared, immutable finance constants. VAT rate is stored as a fraction (0.15 == 15%).
/// </summary>
public static class VatConstants
{
    /// <summary>South African standard VAT rate (15%) used as the platform default.</summary>
    public const decimal DefaultSouthAfricaVatRate = 0.15m;

    /// <summary>Decimal places used for all persisted money values.</summary>
    public const int MoneyDecimals = 2;

    /// <summary>Decimal places retained for a VAT rate fraction (supports e.g. 0.155).</summary>
    public const int RateDecimals = 4;

    /// <summary>ISO currency code default for the platform.</summary>
    public const string DefaultCurrency = "ZAR";
}
