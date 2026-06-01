using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("incident_comments")]
public class IncidentComment : BaseModel
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

    [Column("author_employee_id")]
    [JsonProperty("author_employee_id")]
    public Guid? AuthorEmployeeId { get; set; }

    [Column("author_name")]
    [JsonProperty("author_name")]
    public string? AuthorName { get; set; }

    [Column("body")]
    [JsonProperty("body")]
    public string Body { get; set; } = "";

    [Column("created_at")]
    [JsonProperty("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public string AuthorDisplay => string.IsNullOrWhiteSpace(AuthorName) ? "Unknown" : AuthorName!;
}
