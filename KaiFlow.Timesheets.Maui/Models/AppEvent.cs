using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("app_events")]
public class AppEvent : BaseModel
{
    [PrimaryKey("id")]
    public long Id { get; set; }

    [Column("company_id")]
    public Guid? CompanyId { get; set; }

    [Column("auth_user_id")]
    public Guid? AuthUserId { get; set; }

    [Column("screen")]
    public string Screen { get; set; } = "";

    [Column("action")]
    public string Action { get; set; } = "";

    [Column("level")]
    public string Level { get; set; } = "info";

    [Column("error_text")]
    public string? ErrorText { get; set; }

    [Column("meta")]
    public Dictionary<string, object>? Meta { get; set; }

    [Column("user_agent")]
    public string? UserAgent { get; set; }

    [Column("app_version")]
    public string? AppVersion { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}
