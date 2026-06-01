namespace KaiFlow.Timesheets.Models;

public class SelfRegisterResult
{
    public string Status { get; set; } = "";       // "linked" or "pending"
    public Guid EmployeeId { get; set; }
    public Guid CompanyId { get; set; }
    public string? AccessLevel { get; set; }
    public string? CompanyName { get; set; }

    public bool IsLinked => Status == "linked";
    public bool IsPending => Status == "pending";

    public bool IsHr => AccessLevel is "owner" or "hr_admin" or "admin";

    public bool UsesCompanyDashboard =>
        AccessLevel is "owner" or "hr_admin" or "admin" or "manager";
}
