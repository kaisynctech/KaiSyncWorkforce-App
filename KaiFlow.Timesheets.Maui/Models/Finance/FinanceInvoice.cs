using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Finance;

namespace KaiFlow.Timesheets.Models;

/// <summary>Client (accounts-receivable) invoice. Maps to public.finance_invoices.</summary>
[Table("finance_invoices")]
public class FinanceInvoice : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("client_id")] public Guid? ClientId { get; set; }
    [Column("project_id")] public Guid? ProjectId { get; set; }
    [Column("quote_id")] public Guid? QuoteId { get; set; }
    [Column("invoice_number")] public string? InvoiceNumber { get; set; }
    [Column("status")] public string StatusRaw { get; set; } = "draft";
    [Column("currency")] public string Currency { get; set; } = "ZAR";
    [Column("subtotal")] public decimal Subtotal { get; set; }
    [Column("vat_rate")] public decimal VatRate { get; set; } = VatConstants.DefaultSouthAfricaVatRate;
    [Column("vat_amount")] public decimal VatAmount { get; set; }
    [Column("total_amount")] public decimal TotalAmount { get; set; }
    [Column("amount_paid")] public decimal AmountPaid { get; set; }
    [Column("balance_due")] public decimal BalanceDue { get; set; }
    [Column("is_vat_inclusive")] public bool IsVatInclusive { get; set; }
    [Column("tax_type")] public string TaxTypeRaw { get; set; } = "standard";
    [Column("discount_amount")] public decimal DiscountAmount { get; set; }
    [Column("issue_date")] public DateOnly IssueDate { get; set; }
    [Column("due_date")] public DateOnly? DueDate { get; set; }
    [Column("paid_date")] public DateOnly? PaidDate { get; set; }
    [Column("notes")] public string? Notes { get; set; }
    [Column("created_by")] public Guid? CreatedBy { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public TaxType TaxType => TaxTypeExtensions.ParseTaxType(TaxTypeRaw);

    [JsonIgnore] public string StatusLabel => StatusRaw switch
    {
        "sent" => "Sent",
        "viewed" => "Viewed",
        "partially_paid" => "Partially Paid",
        "paid" => "Paid",
        "overdue" => "Overdue",
        "cancelled" => "Cancelled",
        _ => "Draft"
    };

    /// <summary>Semantic status for <see cref="Controls.StatusChip"/>.</summary>
    [JsonIgnore] public string StatusChipKind => StatusRaw switch
    {
        "paid" => "success",
        "partially_paid" => "warning",
        "sent" or "viewed" => "info",
        "overdue" => "error",
        "cancelled" => "neutral",
        "draft" => "info",
        _ => "neutral"
    };

    /// <summary>Status pill colour (light-theme tints consistent with the rest of the app).</summary>
    [JsonIgnore] public string StatusColor => StatusRaw switch
    {
        "paid" => "#16A34A",
        "partially_paid" => "#2563EB",
        "sent" or "viewed" => "#0EA5E9",
        "overdue" => "#DC2626",
        "cancelled" => "#6B7280",
        _ => "#94A3B8"
    };

    [JsonIgnore] public bool IsOutstanding => StatusRaw is "sent" or "viewed" or "partially_paid" or "overdue";
    [JsonIgnore] public bool IsPaid => StatusRaw == "paid";
    [JsonIgnore] public string NumberDisplay => string.IsNullOrWhiteSpace(InvoiceNumber) ? "(draft)" : InvoiceNumber!;
    [JsonIgnore] public string TotalDisplay => $"R{TotalAmount:N2}";
    [JsonIgnore] public string BalanceDisplay => $"R{BalanceDue:N2}";
    [JsonIgnore] public string VatDisplay => $"R{VatAmount:N2}";
    [JsonIgnore] public string IssueDateDisplay => IssueDate.ToString("dd MMM yyyy");
    [JsonIgnore] public string DueDateDisplay => DueDate?.ToString("dd MMM yyyy") ?? "—";
}
