namespace KaiFlow.Timesheets.Models;

/// <summary>Field-worker job creation payload (maps to employee_create_job RPC).</summary>
public class EmployeeCreateJobRequest
{
    public Guid CompanyId { get; set; }
    public Guid CreatorEmployeeId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public string PriorityRaw { get; set; } = "medium";
    public DateTime? ScheduledStart { get; set; }
    public DateTime? ScheduledEnd { get; set; }
    public Guid? SiteId { get; set; }
    public Guid? ClientId { get; set; }
    public Guid? AssigneeEmployeeId { get; set; }
    public List<Guid> AssignedEmployeeIds { get; set; } = [];
    public Guid? NotifyManagerEmployeeId { get; set; }
    public string VisibilityRaw { get; set; } = "inherit";
}
