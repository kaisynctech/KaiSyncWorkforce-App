using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_cards")]
public class JobCard : BaseModel
{
    [PrimaryKey("id")]
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [Column("job_id")]
    [JsonProperty("job_id")]
    public Guid JobId { get; set; }

    [Column("employee_id")]
    [JsonProperty("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("work_performed")]
    public string? WorkPerformed { get; set; }

    [Column("materials_used")]
    public string? MaterialsUsed { get; set; }

    [Column("client_signature_url")]
    public string? ClientSignatureUrl { get; set; }

    [Column("employee_signature_url")]
    public string? EmployeeSignatureUrl { get; set; }

    [Column("client_name_signed")]
    public string? ClientNameSigned { get; set; }

    [Column("photo_urls")]
    public List<string> PhotoUrls { get; set; } = [];

    [Column("checklist_items")]
    public List<JobChecklistItem> ChecklistItems { get; set; } = [];

    [Column("start_time")]
    [JsonProperty("start_time")]
    public DateTime? StartTime { get; set; }

    [Column("end_time")]
    [JsonProperty("end_time")]
    public DateTime? EndTime { get; set; }

    [Column("is_completed")]
    public bool IsCompleted { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }

    public TimeSpan? WorkDuration => StartTime.HasValue && EndTime.HasValue
        ? EndTime.Value - StartTime.Value
        : null;
}
