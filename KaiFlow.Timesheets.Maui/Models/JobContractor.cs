using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Phase A — many-to-many mapping between jobs and contractors.
/// Extends jobs.contractor_id (which is preserved for backward compatibility)
/// to support multiple contractors per job.
///
/// Loaded via PostgREST relational embed (Select "*, jobs(*)") so the
/// <see cref="Job"/> navigation property is populated in one round-trip.
/// </summary>
[Table("job_contractors")]
public class JobContractor : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("contractor_id")]
    public Guid ContractorId { get; set; }

    [Column("quote_id")]
    public Guid? QuoteId { get; set; }

    [Column("role")]
    public string Role { get; set; } = "general";

    [Column("scope_notes")]
    public string? ScopeNotes { get; set; }

    [Column("quoted_amount")]
    public decimal QuotedAmount { get; set; }

    [Column("agreed_amount")]
    public decimal AgreedAmount { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "assigned";

    [Column("assigned_at")]
    public DateTime AssignedAt { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    [Column("created_by")]
    public Guid? CreatedBy { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    // ── PostgREST relational embed ────────────────────────────────────────────
    // Populated when the service uses Select("*, jobs(*)").
    // Null-safe delegation properties below guard against embed being absent.
    [JsonProperty("jobs")]
    public Job? Job { get; set; }

    // ── Display helpers for Contractor Details → Jobs tab ─────────────────────

    [JsonIgnore]
    public string RoleDisplay => string.IsNullOrWhiteSpace(Role) || Role == "general"
        ? "General"
        : System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(Role);

    [JsonIgnore]
    public string AgreedAmountDisplay => AgreedAmount > 0 ? $"R{AgreedAmount:N2}" : "—";

    // ── Job-delegated display helpers (null-safe) ─────────────────────────────
    // These let the XAML DataTemplate bind flat paths on JobContractor rather
    // than two-level paths (which compiled bindings handle less gracefully when
    // the navigation property is nullable).

    [JsonIgnore] public string JobCodeDisplay       => Job?.JobCodeDisplay       ?? "—";
    [JsonIgnore] public string JobTitle             => Job?.Title                ?? "—";
    [JsonIgnore] public string JobStatusLabel       => Job?.StatusLabel          ?? "—";
    [JsonIgnore] public string JobStatusBadgeBg     => Job?.StatusBadgeBg        ?? "#1E293B";
    [JsonIgnore] public string JobStatusBadgeFg     => Job?.StatusBadgeFg        ?? "#64748B";
    [JsonIgnore] public string JobScheduledDisplay  => Job?.ScheduledStartDisplay ?? "—";

    // Populated by HrContractorDetailsViewModel after loading the project lookup.
    // Not a DB column — set in-memory so XAML compiled bindings can use a flat path.
    [JsonIgnore] public string JobProjectDisplay { get; set; } = "—";

    // Populated by HrJobDetailsViewModel after loading the contractor name lookup.
    // Not a DB column — set in-memory so XAML compiled bindings can use a flat path.
    [JsonIgnore] public string ContractorDisplayName { get; set; } = "";

    // ── Status helpers ────────────────────────────────────────────────────────

    [JsonIgnore]
    public string StatusLabel => StatusRaw switch
    {
        "in_progress" => "In Progress",
        "completed"   => "Completed",
        "cancelled"   => "Cancelled",
        _             => "Assigned"
    };

    [JsonIgnore]
    public string StatusBadgeBg => StatusRaw switch
    {
        "in_progress" => "#292012",
        "completed"   => "#14532D",
        "cancelled"   => "#7F1D1D",
        _             => "#1E3A5F"
    };

    [JsonIgnore]
    public string StatusBadgeFg => StatusRaw switch
    {
        "in_progress" => "#FCD34D",
        "completed"   => "#22C55E",
        "cancelled"   => "#FCA5A5",
        _             => "#60A5FA"
    };

    [JsonIgnore] public bool IsActive    => StatusRaw is "assigned" or "in_progress";
    [JsonIgnore] public bool IsCompleted => StatusRaw == "completed";
    [JsonIgnore] public bool IsCancelled => StatusRaw == "cancelled";

    // ── Phase G: financial summaries — set in-memory by VMs after loading payouts ─
    // These are NOT DB columns. They follow the same pattern as ContractorDisplayName
    // and JobProjectDisplay above.
    [JsonIgnore] public decimal PaidAmount     { get; set; }
    [JsonIgnore] public decimal ApprovedAmount { get; set; }
    [JsonIgnore] public decimal PendingAmount  { get; set; }

    [JsonIgnore] public decimal Variance =>
        AgreedAmount > 0 ? AgreedAmount - PaidAmount - ApprovedAmount : 0;

    [JsonIgnore] public bool HasFinancialSummary =>
        AgreedAmount > 0 || PaidAmount > 0 || PendingAmount > 0;

    [JsonIgnore] public string PaidAmountDisplay =>
        PaidAmount > 0 ? $"R{PaidAmount:N2}" : "—";

    [JsonIgnore] public string ApprovedAmountDisplay =>
        ApprovedAmount > 0 ? $"R{ApprovedAmount:N2}" : "—";

    [JsonIgnore] public string PendingAmountDisplay =>
        PendingAmount > 0 ? $"R{PendingAmount:N2}" : "—";

    [JsonIgnore] public string VarianceSummary =>
        AgreedAmount <= 0 ? "" :
        Variance > 0 ? $"Balance R{Variance:N2}" :
        Variance < 0 ? $"Over R{Math.Abs(Variance):N2}" :
        "Settled ✓";

    [JsonIgnore] public string VarianceColor =>
        Variance < 0 ? "#EF4444" : Variance == 0 ? "#22C55E" : "#F59E0B";

    // ── Phase M: compliance hold — set in-memory during contractor enrichment ─
    [JsonIgnore] public bool ContractorComplianceHold { get; set; }
}
