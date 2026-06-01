using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Finance;

namespace KaiFlow.Timesheets.Models;

/// <summary>A single line on a client invoice. Maps to public.finance_invoice_lines.</summary>
[Table("finance_invoice_lines")]
public class FinanceInvoiceLine : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("invoice_id")] public Guid InvoiceId { get; set; }
    [Column("line_no")] public int LineNo { get; set; } = 1;
    [Column("description")] public string Description { get; set; } = string.Empty;
    [Column("quantity")] public decimal Quantity { get; set; } = 1;
    [Column("unit_price")] public decimal UnitPrice { get; set; }
    [Column("discount_amount")] public decimal DiscountAmount { get; set; }
    [Column("discount_percent")] public decimal DiscountPercent { get; set; }
    [Column("subtotal")] public decimal Subtotal { get; set; }
    [Column("vat_rate")] public decimal VatRate { get; set; } = VatConstants.DefaultSouthAfricaVatRate;
    [Column("vat_amount")] public decimal VatAmount { get; set; }
    [Column("total_amount")] public decimal TotalAmount { get; set; }
    [Column("is_vat_inclusive")] public bool IsVatInclusive { get; set; }
    [Column("tax_type")] public string TaxTypeRaw { get; set; } = "standard";
    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [JsonIgnore] public TaxType TaxType => TaxTypeExtensions.ParseTaxType(TaxTypeRaw);
    [JsonIgnore] public string QuantityDisplay => Quantity % 1 == 0 ? $"{Quantity:N0}" : $"{Quantity:N2}";
    [JsonIgnore] public string UnitPriceDisplay => $"R{UnitPrice:N2}";
    [JsonIgnore] public string TotalDisplay => $"R{TotalAmount:N2}";
}
