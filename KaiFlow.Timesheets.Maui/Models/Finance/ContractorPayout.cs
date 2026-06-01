using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Finance;

namespace KaiFlow.Timesheets.Models;

/// <summary>Contractor payout (subcontractor settlement). Maps to public.contractor_payouts.</summary>
[Table("contractor_payouts")]
public class ContractorPayout : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("contractor_id")] public Guid? ContractorId { get; set; }
    [Column("job_id")] public Guid? JobId { get; set; }
    [Column("subtotal")] public decimal Subtotal { get; set; }
    [Column("vat_rate")] public decimal VatRate { get; set; } = VatConstants.DefaultSouthAfricaVatRate;
    [Column("vat_amount")] public decimal VatAmount { get; set; }
    [Column("total_amount")] public decimal TotalAmount { get; set; }
    [Column("retention_amount")] public decimal RetentionAmount { get; set; }
    [Column("is_vat_inclusive")] public bool IsVatInclusive { get; set; }
    [Column("tax_type")] public string TaxTypeRaw { get; set; } = "standard";
    [Column("payout_status")] public string PayoutStatusRaw { get; set; } = "pending";
    [Column("approval_status")] public string ApprovalStatusRaw { get; set; } = "pending";
    [Column("approved_by")] public Guid? ApprovedBy { get; set; }
    [Column("approved_at")] public DateTime? ApprovedAt { get; set; }
    [Column("paid_at")] public DateTime? PaidAt { get; set; }
    [Column("payout_date")] public DateOnly? PayoutDate { get; set; }
    [Column("notes")] public string? Notes { get; set; }
    [Column("created_by")] public Guid? CreatedBy { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public TaxType TaxType => TaxTypeExtensions.ParseTaxType(TaxTypeRaw);
    [JsonIgnore] public bool IsApproved => ApprovalStatusRaw == "approved";
    [JsonIgnore] public bool AwaitingApproval => ApprovalStatusRaw == "pending";
    [JsonIgnore] public decimal NetPayable => TotalAmount - RetentionAmount;

    [JsonIgnore] public string PayoutStatusLabel => PayoutStatusRaw switch
    {
        "approved" => "Approved",
        "paid" => "Paid",
        "cancelled" => "Cancelled",
        _ => "Pending"
    };

    [JsonIgnore] public string StatusColor => PayoutStatusRaw switch
    {
        "paid" => "#16A34A",
        "approved" => "#0EA5E9",
        "cancelled" => "#6B7280",
        _ => "#F59E0B"
    };

    [JsonIgnore] public string TotalDisplay => $"R{TotalAmount:N2}";
    [JsonIgnore] public string NetDisplay => $"R{NetPayable:N2}";
    [JsonIgnore] public string RetentionDisplay => RetentionAmount > 0 ? $"R{RetentionAmount:N2}" : "—";
    [JsonIgnore] public string PayoutDateDisplay => PayoutDate?.ToString("dd MMM yyyy") ?? "—";
}
