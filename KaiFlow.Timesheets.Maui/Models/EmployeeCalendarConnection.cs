using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("employee_calendar_connections")]
public class EmployeeCalendarConnection : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("provider")]
    public string Provider { get; set; } = "google";

    [Column("calendar_id")]
    public string? CalendarId { get; set; }

    [Column("calendar_label")]
    public string? CalendarLabel { get; set; }

    [Column("sync_enabled")]
    public bool SyncEnabled { get; set; } = true;

    [Column("last_sync_at")]
    public DateTime? LastSyncAt { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public bool IsConnected => !string.IsNullOrEmpty(CalendarLabel) || LastSyncAt.HasValue;
}
