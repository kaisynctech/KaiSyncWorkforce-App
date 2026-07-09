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

    /// <summary>Phase A — links this payout to the approved contractor_quote it settles (nullable).</summary>
    [Column("quote_id")] public Guid? QuoteId { get; set; }

    /// <summary>Phase E — links this payout to the specific job_contractors assignment that submitted it (nullable).</summary>
    [Column("job_contractor_id")] public Guid? JobContractorId { get; set; }

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
    [JsonIgnore] public string NotesDisplay => string.IsNullOrWhiteSpace(Notes) ? "—" : Notes;
    [JsonIgnore] public bool HasNotes => !string.IsNullOrWhiteSpace(Notes);
    [JsonIgnore] public bool IsPortalSubmission => JobContractorId.HasValue;
    [JsonIgnore] public string SourceLabel => IsPortalSubmission ? "Portal" : "HR";

    // ── Phase I: portal-enriched fields — set in-memory by ParsePortalPayouts ─
    [JsonIgnore] public string PortalJobTitle { get; set; } = "";
    [JsonIgnore] public string PortalJobCode  { get; set; } = "";

    [JsonIgnore] public string JobDisplay =>
        !string.IsNullOrWhiteSpace(PortalJobTitle)
            ? (string.IsNullOrWhiteSpace(PortalJobCode)
                   ? PortalJobTitle
                   : $"{PortalJobCode} · {PortalJobTitle}")
            : "—";
    [JsonIgnore] public bool HasJobDisplay => !string.IsNullOrWhiteSpace(PortalJobTitle);

    [JsonIgnore] public string InvoiceReferenceDisplay =>
        !string.IsNullOrWhiteSpace(Notes)
            ? (Notes.Contains('|') ? Notes.Split('|')[0].Trim() : Notes.Trim())
            : "—";
    [JsonIgnore] public bool HasInvoiceReference => !string.IsNullOrWhiteSpace(Notes);

    [JsonIgnore] public string FullStatusLabel => PayoutStatusRaw switch
    {
        "paid"     => "Paid",
        "approved" => "Approved — Awaiting Payment",
        _          => ApprovalStatusRaw == "rejected" ? "Rejected" : "Pending Review"
    };
    [JsonIgnore] public string StatusBadgeBg => PayoutStatusRaw switch
    {
        "paid"     => "#14532D",
        "approved" => "#1E3A5F",
        _          => ApprovalStatusRaw == "rejected" ? "#7F1D1D" : "#292012"
    };
    [JsonIgnore] public string StatusBadgeFg => PayoutStatusRaw switch
    {
        "paid"     => "#22C55E",
        "approved" => "#60A5FA",
        _          => ApprovalStatusRaw == "rejected" ? "#FCA5A5" : "#FCD34D"
    };

    [JsonIgnore] public string CreatedAtDisplay =>
        CreatedAt != default ? CreatedAt.ToLocalTime().ToString("dd MMM yyyy") : "—";
    [JsonIgnore] public string BestDateDisplay =>
        PayoutDate.HasValue ? PayoutDate.Value.ToString("dd MMM yyyy") : CreatedAtDisplay;
    [JsonIgnore] public bool HasRetention => RetentionAmount > 0;

    // ── Phase K: payment status timeline ─────────────────────────────────────
    // Step 1 — Submitted (always present)
    [JsonIgnore] public string TimelineSubmittedAt =>
        CreatedAt != default ? CreatedAt.ToLocalTime().ToString("dd MMM yyyy, h:mm tt") : "—";

    // Step 2 — Approved (present when approval_status == "approved" or payout_status in approved/paid)
    [JsonIgnore] public bool TimelineApproved =>
        ApprovalStatusRaw == "approved" || PayoutStatusRaw is "approved" or "paid";
    [JsonIgnore] public string TimelineApprovedAt =>
        ApprovedAt.HasValue ? ApprovedAt.Value.ToLocalTime().ToString("dd MMM yyyy, h:mm tt") : "Awaiting approval";

    // Step 3 — Paid
    [JsonIgnore] public bool TimelinePaid => PayoutStatusRaw == "paid";
    [JsonIgnore] public string TimelinePaidAt =>
        PaidAt.HasValue ? PaidAt.Value.ToLocalTime().ToString("dd MMM yyyy, h:mm tt") :
        PayoutDate.HasValue ? PayoutDate.Value.ToString("dd MMM yyyy") : "Awaiting payment";

    // Rejection (replaces approval step when rejected)
    [JsonIgnore] public bool TimelineRejected => ApprovalStatusRaw == "rejected";
    [JsonIgnore] public string TimelineApprovalStepLabel => TimelineRejected ? "Rejected" : "Approved";
    [JsonIgnore] public string TimelineApprovalStepColor => TimelineRejected ? "#EF4444" : (TimelineApproved ? "#22C55E" : "#334155");

    // ── Phase N: payment run enrichment — set in-memory by ContractorPayoutsViewModel ─
    [JsonIgnore] public string PayRunContractorName { get; set; } = "";

    // ── Phase P: reject → revise flow ────────────────────────────────────────
    [Column("rejection_reason")]
    public string? RejectionReason { get; set; }

    [JsonIgnore] public bool IsRejected => ApprovalStatusRaw == "rejected";
    [JsonIgnore] public string RejectionReasonDisplay =>
        !string.IsNullOrWhiteSpace(RejectionReason) ? RejectionReason : "No reason provided";
}
