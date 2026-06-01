using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Finance;

namespace KaiFlow.Timesheets.Models;

/// <summary>Supplier (accounts-payable) invoice. Maps to public.supplier_invoices.</summary>
[Table("supplier_invoices")]
public class SupplierInvoice : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("supplier_id")] public Guid? SupplierId { get; set; }
    [Column("job_id")] public Guid? JobId { get; set; }
    [Column("project_id")] public Guid? ProjectId { get; set; }
    [Column("invoice_number")] public string? InvoiceNumber { get; set; }
    [Column("subtotal")] public decimal Subtotal { get; set; }
    [Column("vat_rate")] public decimal VatRate { get; set; } = VatConstants.DefaultSouthAfricaVatRate;
    [Column("vat_amount")] public decimal VatAmount { get; set; }
    [Column("total_amount")] public decimal TotalAmount { get; set; }
    [Column("amount_paid")] public decimal AmountPaid { get; set; }
    [Column("balance_due")] public decimal BalanceDue { get; set; }
    [Column("is_vat_inclusive")] public bool IsVatInclusive { get; set; }
    [Column("tax_type")] public string TaxTypeRaw { get; set; } = "standard";
    [Column("due_date")] public DateOnly? DueDate { get; set; }
    [Column("status")] public string StatusRaw { get; set; } = "received";
    [Column("approval_status")] public string ApprovalStatusRaw { get; set; } = "pending";
    [Column("approved_by")] public Guid? ApprovedBy { get; set; }
    [Column("approved_at")] public DateTime? ApprovedAt { get; set; }
    [Column("paid_at")] public DateTime? PaidAt { get; set; }
    [Column("attachment_urls")] public List<string> AttachmentUrls { get; set; } = new();
    [Column("notes")] public string? Notes { get; set; }
    [Column("created_by")] public Guid? CreatedBy { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public TaxType TaxType => TaxTypeExtensions.ParseTaxType(TaxTypeRaw);
    [JsonIgnore] public bool IsApproved => ApprovalStatusRaw == "approved";
    [JsonIgnore] public bool AwaitingApproval => ApprovalStatusRaw == "pending";
    [JsonIgnore] public bool IsOutstanding => StatusRaw is "received" or "approved" or "partially_paid" or "overdue";

    [JsonIgnore] public string StatusLabel => StatusRaw switch
    {
        "draft" => "Draft",
        "approved" => "Approved",
        "partially_paid" => "Partially Paid",
        "paid" => "Paid",
        "overdue" => "Overdue",
        "cancelled" => "Cancelled",
        _ => "Received"
    };

    [JsonIgnore] public string StatusColor => StatusRaw switch
    {
        "paid" => "#16A34A",
        "partially_paid" => "#2563EB",
        "approved" => "#0EA5E9",
        "overdue" => "#DC2626",
        "cancelled" => "#6B7280",
        _ => "#F59E0B"
    };

    [JsonIgnore] public string TotalDisplay => $"R{TotalAmount:N2}";
    [JsonIgnore] public string BalanceDisplay => $"R{BalanceDue:N2}";
    [JsonIgnore] public string DueDateDisplay => DueDate?.ToString("dd MMM yyyy") ?? "—";
    [JsonIgnore] public bool HasAttachments => AttachmentUrls.Count > 0;
}
