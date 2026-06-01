using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Singleton holding the signed-in employee + company state (equivalent to Flutter's TimesheetProvider).
/// </summary>
public class TimesheetStateService
{
    public Employee? CurrentEmployee { get; private set; }
    public Company? CurrentCompany { get; private set; }
    public TimePunch? LastPunch { get; private set; }

    public event EventHandler? StateChanged;

    public bool IsSignedIn => CurrentEmployee != null;

    // Set to true when user manually navigates back to the login screen (not signing out).
    // Prevents InitializeAsync from auto-navigating them back to the dashboard.
    public bool SuppressAutoLogin { get; set; }
    public bool IsClockedIn => LastPunch?.PunchType == PunchType.In;

    public bool IsOwner => CurrentEmployee?.AccessLevelRaw == "owner";
    public bool IsOwnerOrAdmin => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin";
    public bool IsHrOrAbove => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin" or "hr";
    public bool IsManagerOrAbove => CurrentEmployee?.AccessLevelRaw is "owner" or "admin" or "hr_admin" or "hr" or "manager";

    public void SetEmployee(Employee employee)
    {
        CurrentEmployee = employee;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public void SetCompany(Company company)
    {
        CurrentCompany = company;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public void SetLastPunch(TimePunch? punch)
    {
        LastPunch = punch;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Clear()
    {
        CurrentEmployee = null;
        CurrentCompany = null;
        LastPunch = null;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }
}
