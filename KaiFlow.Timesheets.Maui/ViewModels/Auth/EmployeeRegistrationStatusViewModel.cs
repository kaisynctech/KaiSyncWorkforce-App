using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Status), "status")]
public partial class EmployeeRegistrationStatusViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    [ObservableProperty] private string _status = "pending";

    public bool IsPending  => Status == "pending";
    public bool IsRejected => Status == "rejected";

    public string Headline => IsRejected
        ? "Registration Declined"
        : "Awaiting HR Approval";

    public string Message => IsRejected
        ? "Your request to join this company was declined. Please contact your HR administrator if you believe this is a mistake."
        : "Your registration request has been sent to HR. Sign in again once your account has been approved — you'll then have full access to the app.";

    public EmployeeRegistrationStatusViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Registration Status";
    }

    partial void OnStatusChanged(string value)
    {
        OnPropertyChanged(nameof(IsPending));
        OnPropertyChanged(nameof(IsRejected));
        OnPropertyChanged(nameof(Headline));
        OnPropertyChanged(nameof(Message));
    }

    [RelayCommand]
    private async Task BackToLoginAsync()
    {
        await _storage.SignOutAsync();
        await ShellNavigation.GoToAsync("//IdEntry");
    }
}
