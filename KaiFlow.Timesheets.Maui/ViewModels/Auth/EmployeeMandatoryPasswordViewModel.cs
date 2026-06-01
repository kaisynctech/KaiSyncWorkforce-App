using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class EmployeeMandatoryPasswordViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _password = "";
    [ObservableProperty] private string _confirmPassword = "";
    [ObservableProperty] private bool _isPasswordVisible;

    public EmployeeMandatoryPasswordViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Set Your Password";
    }

    [RelayCommand]
    private void TogglePasswordVisibility() => IsPasswordVisible = !IsPasswordVisible;

    [RelayCommand]
    private async Task SetPasswordAsync()
    {
        ErrorMessage = null;

        if (Password.Length < 8)
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
            await _storage.SetPasswordAsync(Password);

            var current = _state.CurrentEmployee;
            if (current != null && current.Id != Guid.Empty)
            {
                var full = await _storage.GetEmployeeAsync(current.Id) ?? current;
                full.LoginPasswordReady = true;
                await _storage.UpdateEmployeeAsync(full);
                _state.SetEmployee(full);
            }

            await EmployeeAccountRouting.GoToCompanyPickerAsync();
        });
    }
}
