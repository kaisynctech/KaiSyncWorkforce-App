namespace KaiFlow.Timesheets.Models;

public class LockedEmployee
{
    public Guid EmployeeId { get; set; }
    public string FullName { get; set; } = "";
    public DateTimeOffset? LockedAt { get; set; }
    public string? LockedReason { get; set; }

    public string LockedReasonDisplay => LockedReason switch
    {
        "pin_attempts"   => "Too many incorrect PINs",
        "login_attempts" => "Too many failed sign-in attempts",
        "hr_manual"      => "Manually locked by HR",
        _                => "Unknown"
    };
}
