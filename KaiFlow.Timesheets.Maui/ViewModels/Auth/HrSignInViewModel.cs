using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class HrSignInViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _password = "";
    [ObservableProperty] private bool _showPassword;

    public HrSignInViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "HR Sign In";
    }

    public async Task InitializeAsync()
    {
        await RunAsync(async () =>
        {
            await _storage.InitializeSessionAsync();
            var employee = await _storage.GetCurrentEmployeeAsync();
            if (employee == null) return;

            _state.SetEmployee(employee);
            if (employee.CompanyId != Guid.Empty)
            {
                var company = await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (company != null) _state.SetCompany(company);
            }
            await ShellNavigation.GoToAsync("//HrDashboard");
        });
    }

    [RelayCommand]
    private void ToggleShowPassword() => ShowPassword = !ShowPassword;

    [RelayCommand]
    private async Task GoToRegisterAsync()
        => await ShellNavigation.GoToAsync(nameof(HrRegisterPage));

    [RelayCommand]
    private async Task SignInAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrWhiteSpace(Password)) return;

        await RunAsync(async () =>
        {
            var employee = await _storage.SignInAsync(Email.Trim(), Password);

            if (employee == null)
            {
                // Auth may have succeeded but no employee record yet (incomplete registration)
                if (await _storage.IsAuthenticatedAsync())
                {
                    var hasCompany = await _storage.HasCompanyAsync();
                    if (!hasCompany)
                    {
                        // Resume company setup
                        await ShellNavigation.GoToAsync(nameof(HrRegisterCompanyDetailsPage));
                        return;
                    }
                }
                ErrorMessage = "Invalid credentials. Check your email and password.";
                return;
            }

            _state.SetEmployee(employee);

            if (employee.CompanyId != Guid.Empty)
            {
                var company = await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (company != null)
                {
                    _state.SetCompany(company);
                    await _storage.EnsureOwnerAccessLevelAsync(employee, company);
                }
            }

            await ShellNavigation.GoToAsync("//HrDashboard");
        });
    }
}
