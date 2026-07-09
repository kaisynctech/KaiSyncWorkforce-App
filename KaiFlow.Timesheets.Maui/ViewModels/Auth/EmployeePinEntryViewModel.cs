using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;

namespace KaiFlow.Timesheets.ViewModels.Auth;

/// <summary>
/// Stub — PIN authentication is not in use. This page is registered in the shell
/// for backwards compatibility but is never navigated to in the current flow.
/// </summary>
public partial class EmployeePinEntryViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Dot1Filled))]
    [NotifyPropertyChangedFor(nameof(Dot2Filled))]
    [NotifyPropertyChangedFor(nameof(Dot3Filled))]
    [NotifyPropertyChangedFor(nameof(Dot4Filled))]
    private string _currentPin = string.Empty;

    [ObservableProperty]
    private string _employeeName = string.Empty;

    public string WelcomeText => "Enter your login code";

    public bool Dot1Filled => CurrentPin.Length > 0;
    public bool Dot2Filled => CurrentPin.Length > 1;
    public bool Dot3Filled => CurrentPin.Length > 2;
    public bool Dot4Filled => CurrentPin.Length > 3;

    public EmployeePinEntryViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Sign In";
    }

    public async Task LoadStoredCredentialsAsync()
    {
        // PIN is not in use — redirect to the login page.
        await ShellNavigation.GoToAsync($"//{nameof(EmployeeLoginPage)}");
    }

    [RelayCommand]
    private async Task AppendDigitAsync(string digit)
    {
        if (CurrentPin.Length >= 4 || IsBusy) return;
        CurrentPin += digit;
    }

    [RelayCommand]
    private void Backspace()
    {
        if (CurrentPin.Length == 0 || IsBusy) return;
        CurrentPin   = CurrentPin[..^1];
        ErrorMessage = null;
    }

    [RelayCommand]
    private async Task UseIdNumberInsteadAsync()
    {
        CurrentPin   = string.Empty;
        ErrorMessage = null;
        CodeSessionStore.Clear();
        await ShellNavigation.GoToAsync($"//{nameof(EmployeeLoginPage)}");
    }
}
