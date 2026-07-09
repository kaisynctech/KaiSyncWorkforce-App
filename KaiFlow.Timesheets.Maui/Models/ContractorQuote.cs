using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// A quote submitted by a contractor to the company.
/// Maps to public.contractor_quotes (Phase 2D.2).
///
/// Source modes:
///   manual — line items entered in KaiFlow (contractor_quote_items)
///   upload — external document uploaded (contractor_quote_attachments)
///
/// Status workflow:
///   draft → submitted → approved / rejected → converted
///   Phase 2D.3 adds HR approve/reject; Phase 2D.4 adds convert + PDF.
/// </summary>
[Table("contractor_quotes")]
public class ContractorQuote : BaseModel
{
    [PrimaryKey("id")]           public Guid    Id            { get; set; }
    [Column("company_id")]       public Guid    CompanyId     { get; set; }
    [Column("contractor_id")]    public Guid    ContractorId  { get; set; }

    [Column("quote_number")]     public string? QuoteNumber   { get; set; }
    [Column("title")]            public string  Title         { get; set; } = "";
    [Column("description")]      public string? Description   { get; set; }
    [Column("source_mode")]      public string  SourceMode    { get; set; } = "manual";

    [Column("currency")]         public string  Currency      { get; set; } = "ZAR";
    [Column("subtotal")]              public decimal Subtotal           { get; set; }
    [Column("discount_amount")]       public decimal DiscountAmount     { get; set; }
    [Column("freight_amount")]        public decimal FreightAmount      { get; set; }
    [Column("duty_amount")]           public decimal DutyAmount         { get; set; }
    [Column("levies_amount")]         public decimal LeviesAmount       { get; set; }
    [Column("other_charges_amount")]  public decimal OtherChargesAmount { get; set; }
    [Column("taxable_amount")]        public decimal TaxableAmount      { get; set; }
    [Column("vat_mode")]              public string  VatMode            { get; set; } = "exclusive";
    [Column("vat_rate")]              public decimal VatRate            { get; set; } = 0.15m;
    [Column("vat_amount")]            public decimal VatAmount          { get; set; }
    [Column("total_amount")]          public decimal TotalAmount        { get; set; }
    [Column("is_vat_inclusive")]      public bool    IsVatInclusive     { get; set; }

    [Column("quote_date")]       public DateOnly QuoteDate    { get; set; }
    [Column("valid_until")]      public DateOnly? ValidUntil  { get; set; }

    [Column("status")]           public string  Status        { get; set; } = "draft";

    // Phase 2D.3 — HR review
    [Column("reviewed_by")]        public Guid?   ReviewedBy       { get; set; }
    [Column("reviewed_at")]        public DateTime? ReviewedAt     { get; set; }
    [Column("rejection_reason")]   public string? RejectionReason  { get; set; }
    /// <summary>HR's revision comments — visible to contractor when status = revision_requested.</summary>
    [Column("revision_comments")]  public string? RevisionComments { get; set; }
    /// <summary>Internal HR notes — not shown to contractor.</summary>
    [Column("hr_notes")]           public string? HrNotes          { get; set; }

    // Phase 2D.4 — Job conversion
    [Column("converted_to_job_id")] public Guid? ConvertedToJobId { get; set; }
    [Column("converted_at")]        public DateTime? ConvertedAt   { get; set; }

    [Column("terms")]            public string? Terms          { get; set; }
    [Column("contractor_notes")] public string? ContractorNotes { get; set; }
    [Column("internal_notes")]   public string? InternalNotes  { get; set; }

    [Column("sender_name")]       public string? SenderName      { get; set; }
    [Column("sender_reg_number")] public string? SenderRegNumber { get; set; }
    [Column("sender_vat_number")] public string? SenderVatNumber { get; set; }

    [Column("submitted_at")]     public DateTime? SubmittedAt  { get; set; }
    [Column("created_at")]       public DateTime  CreatedAt    { get; set; }
    [Column("updated_at")]       public DateTime  UpdatedAt    { get; set; }

    // Populated by portal get_quote RPC — not in DB columns
    [JsonIgnore] public List<ContractorQuoteItem>       Items       { get; set; } = [];
    [JsonIgnore] public List<ContractorQuoteAttachment> Attachments { get; set; } = [];

    // ── Display helpers ───────────────────────────────────────────────────────

