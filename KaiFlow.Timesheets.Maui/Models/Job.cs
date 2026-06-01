using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum JobStatus { Scheduled, InProgress, Completed, Cancelled }
public enum JobPriority { None, Low, Medium, High, Critical }

[Table("jobs")]
public class Job : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("title")]
    public string Title { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("client_id")]
    public Guid? ClientId { get; set; }

    [Column("site_id")]
    public Guid? SiteId { get; set; }

    [Column("unit_id")]
    public Guid? UnitId { get; set; }

    [Column("scheduled_start")]
    public DateTime? ScheduledStart { get; set; }

    [Column("scheduled_end")]
    public DateTime? ScheduledEnd { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "scheduled";

    [Column("priority")]
    public string PriorityRaw { get; set; } = "none";

    [Column("opened_at")]
    public DateTime? OpenedAt { get; set; }

    [Column("first_response_at")]
    public DateTime? FirstResponseAt { get; set; }

    [Column("closed_at")]
    public DateTime? ClosedAt { get; set; }

    [Column("assignee_employee_id")]
    public Guid? AssigneeEmployeeId { get; set; }

    [Column("assigned_employee_ids")]
    public List<Guid> AssignedEmployeeIds { get; set; } = [];

    [Column("contractor_employee_id")]
    public Guid? ContractorEmployeeId { get; set; }

    [Column("contractor_id")]
    public Guid? ContractorId { get; set; }

    [Column("contractor_cost")]
    public double ContractorCost { get; set; }

    [Column("estimated_cost")]
    public double EstimatedCost { get; set; }

    [Column("actual_cost")]
    public double ActualCost { get; set; }

    [Column("inventory_cost")]
    public double InventoryCost { get; set; }

    [Column("labor_cost")]
    public double LaborCost { get; set; }

    [Column("is_callback")]
    public bool IsCallback { get; set; }

    [Column("is_preventive")]
    public bool IsPreventive { get; set; }

    [Column("parent_job_id")]
    public Guid? ParentJobId { get; set; }

    [Column("external_ref")]
    public string? ExternalRef { get; set; }

    [Column("site_radius_mode")]
    public bool SiteRadiusMode { get; set; }

    [Column("site_radius_meters")]
    public double SiteRadiusMeters { get; set; } = 200;

    [Column("resident_reporter")]
    public string? ResidentReporter { get; set; }

    [Column("photo_urls")]
    public List<string> PhotoUrls { get; set; } = [];

    [Column("photo_urls_before")]
    public List<string> PhotoUrlsBefore { get; set; } = [];

    [Column("photo_urls_after")]
    public List<string> PhotoUrlsAfter { get; set; } = [];

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("deal_id")]
    public Guid? DealId { get; set; }

    [Column("job_code")]
    public string? JobCode { get; set; }

    [Column("visibility")]
    public string VisibilityRaw { get; set; } = "inherit";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("created_by_employee_id")]
    [JsonProperty("created_by_employee_id")]
    public Guid? CreatedByEmployeeId { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    [JsonIgnore] public string JobCodeDisplay => string.IsNullOrWhiteSpace(JobCode) ? "—" : JobCode!;
    [JsonIgnore] public bool HasProject => DealId.HasValue;
    [JsonIgnore] public string ContractorCostDisplay => $"R{ContractorCost:N2}";

    [JsonIgnore]
    public JobStatus Status => StatusRaw switch
    {
        "inProgress" or "in_progress" => JobStatus.InProgress,
        "completed" => JobStatus.Completed,
        "cancelled" => JobStatus.Cancelled,
        _ => JobStatus.Scheduled
    };

    [JsonIgnore]
    public JobPriority Priority => PriorityRaw switch
    {
        "critical" => JobPriority.Critical,
        "high" => JobPriority.High,
        "medium" => JobPriority.Medium,
        "low" => JobPriority.Low,
        _ => JobPriority.None
    };

    [JsonIgnore] public double TotalCost => ActualCost + InventoryCost + LaborCost;
    [JsonIgnore] public bool IsOpen => Status is JobStatus.Scheduled or JobStatus.InProgress;

    [JsonIgnore]
    public TimeSpan? SlaResponseTime => FirstResponseAt.HasValue && OpenedAt.HasValue
        ? FirstResponseAt.Value - OpenedAt.Value
        : null;

    [JsonIgnore]
    public TimeSpan? SlaResolutionTime => ClosedAt.HasValue && OpenedAt.HasValue
        ? ClosedAt.Value - OpenedAt.Value
        : null;
}
