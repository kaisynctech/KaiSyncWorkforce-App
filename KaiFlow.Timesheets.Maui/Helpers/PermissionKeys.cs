namespace KaiFlow.Timesheets.Helpers;

/// <summary>Permission keys aligned with company_role_permissions seed / Owner matrix.</summary>
public static class PermissionKeys
{
    public const string ProjectsView = "projects.view";
    public const string ProjectsViewAll = "projects.view_all";
    public const string ProjectsCreate = "projects.create";
    public const string ProjectsEdit = "projects.edit";

    public const string JobsView = "jobs.view";
    public const string JobsViewAll = "jobs.view_all";
    public const string JobsCreate = "jobs.create";
    public const string JobsEdit = "jobs.edit";

    public const string EmployeesView = "employees.view";
    public const string EmployeesCreate = "employees.create";
    public const string EmployeesEdit = "employees.edit";

    public const string ContractorsView = "contractors.view";
    public const string ContractorsCreate = "contractors.create";
    public const string ContractorsEdit = "contractors.edit";

    public const string ClientsView = "clients.view";
    public const string ClientsEdit = "clients.edit";
    public const string InventoryView = "inventory.view";
    public const string InventoryEdit = "inventory.edit";
    public const string SuppliersView = "suppliers.view";
    public const string SuppliersEdit = "suppliers.edit";

    public const string AttendanceViewTeam = "attendance.view_team";
    public const string AttendanceViewAll = "attendance.view_all";

    public const string LeaveViewAll = "leave.view_all";
    public const string LeaveApprove = "leave.approve";

    public const string PaymentsViewPayroll = "payments.view_payroll";
    public const string PaymentsApprove = "payments.approve";

    public const string ReportsViewOperational = "reports.view_operational";
    public const string ReportsViewFinancial = "reports.view_financial";

    public const string SettingsView = "settings.view";
}
