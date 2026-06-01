using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("external_calendar_events")]
public class ExternalCalendarEvent : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("provider")]
    public string Provider { get; set; } = "google";

    [Column("external_id")]
    public string ExternalId { get; set; } = "";

    [Column("title")]
    public string Title { get; set; } = "";

    [Column("description")]
    public string? Description { get; set; }

    [Column("start_time")]
    public DateTime StartTime { get; set; }

    [Column("end_time")]
    public DateTime? EndTime { get; set; }

    [Column("is_all_day")]
    public bool IsAllDay { get; set; }

    [Column("location")]
    public string? Location { get; set; }
}
