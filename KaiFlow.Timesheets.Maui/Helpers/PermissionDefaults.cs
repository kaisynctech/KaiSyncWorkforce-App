namespace KaiFlow.Timesheets.Helpers;

/// <summary>Fallback when my_permissions RPC is unavailable (offline / type mismatch).</summary>
public static class PermissionDefaults
{
    public static IReadOnlyDictionary<string, bool> ForAccessLevel(string accessLevelRaw)
    {
        var role = accessLevelRaw switch
        {
            "owner" => "owner",
            "hr_admin" or "hrAdmin" or "hr" => "hr_admin",
            "admin" => "admin",
            "manager" => "manager",
            _ => "employee"
        };

        if (role == "owner")
            return AllKeysTrue();

        return role switch
        {
            "hr_admin" => HrAdmin(),
            "admin" => Admin(),
            "manager" => Manager(),
            _ => Employee()
        };
    }

    private static Dictionary<string, bool> AllKeysTrue()
    {
        var d = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        foreach (var key in AllKeys())
            d[key] = true;
        return d;
    }

    private static IEnumerable<string> AllKeys() =>
    [
        PermissionKeys.ProjectsView, PermissionKeys.ProjectsViewAll, PermissionKeys.ProjectsCreate, PermissionKeys.ProjectsEdit,
        PermissionKeys.JobsView, PermissionKeys.JobsViewAll, PermissionKeys.JobsCreate, PermissionKeys.JobsEdit,
        PermissionKeys.EmployeesView, PermissionKeys.EmployeesCreate, PermissionKeys.EmployeesEdit,
        PermissionKeys.ContractorsView, PermissionKeys.ContractorsCreate, PermissionKeys.ContractorsEdit,
        PermissionKeys.ClientsView, PermissionKeys.ClientsEdit,
        PermissionKeys.InventoryView, PermissionKeys.InventoryEdit,
        PermissionKeys.AttendanceViewTeam, PermissionKeys.AttendanceViewAll,
        PermissionKeys.LeaveViewAll, PermissionKeys.LeaveApprove,
        PermissionKeys.PaymentsViewPayroll, PermissionKeys.PaymentsApprove,
        PermissionKeys.ReportsViewOperational, PermissionKeys.ReportsViewFinancial,
        PermissionKeys.SettingsView
    ];

    private static Dictionary<string, bool> HrAdmin() => new(StringComparer.OrdinalIgnoreCase)
    {
        [PermissionKeys.ProjectsView] = true,
        [PermissionKeys.ProjectsViewAll] = true,
        [PermissionKeys.ProjectsCreate] = true,
        [PermissionKeys.ProjectsEdit] = true,
        [PermissionKeys.JobsView] = true,
        [PermissionKeys.JobsViewAll] = true,
        [PermissionKeys.JobsCreate] = true,
        [PermissionKeys.JobsEdit] = true,
        [PermissionKeys.EmployeesView] = true,
        [PermissionKeys.EmployeesCreate] = true,
        [PermissionKeys.EmployeesEdit] = true,
        [PermissionKeys.ContractorsView] = true,
        [PermissionKeys.ContractorsCreate] = true,
        [PermissionKeys.ContractorsEdit] = true,
        [PermissionKeys.ClientsView] = true,
        [PermissionKeys.ClientsEdit] = true,
        [PermissionKeys.InventoryView] = true,
        [PermissionKeys.InventoryEdit] = true,
        [PermissionKeys.AttendanceViewTeam] = true,
        [PermissionKeys.AttendanceViewAll] = true,
        [PermissionKeys.LeaveViewAll] = true,
        [PermissionKeys.LeaveApprove] = true,
        [PermissionKeys.PaymentsViewPayroll] = true,
        [PermissionKeys.PaymentsApprove] = true,
        [PermissionKeys.ReportsViewOperational] = true,
        [PermissionKeys.ReportsViewFinancial] = true,
        [PermissionKeys.SettingsView] = true
    };

    private static Dictionary<string, bool> Admin() => HrAdmin();

    private static Dictionary<string, bool> Manager() => new(StringComparer.OrdinalIgnoreCase)
    {
        [PermissionKeys.ProjectsView] = true,
        [PermissionKeys.ProjectsViewAll] = false,
        [PermissionKeys.ProjectsCreate] = true,
        [PermissionKeys.ProjectsEdit] = true,
        [PermissionKeys.JobsView] = true,
        [PermissionKeys.JobsViewAll] = false,
        [PermissionKeys.JobsCreate] = true,
        [PermissionKeys.JobsEdit] = true,
        [PermissionKeys.EmployeesView] = true,
        [PermissionKeys.EmployeesCreate] = true,
        [PermissionKeys.EmployeesEdit] = true,
        [PermissionKeys.ContractorsView] = true,
        [PermissionKeys.ContractorsCreate] = true,
        [PermissionKeys.ContractorsEdit] = true,
        [PermissionKeys.ClientsView] = true,
        [PermissionKeys.ClientsEdit] = true,
        [PermissionKeys.InventoryView] = true,
        [PermissionKeys.InventoryEdit] = true,
        [PermissionKeys.AttendanceViewTeam] = true,
        [PermissionKeys.AttendanceViewAll] = false,
        [PermissionKeys.LeaveViewAll] = false,
        [PermissionKeys.LeaveApprove] = false,
        [PermissionKeys.PaymentsViewPayroll] = false,
        [PermissionKeys.ReportsViewOperational] = true,
        [PermissionKeys.ReportsViewFinancial] = false,
        [PermissionKeys.SettingsView] = false
    };

    private static Dictionary<string, bool> Employee() => new(StringComparer.OrdinalIgnoreCase)
    {
        [PermissionKeys.ProjectsView] = true,
        [PermissionKeys.JobsView] = true,
        [PermissionKeys.ClientsView] = true,
        [PermissionKeys.InventoryView] = true,
        [PermissionKeys.AttendanceViewTeam] = false,
        [PermissionKeys.AttendanceViewAll] = false
    };
}
