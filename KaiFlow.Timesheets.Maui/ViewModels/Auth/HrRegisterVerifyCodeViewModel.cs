using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Email), "email")]
[QueryProperty(nameof(Password), "password")]
public partial class HrRegisterVerifyCodeViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _password = "";
    [ObservableProperty] private string _code = "";

    public HrRegisterVerifyCodeViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Verify Email";
    }

    [RelayCommand]
    private async Task UseDifferentEmailAsync()
        => await ShellNavigation.GoToAsync("..");

    [RelayCommand]
    private async Task ResendAsync()
    {
        await RunAsync(async () =>
        {
            await _storage.SendHrRegistrationOtpAsync(Email, Password);
            ErrorMessage = "Code resent. Check your email.";
        });
    }

    [RelayCommand]
    private async Task ContinueAsync()
    {
        if (string.IsNullOrWhiteSpace(Code))
        {
            ErrorMessage = "Enter the verification code from your email.";
            return;
        }

        await RunAsync(async () =>
        {
            await _storage.VerifyHrRegistrationOtpAsync(Email, Code.Trim());
            // Password was already set during SignUp — no need to set it again.
            await ShellNavigation.GoToAsync(nameof(Views.Auth.HrEmailVerifiedPage));
        });
    }
}
