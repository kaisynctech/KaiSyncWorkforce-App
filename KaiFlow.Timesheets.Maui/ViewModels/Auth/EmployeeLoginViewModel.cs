using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Employee;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class EmployeeLoginViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private bool _useCodeMethod = true;
    [ObservableProperty] private string _companyCode = "";
    [ObservableProperty] private string _employeeCode = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _password = "";

    public string SubtitleText => UseCodeMethod
        ? "Use company code + login code from your employer."
        : "Sign in with the email and password you set after joining.";

    public string SignInButtonText => UseCodeMethod
        ? "Sign in with code"
        : "Sign in with email";

    partial void OnUseCodeMethodChanged(bool value)
    {
        OnPropertyChanged(nameof(SubtitleText));
        OnPropertyChanged(nameof(SignInButtonText));
        ErrorMessage = null;
    }

    public EmployeeLoginViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Employee Sign In";
    }

    public async Task InitializeAsync()
    {
        if (!CodeSessionStore.HasCodeSession()) return;

        await RunAsync(async () =>
        {
            var session = await _storage.RefreshCodeSessionAsync();
            if (session == null) return;

            ApplyCodeLogin(session);
            await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(session.Employee);
        });
    }

    [RelayCommand]
    private void SetMethodCode() => UseCodeMethod = true;

    [RelayCommand]
    private void SetMethodEmail() => UseCodeMethod = false;

    [RelayCommand]
    private async Task SignInAsync()
    {
        ErrorMessage = null;

        if (UseCodeMethod)
            await SignInWithCodeLoginAsync();
        else
            await SignInWithEmailAsync();
    }

    private async Task SignInWithCodeLoginAsync()
    {
        if (string.IsNullOrWhiteSpace(CompanyCode) || string.IsNullOrWhiteSpace(EmployeeCode))
        {
            ErrorMessage = "Enter both company code and login code.";
            return;
        }

        await RunAsync(async () =>
        {
            var session = await _storage.SignInWithCodeAsync(
                CompanyCode.Trim().ToUpperInvariant(),
                EmployeeCode.Trim());

            if (session == null)
            {
                ErrorMessage = "Invalid company code or login code.";
                return;
            }

            ApplyCodeLogin(session);

            var hasAuthSession = await _storage.IsAuthenticatedAsync();
            if (!session.Employee.LoginPasswordReady && hasAuthSession)
            {
                await ShellNavigation.GoToAsync($"{nameof(Views.Auth.EmployeeMandatoryPasswordPage)}");
                return;
            }

            await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(session.Employee);
        });
    }

    private async Task SignInWithEmailAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Please enter your email address.";
            return;
        }
        if (string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Please enter your password.";
            return;
        }

        await RunAsync(async () =>
        {
            var employee = await _storage.SignInAsync(Email.Trim().ToLowerInvariant(), Password);
            if (employee == null)
            {
                ErrorMessage = "No account found for this email. Contact your administrator.";
                return;
            }

            _state.SetEmployee(employee);
            await RouteAfterSignInAsync(employee);
        });
    }

    private void ApplyCodeLogin(CodeLoginResult session)
    {
        _state.SetEmployee(session.Employee);
        _state.SetCompany(session.Company);
    }

    private async Task RouteAfterSignInAsync(Models.Employee employee)
    {
        if (!employee.LoginPasswordReady)
        {
            await ShellNavigation.GoToAsync($"{nameof(Views.Auth.EmployeeMandatoryPasswordPage)}");
            return;
        }

        await EmployeeAccountRouting.GoToCompanyPickerAsync();
    }

    [RelayCommand]
    private async Task GoToSelfRegisterAsync()
        => await ShellNavigation.GoToAsync(nameof(Views.Auth.EmployeeSelfRegisterPage));

    [RelayCommand]
    private async Task GoToOtpAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Enter your email address first.";
            return;
        }

        await ShellNavigation.GoToAsync($"{nameof(EmployeeEmailOtpPage)}?email={Uri.EscapeDataString(Email.Trim())}");
    }

    [RelayCommand]
    private async Task ForgotPasswordAsync()
    {
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Enter your email address first.";
            return;
        }

        await RunAsync(async () =>
        {
            await _storage.SendPasswordResetEmailAsync(Email.Trim());
            await Application.Current!.Windows[0].Page!.DisplayAlert(
                "Reset Link Sent",
                "If this email has an account, a password reset link was sent. Check your inbox.",
                "OK");
        });
    }
}
