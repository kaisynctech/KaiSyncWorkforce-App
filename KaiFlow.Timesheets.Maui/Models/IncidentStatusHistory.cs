using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("incident_status_history")]
public class IncidentStatusHistory : BaseModel
{
    [PrimaryKey("id")]
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("incident_id")]
    [JsonProperty("incident_id")]
    public Guid IncidentId { get; set; }

    [Column("changed_by_employee_id")]
    [JsonProperty("changed_by_employee_id")]
    public Guid? ChangedByEmployeeId { get; set; }

    [Column("old_status")]
    [JsonProperty("old_status")]
    public string? OldStatus { get; set; }

    [Column("new_status")]
    [JsonProperty("new_status")]
    public string NewStatus { get; set; } = "";

    [Column("notes")]
    [JsonProperty("notes")]
    public string? Notes { get; set; }

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }
}
