using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Phase A — many-to-many mapping between client_deals (projects) and contractors.
/// Auto-populated from job_contractors during Phase A backfill; may also be created
/// directly when a contractor is engaged at the project level without a specific job.
///
/// Loaded via PostgREST relational embed (Select "*, client_deals(*)") so the
/// <see cref="Project"/> navigation property is populated in one round-trip.
/// </summary>
[Table("project_contractors")]
public class ProjectContractor : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid DealId { get; set; }

    [Column("contractor_id")]
    public Guid ContractorId { get; set; }

    [Column("role")]
    public string Role { get; set; } = "general";

    [Column("scope_notes")]
    public string? ScopeNotes { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "active";

    [Column("assigned_at")]
    public DateTime AssignedAt { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    // ── PostgREST relational embed ────────────────────────────────────────────
    // Populated when the service uses Select("*, client_deals(*)").
    [JsonProperty("client_deals")]
    public ClientDeal? Project { get; set; }

    // ── Display helpers for Contractor Details → Projects tab ─────────────────

    [JsonIgnore]
    public string RoleDisplay => string.IsNullOrWhiteSpace(Role) || Role == "general"
        ? "General"
        : System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(Role);

    [JsonIgnore]
    public string StatusLabel => StatusRaw switch
    {
        "completed" => "Completed",
        "removed"   => "Removed",
        _           => "Active"
    };

    [JsonIgnore]
    public string StatusBadgeBg => StatusRaw switch
    {
        "completed" => "#14532D",
        "removed"   => "#7F1D1D",
        _           => "#1E3A5F"
    };

    [JsonIgnore]
    public string StatusBadgeFg => StatusRaw switch
    {
        "completed" => "#22C55E",
        "removed"   => "#FCA5A5",
        _           => "#60A5FA"
    };

    // ── Project-delegated display helpers (null-safe) ─────────────────────────

    [JsonIgnore] public string ProjectTitle       => Project?.Title              ?? "—";
    [JsonIgnore] public string ProjectCodeDisplay => Project?.ProjectCodeDisplay  ?? "—";
    [JsonIgnore] public string ProjectStatusLabel => Project?.StatusLabel         ?? "—";

    [JsonIgnore] public bool IsActive    => StatusRaw == "active";
    [JsonIgnore] public bool IsCompleted => StatusRaw == "completed";
    [JsonIgnore] public bool IsRemoved   => StatusRaw == "removed";
}
