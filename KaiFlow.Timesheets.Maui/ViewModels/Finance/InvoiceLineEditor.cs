using CommunityToolkit.Mvvm.ComponentModel;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.ViewModels.Finance;

/// <summary>
/// Observable wrapper around an invoice line that recomputes subtotal / VAT /
/// total live (via the deterministic finance engine) as the user edits.
/// </summary>
public partial class InvoiceLineEditor : ObservableObject
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int LineNo { get; set; } = 1;

    [ObservableProperty] private string _description = "";
    [ObservableProperty] private decimal _quantity = 1;
    [ObservableProperty] private decimal _unitPrice;
    [ObservableProperty] private decimal _discountPercent;
    [ObservableProperty] private decimal _vatRate = VatConstants.DefaultSouthAfricaVatRate;
    [ObservableProperty] private bool _isVatInclusive;
    [ObservableProperty] private string _taxTypeRaw = "standard";

    [ObservableProperty] private decimal _subtotal;
    [ObservableProperty] private decimal _vatAmount;
    [ObservableProperty] private decimal _totalAmount;

    /// <summary>Raised whenever a recompute changes the line totals (parent re-totals).</summary>
    public event EventHandler? Recalculated;

    partial void OnQuantityChanged(decimal value) => Recalculate();
    partial void OnUnitPriceChanged(decimal value) => Recalculate();
    partial void OnDiscountPercentChanged(decimal value) => Recalculate();
    partial void OnVatRateChanged(decimal value) => Recalculate();
    partial void OnIsVatInclusiveChanged(bool value) => Recalculate();
    partial void OnTaxTypeRawChanged(string value) => Recalculate();

    public void Recalculate()
    {
        var calc = FinanceCalculationHelper.CalculateLine(
            Quantity, UnitPrice, VatRate, IsVatInclusive,
            TaxTypeExtensions.ParseTaxType(TaxTypeRaw), discountPercent: DiscountPercent);
        Subtotal = calc.Subtotal;
        VatAmount = calc.VatAmount;
        TotalAmount = calc.TotalAmount;
        Recalculated?.Invoke(this, EventArgs.Empty);
    }

    public string SubtotalDisplay => $"R{Subtotal:N2}";
    public string TotalDisplay => $"R{TotalAmount:N2}";

    public static InvoiceLineEditor FromModel(FinanceInvoiceLine line) => new()
    {
        Id = line.Id == Guid.Empty ? Guid.NewGuid() : line.Id,
        LineNo = line.LineNo,
        Description = line.Description,
        Quantity = line.Quantity,
        UnitPrice = line.UnitPrice,
        DiscountPercent = line.DiscountPercent,
        VatRate = line.VatRate,
        IsVatInclusive = line.IsVatInclusive,
        TaxTypeRaw = line.TaxTypeRaw,
        Subtotal = line.Subtotal,
        VatAmount = line.VatAmount,
        TotalAmount = line.TotalAmount
    };

    public FinanceInvoiceLine ToModel(Guid invoiceId, Guid companyId) => new()
    {
        Id = Id,
        CompanyId = companyId,
        InvoiceId = invoiceId,
        LineNo = LineNo,
        Description = Description,
        Quantity = Quantity,
        UnitPrice = UnitPrice,
        DiscountPercent = DiscountPercent,
        VatRate = VatRate,
        IsVatInclusive = IsVatInclusive,
        TaxTypeRaw = TaxTypeRaw,
        Subtotal = Subtotal,
        VatAmount = VatAmount,
        TotalAmount = TotalAmount
    };
}
