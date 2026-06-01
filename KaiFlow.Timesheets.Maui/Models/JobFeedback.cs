using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("job_feedback")]
public class JobFeedback : BaseModel
{
    [PrimaryKey("id")]
    [JsonProperty("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [Column("job_id")]
    [JsonProperty("job_id")]
    public Guid JobId { get; set; }

    [Column("employee_id")]
    [JsonProperty("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("rating")]
    [JsonProperty("rating")]
    public int Rating { get; set; }

    [Column("comments")]
    [JsonProperty("comments")]
    public string? Comments { get; set; }

    [Column("submitted_at")]
    [JsonProperty("submitted_at")]
    public DateTime SubmittedAt { get; set; }

    [JsonIgnore]
    public string DisplaySummary =>
        $"{Rating}/5 · {SubmittedAt.ToLocalTime():dd MMM yyyy h:mm tt}" +
        (string.IsNullOrWhiteSpace(Comments) ? "" : $" — {Comments}");
}
