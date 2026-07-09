namespace KaiFlow.Timesheets.Services;

/// <summary>Three sidebar display states — persisted to Preferences.</summary>
public enum SidebarMode { Expanded, Collapsed, Hidden }

/// <summary>
/// Identifies which top-level module the user is currently viewing.
/// Tab-swap modules (0–22) match the existing ActiveTab values.
/// Shell-navigation modules (100+) have no corresponding tab.
/// </summary>
public enum ActiveModule
{
    None = -1,

    // ── Tab-swap modules (match ActiveTab integers in HrDashboardViewModel) ──
    Overview      =  0,
    MyProfile     =  1,
    Employees     =  2,
    Attendance    =  3,
    Jobs          =  4,
    Payroll       =  5,
    Clients       =  7,
    Messages      = 17,
    Leave         = 20,
    MyPa          = 22,
    Projects      = 19,

    // ── Shell-navigation modules (own pages, no dashboard tab) ───────────────
    Finance          = 100,
    Contractors      = 101,
    Inventory        = 102,
    Suppliers        = 103,
    Assets           = 104,
    Properties       = 105,
    Incidents        = 106,
    Reports          = 107,
    Scheduling       = 108,
    WorkTeams        = 109,
    Notifications    = 110,
    ActivityLog      = 111,
    Settings         = 112,
    PlatformConsole  = 200,
}
