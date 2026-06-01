using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

internal static class EmployeeAccountRouting
{
    public const string LoginRoute = AppRoutes.IdEntry;
    public const string CompanyPickerRoute = AppRoutes.EmployeeCompanySelector;
    public const string EmployeeDashboardRoute = AppRoutes.EmployeeDashboard;
    public const string HrDashboardRoute = AppRoutes.HrDashboard;

    public static Task GoToCompanyPickerAsync()
        => ShellNavigation.GoToAsync(CompanyPickerRoute);

    public static Task GoToEmployeeDashboardAsync()
        => ShellNavigation.GoToAsync(EmployeeDashboardRoute);

    public static Task GoToHrDashboardAsync()
        => ShellNavigation.GoToAsync(HrDashboardRoute);

    public static Task GoToLoginAsync()
        => ShellNavigation.GoToAsync(LoginRoute);

    public static Task RouteAfterCompanySelectedAsync(Employee employee)
    {
        if (employee.UsesCompanyDashboard)
            return GoToHrDashboardAsync();
        return GoToEmployeeDashboardAsync();
    }
}
