using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Email),     "email")]
[QueryProperty(nameof(FirstName), "firstName")]
[QueryProperty(nameof(LastName),  "lastName")]
[QueryProperty(nameof(Password),  "password")]
public partial class EmployeeRegisterVerifyViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _firstName = "";
    [ObservableProperty] private string _lastName = "";
    [ObservableProperty] private string _password = "";
    [ObservableProperty] private string _otp = "";

    public EmployeeRegisterVerifyViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Verify Email";
    }

    [RelayCommand]
    private async Task ResendAsync()
    {
        if (string.IsNullOrWhiteSpace(Email)) return;
        if (string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Go back and re-enter your password to resend the code.";
            return;
        }

        await RunAsync(async () =>
        {
            await _storage.SendHrRegistrationOtpAsync(Email.Trim().ToLowerInvariant(), Password);
            ErrorMessage = "Code resent. Check your email.";
        });
    }

    [RelayCommand]
    private async Task VerifyAsync()
    {
        if (string.IsNullOrWhiteSpace(Otp)) return;

        await RunAsync(async () =>
        {
            await _storage.VerifyHrRegistrationOtpAsync(Email, Otp.Trim());

            await ShellNavigation.GoToAsync(
                $"{nameof(EmployeeLinkCompanyPage)}" +
                $"?email={Uri.EscapeDataString(Email)}" +
                $"&firstName={Uri.EscapeDataString(FirstName)}" +
                $"&lastName={Uri.EscapeDataString(LastName)}");
        });
    }
}
