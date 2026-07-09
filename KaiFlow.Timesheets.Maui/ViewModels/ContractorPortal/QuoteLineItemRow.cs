using CommunityToolkit.Mvvm.ComponentModel;

namespace KaiFlow.Timesheets.ViewModels.ContractorPortal;

/// <summary>
/// One editable line item in the portal quote create/edit form.
/// VAT is applied at the QUOTE level, not per-item (Phase 2D.2 polish).
/// LineTotal = Subtotal = qty × unit_price − discount.
/// </summary>
public partial class QuoteLineItemRow : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal), nameof(LineTotalDisplay))]
    private string _description = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal), nameof(LineTotalDisplay))]
    private decimal _quantity = 1;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal), nameof(LineTotalDisplay))]
    private decimal _unitPrice;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Subtotal), nameof(LineTotalDisplay))]
    private decimal _discountAmount;

    // ── Computed (no per-item VAT; VAT is quote-level) ────────────────────────

    public decimal Subtotal  => Math.Round(Quantity * UnitPrice - DiscountAmount, 2);
    public decimal LineTotal => Subtotal;   // alias for UI label clarity

    public string LineTotalDisplay => $"R{LineTotal:N2}";

    // ── Factory + serialiser ──────────────────────────────────────────────────

    public static QuoteLineItemRow FromModel(KaiFlow.Timesheets.Models.ContractorQuoteItem item) =>
        new()
        {
            Description    = item.Description,
            Quantity       = item.Quantity,
            UnitPrice      = item.UnitPrice,
            DiscountAmount = item.DiscountAmount,
        };

    /// <summary>Serialises to the JSONB format expected by contractor_portal_save_quote_draft.</summary>
    public Dictionary<string, object> ToJsonDict() => new()
    {
        ["description"]      = Description,
        ["quantity"]         = Quantity,
        ["unit_price"]       = UnitPrice,
        ["discount_amount"]  = DiscountAmount,
    };
}
