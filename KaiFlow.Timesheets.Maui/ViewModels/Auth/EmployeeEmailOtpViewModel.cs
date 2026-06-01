using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Employee;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Email), "email")]
public partial class EmployeeEmailOtpViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _otp = "";

    public EmployeeEmailOtpViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Enter Code";
    }

    [RelayCommand]
    private async Task ResendAsync()
    {
        if (string.IsNullOrWhiteSpace(Email)) return;
        await RunAsync(async () =>
        {
            await _storage.SendOtpAsync(Email);
            ErrorMessage = null;
        });
    }

    [RelayCommand]
    private async Task ChangeEmailAsync() => await ShellNavigation.GoToAsync("..");

    [RelayCommand]
    private async Task VerifyAsync()
    {
        if (string.IsNullOrWhiteSpace(Otp)) return;

        await RunAsync(async () =>
        {
            var employee = await _storage.SignInWithOtpAsync(Email, Otp.Trim());
            if (employee == null)
            {
                ErrorMessage = "Invalid or expired code.";
                return;
            }

            _state.SetEmployee(employee);

            if (!employee.LoginPasswordReady)
            {
                await ShellNavigation.GoToAsync($"{nameof(EmployeeMandatoryPasswordPage)}");
                return;
            }

            // Reuse IdEntryViewModel routing logic via a shared helper approach
            if (employee.CompanyId != Guid.Empty)
            {
                var company = await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (company != null)
                {
                    _state.SetCompany(company);
                    await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(employee);
                    return;
                }
            }

            // No single company resolved — let the selector decide
            var companies = await _storage.GetUserCompaniesAsync();
            if (companies.Count == 1)
            {
                _state.SetCompany(companies[0]);
                await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(employee);
            }
            else
            {
                await EmployeeAccountRouting.GoToCompanyPickerAsync();
            }
        });
    }
}
