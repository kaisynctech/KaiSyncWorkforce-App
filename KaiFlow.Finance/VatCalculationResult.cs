namespace KaiFlow.Finance;

/// <summary>
/// Immutable, fully-rounded result of a VAT calculation. Maps 1:1 onto the
/// finance entity columns: subtotal / vat_rate / vat_amount / total_amount /
/// is_vat_inclusive / tax_type.
/// </summary>
public sealed record VatCalculationResult
{
    /// <summary>Net amount excluding VAT (rounded to money precision).</summary>
    public decimal Subtotal { get; init; }

    /// <summary>Effective VAT rate applied as a fraction (0.15 == 15%). Zero for exempt/zero-rated/no-vat.</summary>
    public decimal VatRate { get; init; }

    /// <summary>VAT portion (rounded to money precision).</summary>
    public decimal VatAmount { get; init; }

    /// <summary>Gross amount including VAT (rounded to money precision).</summary>
    public decimal TotalAmount { get; init; }

    /// <summary>True when the source amount was VAT-inclusive (VAT was reverse-calculated).</summary>
    public bool IsVatInclusive { get; init; }

    /// <summary>The tax treatment used to produce this result.</summary>
    public TaxType TaxType { get; init; } = TaxType.Standard;

    /// <summary>An all-zero, standard-rated result.</summary>
    public static VatCalculationResult Zero { get; } = new();
}

/// <summary>Aggregated totals for a multi-line document (invoice, supplier invoice, etc.).</summary>
public sealed record InvoiceTotals
{
    public decimal Subtotal { get; init; }
    public decimal VatAmount { get; init; }
    public decimal TotalAmount { get; init; }

    public static InvoiceTotals Zero { get; } = new();
}

/// <summary>Output/input VAT roll-up for a VAT reporting period.</summary>
public sealed record VatPeriodSummary
{
    /// <summary>VAT charged on sales (output VAT / liability).</summary>
    public decimal OutputVat { get; init; }

    /// <summary>VAT paid on purchases (input VAT / claimable).</summary>
    public decimal InputVat { get; init; }

    /// <summary>Net VAT due to the revenue service (positive) or refundable (negative).</summary>
    public decimal VatDue { get; init; }
}

/// <summary>Settlement state of a financial document, derived deterministically.</summary>
public enum PaymentState
{
    Unpaid = 0,
    PartiallyPaid = 1,
    Paid = 2,
    Overdue = 3
}
