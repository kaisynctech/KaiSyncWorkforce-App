using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class EmployeeSelfRegisterViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _firstName = "";
    [ObservableProperty] private string _lastName = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _password = "";
    [ObservableProperty] private string _confirmPassword = "";

    public EmployeeSelfRegisterViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Create Account";
    }

    [RelayCommand]
    private async Task RegisterAsync()
    {
        ErrorMessage = null;

        if (string.IsNullOrWhiteSpace(FirstName) || string.IsNullOrWhiteSpace(LastName))
        {
            ErrorMessage = "Please enter your first and last name.";
            return;
        }
        if (string.IsNullOrWhiteSpace(Email))
        {
            ErrorMessage = "Please enter your email address.";
            return;
        }
        if (string.IsNullOrWhiteSpace(Password) || Password.Length < 8)
        {
            ErrorMessage = "Password must be at least 8 characters.";
            return;
        }
        if (Password != ConfirmPassword)
        {
            ErrorMessage = "Passwords do not match.";
            return;
        }

        await RunAsync(async () =>
        {
            var otpSent = await _storage.SendHrRegistrationOtpAsync(
                Email.Trim().ToLowerInvariant(), Password);

            if (otpSent)
            {
                // New user — verify OTP then link company
                var dest = $"{nameof(EmployeeRegisterVerifyPage)}" +
                           $"?email={Uri.EscapeDataString(Email.Trim().ToLowerInvariant())}" +
                           $"&firstName={Uri.EscapeDataString(FirstName.Trim())}" +
                           $"&lastName={Uri.EscapeDataString(LastName.Trim())}" +
                           $"&password={Uri.EscapeDataString(Password)}";
                await ShellNavigation.GoToAsync(dest);
            }
            else
            {
                // Already confirmed — go straight to company linking
                await ShellNavigation.GoToAsync(
                    $"{nameof(EmployeeLinkCompanyPage)}" +
                    $"?email={Uri.EscapeDataString(Email.Trim().ToLowerInvariant())}" +
                    $"&firstName={Uri.EscapeDataString(FirstName.Trim())}" +
                    $"&lastName={Uri.EscapeDataString(LastName.Trim())}");
            }
        });
    }

    [RelayCommand]
    private async Task GoBackAsync() => await ShellNavigation.GoToAsync("..");
}