    [JsonIgnore] public bool IsManual           => SourceMode == "manual";
    [JsonIgnore] public bool IsUpload           => SourceMode == "upload";
    [JsonIgnore] public bool IsDraft            => Status == "draft";
    [JsonIgnore] public bool IsSubmitted        => Status == "submitted";
    [JsonIgnore] public bool IsUnderReview      => Status == "under_review";
    [JsonIgnore] public bool IsRevisionRequested => Status == "revision_requested";
    [JsonIgnore] public bool IsApproved         => Status == "approved";
    [JsonIgnore] public bool IsRejected         => Status == "rejected";
    /// <summary>True when the contractor can open the editor (draft or revision_requested).</summary>
    [JsonIgnore] public bool CanEdit            => Status is "draft" or "revision_requested";
    /// <summary>True when the contractor can resubmit (only revision_requested).</summary>
    [JsonIgnore] public bool CanResubmit        => Status == "revision_requested";
    /// <summary>True when HR can take an action (approve / reject / request revision).</summary>
    [JsonIgnore] public bool IsReviewable       => Status is "submitted" or "under_review";
    /// <summary>True when the quote can be converted to a job: approved and not yet converted.</summary>
    [JsonIgnore] public bool CanConvert         => IsApproved && !ConvertedToJobId.HasValue;
    /// <summary>True when the quote has already been converted to a job.</summary>
    [JsonIgnore] public bool IsConverted        => Status == "converted" || ConvertedToJobId.HasValue;

    [JsonIgnore]
    public string StatusLabel => Status switch
    {
        "draft"               => "Draft",
        "submitted"           => "Submitted",
        "under_review"        => "Under Review",
        "revision_requested"  => "Revision Requested",
        "approved"            => "Approved",
        "rejected"            => "Rejected",
        "expired"             => "Expired",
        "converted"           => "Converted",
        _                     => Status
    };

    [JsonIgnore]
    public string StatusBadgeBg => Status switch
    {
        "draft"               => "#1E293B",
        "submitted"           => "#1E3A5F",
        "under_review"        => "#1E3050",
        "revision_requested"  => "#3B2000",
        "approved"            => "#14532D",
        "rejected"            => "#7F1D1D",
        "expired"             => "#292012",
        "converted"           => "#14532D",
        _                     => "#1E293B"
    };

    [JsonIgnore]
    public string StatusBadgeFg => Status switch
    {
        "draft"               => "#64748B",
        "submitted"           => "#60A5FA",
        "under_review"        => "#93C5FD",
        "revision_requested"  => "#FDBA74",
        "approved"            => "#22C55E",
        "rejected"            => "#FCA5A5",
        "expired"             => "#FCD34D",
        "converted"           => "#86EFAC",
        _                     => "#94A3B8"
    };

    [JsonIgnore] public string SourceLabel => IsUpload ? "Uploaded Doc" : "Line Items";

    [JsonIgnore]
    public string VatModeLabel => VatMode switch
    {
        "none"      => "No VAT",
        "inclusive" => "VAT Inclusive",
        _           => "VAT Exclusive"
    };

    [JsonIgnore] public string VatRateDisplay       => $"{VatRate * 100:F0}%";
    [JsonIgnore] public string DiscountDisplay      => DiscountAmount  > 0 ? $"-R{DiscountAmount:N2}"  : "—";
    [JsonIgnore] public string FreightDisplay       => FreightAmount   > 0 ? $"+R{FreightAmount:N2}"   : "—";
    [JsonIgnore] public string DutyDisplay          => DutyAmount      > 0 ? $"+R{DutyAmount:N2}"      : "—";
    [JsonIgnore] public string LeviesDisplay        => LeviesAmount    > 0 ? $"+R{LeviesAmount:N2}"    : "—";
    [JsonIgnore] public string OtherChargesDisplay  => OtherChargesAmount > 0 ? $"+R{OtherChargesAmount:N2}" : "—";
    [JsonIgnore] public string TaxableDisplay       => $"R{TaxableAmount:N2}";
    [JsonIgnore] public bool   HasChargesOrDiscount =>
        DiscountAmount > 0 || FreightAmount > 0 || DutyAmount > 0 ||
        LeviesAmount > 0 || OtherChargesAmount > 0;
    [JsonIgnore] public string QuoteNumberDisplay => string.IsNullOrWhiteSpace(QuoteNumber) ? "—" : QuoteNumber;
    [JsonIgnore] public string TotalDisplay    => $"R{TotalAmount:N2}";
    [JsonIgnore] public string SubtotalDisplay => $"R{Subtotal:N2}";
    [JsonIgnore] public string VatDisplay => $"R{VatAmount:N2}";
    [JsonIgnore] public string QuoteDateDisplay => QuoteDate.ToString("dd MMM yyyy");
    [JsonIgnore] public string ValidUntilDisplay => ValidUntil.HasValue ? ValidUntil.Value.ToString("dd MMM yyyy") : "No expiry";
    [JsonIgnore] public string SubmittedAtDisplay => SubmittedAt.HasValue ? SubmittedAt.Value.ToLocalTime().ToString("dd MMM yyyy") : "—";
    [JsonIgnore] public string ReviewedAtDisplay   => ReviewedAt.HasValue   ? ReviewedAt.Value.ToLocalTime().ToString("dd MMM yyyy HH:mm") : "—";
    [JsonIgnore] public string ConvertedAtDisplay  => ConvertedAt.HasValue  ? ConvertedAt.Value.ToLocalTime().ToString("dd MMM yyyy HH:mm") : "—";
    [JsonIgnore] public string CreatedAtDisplay   => CreatedAt.ToLocalTime().ToString("dd MMM yyyy");
}
