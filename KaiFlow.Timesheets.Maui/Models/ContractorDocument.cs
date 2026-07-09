using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Contractor compliance document. Maps to public.contractor_documents (Phase 2B.1).
/// HR uploads and manages; contractor portal support added in Phase 2B.2.
/// </summary>
[Table("contractor_documents")]
public class ContractorDocument : BaseModel
{
    [PrimaryKey("id")]            public Guid Id             { get; set; }
    [Column("company_id")]        public Guid CompanyId      { get; set; }
    [Column("contractor_id")]     public Guid ContractorId   { get; set; }

    [Column("document_type")]     public string DocumentType  { get; set; } = "";
    [Column("document_name")]     public string DocumentName  { get; set; } = "";

    [Column("file_url")]          public string FileUrl       { get; set; } = "";
    [Column("storage_path")]      public string? StoragePath  { get; set; }

    [Column("issue_date")]        public DateOnly? IssueDate  { get; set; }
    [Column("expiry_date")]       public DateOnly? ExpiryDate { get; set; }

    [Column("approval_status")]   public string ApprovalStatus  { get; set; } = "pending";
    [Column("approved_by")]       public Guid? ApprovedBy       { get; set; }
    [Column("approved_at")]       public DateTime? ApprovedAt   { get; set; }
    [Column("rejected_reason")]   public string? RejectedReason { get; set; }

    [Column("is_required")]       public bool IsRequired      { get; set; }
    [Column("is_current")]        public bool IsCurrent       { get; set; } = true;
    [Column("uploaded_by_role")]  public string UploadedByRole { get; set; } = "hr";
    [Column("notes")]             public string? Notes        { get; set; }
    [Column("created_at")]        public DateTime CreatedAt   { get; set; }
    [Column("updated_at")]        public DateTime UpdatedAt   { get; set; }

    // ── Approval state ────────────────────────────────────────────────────────
    [JsonIgnore] public bool IsApproved => ApprovalStatus == "approved";
    [JsonIgnore] public bool IsPending  => ApprovalStatus == "pending";
    [JsonIgnore] public bool IsRejected => ApprovalStatus == "rejected";

    // ── Expiry state ──────────────────────────────────────────────────────────
    [JsonIgnore] public bool IsExpired =>
        ExpiryDate.HasValue && ExpiryDate.Value < DateOnly.FromDateTime(DateTime.Today);

    [JsonIgnore] public bool IsExpiringSoon =>
        !IsExpired && ExpiryDate.HasValue &&
        ExpiryDate.Value <= DateOnly.FromDateTime(DateTime.Today.AddDays(30));

    /// <summary>True only when approved AND not expired.</summary>
    [JsonIgnore] public bool IsValid => IsApproved && !IsExpired;

    // ── Display helpers ───────────────────────────────────────────────────────

    [JsonIgnore] public string ExpiryDisplay =>
        ExpiryDate?.ToString("dd MMM yyyy") ?? "No expiry";

    [JsonIgnore] public string IssueDateDisplay =>
        IssueDate?.ToString("dd MMM yyyy") ?? "—";

    [JsonIgnore] public string UploadedDateDisplay =>
        CreatedAt.Year < 2000 ? "—" : CreatedAt.ToLocalTime().ToString("dd MMM yyyy");

    [JsonIgnore] public string TypeLabel => DocumentType switch
    {
        "company_registration"       => "Company Registration",
        "tax_clearance"              => "Tax Clearance (SARS TCS)",
        "vat_certificate"            => "VAT Certificate",
        "bank_confirmation"          => "Bank Confirmation Letter",
        "public_liability_insurance" => "Public Liability Insurance",
        "professional_indemnity"     => "Professional Indemnity",
        "coida"                      => "COIDA / Workmen's Comp.",
        "health_safety_file"         => "Health & Safety File",
        "contractor_agreement"       => "Contractor Agreement",
        "nda"                        => "NDA",
        "popia_agreement"            => "POPIA Agreement",
        "bbee_certificate"           => "B-BBEE Certificate",
        "proof_of_address"           => "Proof of Address",
        "id_document"                => "ID / Passport",
        "site_certification"         => "Site Certification",
        // Phase 2B.3a additions
        "psira_registration"         => "PSIRA Registration",
        "fidelity_guarantee"         => "Fidelity Guarantee",
        "liquor_license"             => "Liquor Licence",
        "food_safety_cert"           => "Food Safety Certificate",
        "other"                      => "Other",
        _                            => DocumentType
    };

