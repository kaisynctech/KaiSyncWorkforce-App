using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum IncidentSeverity { Low, Medium, High, Critical }

public static class IncidentCategories
{
    public static readonly string[] All =
        ["general", "safety", "injury", "equipment", "property", "environmental"];
}

public static class IncidentStatuses
{
    public static readonly string[] All = ["open", "investigating", "resolved", "closed"];
}

[Table("incident_reports")]
public class IncidentReport : BaseModel
{
    [PrimaryKey("id")]
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    [JsonProperty("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("contractor_id")]
    public Guid? ContractorId { get; set; }

    [Column("reported_by_name")]
    public string? ReportedByName { get; set; }

    [Column("job_id")]
    [JsonProperty("job_id")]
    public Guid? JobId { get; set; }

    [Column("site_id")]
    [JsonProperty("site_id")]
    public Guid? SiteId { get; set; }

    [Column("title")]
    [JsonProperty("title")]
    public string? Title { get; set; }

    [Column("description")]
    [JsonProperty("description")]
    public string Description { get; set; } = "";

    [Column("severity")]
    [JsonProperty("severity")]
    public string SeverityRaw { get; set; } = "low";

    [Column("category")]
    [JsonProperty("category")]
    public string CategoryRaw { get; set; } = "general";

    [Column("status")]
    [JsonProperty("status")]
    public string StatusRaw { get; set; } = "open";

    [Column("photo_urls")]
    public List<string> PhotoUrls { get; set; } = [];

    [Column("is_closed")]
    public bool IsClosed { get; set; }

    [Column("resolution_notes")]
    public string? ResolutionNotes { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("assignee_id")]
    [JsonProperty("assignee_id")]
    public Guid? AssigneeId { get; set; }

    [Column("occurred_at")]
    [JsonProperty("occurred_at")]
    public DateTime? OccurredAt { get; set; }

    [Column("latitude")]
    [JsonProperty("latitude")]
    public double? Latitude { get; set; }

    [Column("longitude")]
    [JsonProperty("longitude")]
    public double? Longitude { get; set; }

    [Column("location_text")]
    [JsonProperty("location_text")]
    public string? LocationText { get; set; }

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    [JsonProperty("updated_at")]
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore]
    public IncidentSeverity Severity => SeverityRaw switch
    {
        "critical" => IncidentSeverity.Critical,
        "high" => IncidentSeverity.High,
        "medium" => IncidentSeverity.Medium,
        _ => IncidentSeverity.Low
    };

    [JsonIgnore] public bool HasPhotos => PhotoUrls.Count > 0;
    [JsonIgnore] public bool IsJobLinked => JobId.HasValue;
    [JsonIgnore] public bool IsOpen => StatusRaw is "open" or "investigating";
    [JsonIgnore] public string DisplayTitle => string.IsNullOrWhiteSpace(Title)
        ? (Description.Length > 60 ? Description[..60] + "…" : Description)
        : Title!;
}
