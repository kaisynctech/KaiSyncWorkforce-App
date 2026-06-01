using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum LeaveStatus { Pending, Approved, Declined, Cancelled }

[Table("leave_requests")]
public class LeaveRequest : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("leave_type")]
    public string LeaveType { get; set; } = "";

    [Column("start_date")]
    public DateOnly StartDate { get; set; }

    [Column("end_date")]
    public DateOnly EndDate { get; set; }

    [Column("half_day_start")]
    public bool HalfDayStart { get; set; }

    [Column("half_day_end")]
    public bool HalfDayEnd { get; set; }

    [Column("total_days")]
    public double TotalDays { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "pending";

    [Column("reason")]
    public string? Reason { get; set; }

    [Column("decision_note")]
    public string? DecisionNote { get; set; }

    [Column("approver_hr_user_id")]
    public Guid? ApproverHrUserId { get; set; }

    [Column("decided_at")]
    public DateTime? DecidedAt { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("attachment_url")]
    public string? AttachmentUrl { get; set; }

    [JsonIgnore]
    public LeaveStatus Status => StatusRaw switch
    {
        "approved" => LeaveStatus.Approved,
        "declined" => LeaveStatus.Declined,
        "cancelled" => LeaveStatus.Cancelled,
        _ => LeaveStatus.Pending
    };

    [JsonIgnore] public bool IsPending    => Status == LeaveStatus.Pending;
    [JsonIgnore] public bool IsNotPending => Status != LeaveStatus.Pending;
    [JsonIgnore] public bool IsApproved   => Status == LeaveStatus.Approved;
}