    [JsonIgnore] public string TypeIcon => DocumentType switch
    {
        "company_registration"       => "🏢",
        "tax_clearance"              => "🧾",
        "vat_certificate"            => "🧾",
        "bank_confirmation"          => "🏦",
        "public_liability_insurance" => "🛡️",
        "professional_indemnity"     => "🛡️",
        "coida"                      => "⚕️",
        "health_safety_file"         => "🦺",
        "contractor_agreement"       => "📋",
        "nda"                        => "🔒",
        "popia_agreement"            => "🔒",
        "bbee_certificate"           => "📊",
        "proof_of_address"           => "📮",
        "id_document"                => "🪪",
        "site_certification"         => "🏗️",
        // Phase 2B.3a additions
        "psira_registration"         => "🛡️",
        "fidelity_guarantee"         => "🔐",
        "liquor_license"             => "🍺",
        "food_safety_cert"           => "🍽️",
        _                            => "📄"
    };

    // ── Approval badge styling ────────────────────────────────────────────────

    [JsonIgnore] public string ApprovalStatusLabel => ApprovalStatus switch
    {
        "approved" => "Approved",
        "rejected" => "Rejected",
        _          => "Pending Review"
    };

    /// <summary>
    /// Compact status label for the documents table.
    /// Reflects expiry state when approved so "Approved" doesn't mislead.
    /// </summary>
    [JsonIgnore] public string StatusTableLabel => ApprovalStatus switch
    {
        "approved" when IsExpired      => "Expired",
        "approved" when IsExpiringSoon => "Expiring",
        "approved"                     => "Approved",
        "rejected"                     => "Rejected",
        _                              => "Pending"
    };

    /// <summary>Compact uploaded-by label for narrow table column.</summary>
    [JsonIgnore] public string UploadedByShort =>
        UploadedByRole == "contractor_portal" ? "Portal" : "HR";

    [JsonIgnore] public string ApprovalBadgeBg => ApprovalStatus switch
    {
        "approved" => IsExpired      ? "#450A0A"   // dark-red when expired (distinct from rejected)
                    : IsExpiringSoon ? "#78350F"   // amber-dark when expiring soon
                    : "#14532D",                   // green when fully valid
        "rejected" => "#7F1D1D",                   // red
        _          => "#1E293B"                    // dark-grey for pending
    };

    [JsonIgnore] public string ApprovalBadgeFg => ApprovalStatus switch
    {
        "approved" => IsExpired      ? "#FCA5A5"   // light red text for expired
                    : IsExpiringSoon ? "#FCD34D"   // amber text for expiring
                    : "#22C55E",                   // green text when valid
        "rejected" => "#FCA5A5",
        _          => "#94A3B8"
    };

    // ── Expiry badge (shown alongside approval badge when relevant) ────────────
    [JsonIgnore] public bool ShowExpiryWarning => IsApproved && (IsExpired || IsExpiringSoon);

    [JsonIgnore] public string ExpiryWarningText =>
        IsExpired ? "Expired" : $"Exp. {ExpiryDisplay}";

    [JsonIgnore] public string ExpiryWarningFg =>
        IsExpired ? "#FCA5A5" : "#FCD34D";

    /// <summary>
    /// Colour for the expiry date text in the documents table.
    /// Red when expired, amber when expiring soon, secondary grey otherwise.
    /// </summary>
    [JsonIgnore] public string ExpiryDateColor =>
        IsExpired        ? "#FCA5A5"
        : IsExpiringSoon ? "#FCD34D"
        : "#94A3B8";
}
