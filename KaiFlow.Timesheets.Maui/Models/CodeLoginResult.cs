namespace KaiFlow.Timesheets.Models;

public class CodeLoginResult
{
    public string SessionToken { get; set; } = "";
    public Employee Employee { get; set; } = new();
    public Company Company { get; set; } = new();
    public List<EmployeeMembership> Memberships { get; set; } = [];

    /// <summary>
    /// True when the employee has no PIN set yet (first login) or HR has reset their PIN.
    /// The client must navigate to PIN setup before proceeding to the dashboard.
    /// </summary>
    public bool NeedsPinSetup { get; set; }

    /// <summary>
    /// True when the employee has an active PIN stored server-side.
    /// Used to route returning employees directly to the PIN entry screen.
    /// </summary>
    public bool PinSet { get; set; }
}
