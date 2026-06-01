using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("calendar_events")]
public class CalendarEvent : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

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

    [Column("attendee_ids")]
    public List<Guid> AttendeeIds { get; set; } = [];

    [Column("location")]
    public string? Location { get; set; }

    [Column("event_type")]
    public string EventType { get; set; } = "general";

    [Column("linked_job_id")]
    public Guid? LinkedJobId { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_by")]
    public Guid CreatedBy { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("attendance_responses")]
    public Dictionary<string, string> AttendanceResponses { get; set; } = [];

    public string GetAttendance(Guid employeeId)
        => AttendanceResponses.GetValueOrDefault(employeeId.ToString(), "pending");
}
