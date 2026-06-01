using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class RoleSelectionViewModel : BaseViewModel
{
    private readonly TimesheetStateService _state;

    public RoleSelectionViewModel(TimesheetStateService state)
    {
        _state = state;
        Title = "Select Role";
    }

    [RelayCommand]
    private async Task SelectEmployeeAsync()
        => await ShellNavigation.GoToAsync("//EmployeeDashboard");

    [RelayCommand]
    private async Task SelectHrAsync()
        => await ShellNavigation.GoToAsync("//HrDashboard");
}
