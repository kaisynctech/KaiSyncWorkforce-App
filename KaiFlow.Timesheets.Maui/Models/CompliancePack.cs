using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

/// <summary>
/// Company-configurable compliance pack template.
/// Defines which document types are required (or recommended) for a category of contractor.
/// Phase 2B.3a — table: contractor_compliance_packs.
/// </summary>
[Table("contractor_compliance_packs")]
public class CompliancePack : BaseModel
{
    [PrimaryKey("id")]      public Guid    Id          { get; set; }
    [Column("company_id")]  public Guid    CompanyId   { get; set; }
    [Column("name")]        public string  Name        { get; set; } = "";
    [Column("pack_code")]   public string  PackCode    { get; set; } = "";
    [Column("description")] public string? Description { get; set; }
    [Column("is_default")]  public bool    IsDefault   { get; set; }
    [Column("is_archived")] public bool    IsArchived  { get; set; }
    [Column("sort_order")]  public int     SortOrder   { get; set; }
    [Column("created_at")]  public DateTime CreatedAt  { get; set; }
    [Column("updated_at")]  public DateTime UpdatedAt  { get; set; }

    // ── Populated by service layer (not from PostgREST response) ──────────────

    /// <summary>Items loaded separately via GetCompliancePackItemsAsync.</summary>
    [JsonIgnore] public List<CompliancePackItem> Items { get; set; } = [];

    // ── Computed display helpers ───────────────────────────────────────────────

    [JsonIgnore] public int  RequiredCount    => Items.Count(i => i.IsRequired);
    [JsonIgnore] public int  RecommendedCount => Items.Count(i => i.IsRecommended);
    [JsonIgnore] public bool ShowDefaultBadge => IsDefault;

    [JsonIgnore] public string RequiredLabel =>
        RequiredCount == 1 ? "1 required" : $"{RequiredCount} required";

    [JsonIgnore] public string RecommendedLabel =>
        RecommendedCount == 0 ? "" : $"{RecommendedCount} recommended";

    [JsonIgnore] public string SummaryLabel =>
        Items.Count == 0 ? "No document types defined"
                         : $"{RequiredCount} required · {RecommendedCount} recommended";
}
