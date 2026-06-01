using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class HrRegisterViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _password = "";
    [ObservableProperty] private string _confirmPassword = "";
    [ObservableProperty] private bool _showPassword;

    public HrRegisterViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Create Account";
    }

    [RelayCommand]
    private void ToggleShowPassword() => ShowPassword = !ShowPassword;

    [RelayCommand]
    private async Task RegisterAsync()
    {
        if (string.IsNullOrWhiteSpace(Email) || !Email.Contains('@'))
        {
            ErrorMessage = "A valid email address is required.";
            return;
        }

        if (string.IsNullOrWhiteSpace(Password) || Password.Length < 6)
        {
            ErrorMessage = "Password must be at least 6 characters.";
            return;
        }

        if (Password != ConfirmPassword)
        {
            ErrorMessage = "Passwords do not match.";
            return;
        }

        await RunAsync(async () =>
        {
            var otpSent = await _storage.SendHrRegistrationOtpAsync(Email.Trim().ToLowerInvariant(), Password);

            if (otpSent)
            {
                // New user — go to OTP verification
                await ShellNavigation.GoToAsync(
                    nameof(Views.Auth.HrRegisterVerifyCodePage),
                    new Dictionary<string, object>
                    {
                        ["email"] = Email.Trim().ToLowerInvariant(),
                        ["password"] = Password
                    });
            }
            else
            {
                // Existing confirmed account, signed in successfully — check if company setup is needed
                var hasCompany = await _storage.HasCompanyAsync();
                if (hasCompany)
                {
                    ErrorMessage = "This email already has a registered company. Please use 'HR Sign In'.";
                    await _storage.SignOutAsync();
                }
                else
                {
                    // Resume incomplete registration — skip straight to company setup
                    await ShellNavigation.GoToAsync(nameof(Views.Auth.HrEmailVerifiedPage));
                }
            }
        });
    }
}
