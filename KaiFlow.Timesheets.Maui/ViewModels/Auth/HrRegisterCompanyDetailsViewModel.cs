using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Email), "email")]
public partial class HrRegisterCompanyDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _companyName = "";
    [ObservableProperty] private string _ownerFirstName = "";
    [ObservableProperty] private string _ownerLastName = "";
    [ObservableProperty] private bool _isOwner = true;
    [ObservableProperty] private bool _isHrAdmin = false;

    partial void OnIsOwnerChanged(bool value) { if (value) IsHrAdmin = false; }
    partial void OnIsHrAdminChanged(bool value) { if (value) IsOwner = false; }

    public HrRegisterCompanyDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Company Details";
    }

    [RelayCommand]
    private async Task ContinueAsync()
    {
        if (string.IsNullOrWhiteSpace(CompanyName))
        {
            ErrorMessage = "Company name is required.";
            return;
        }
        if (string.IsNullOrWhiteSpace(OwnerFirstName))
        {
            ErrorMessage = "Your first name is required.";
            return;
        }

        await RunAsync(async () =>
        {
            var role = IsOwner ? "owner" : "hr_admin";
            var (companyId, companyCode) = await _storage.SelfRegisterCompanyAsync(
                CompanyName.Trim(), OwnerFirstName.Trim(), OwnerLastName.Trim(), role);

            await ShellNavigation.GoToAsync(
                $"{nameof(Views.Auth.HrRegistrationSuccessPage)}" +
                $"?CompanyName={Uri.EscapeDataString(CompanyName.Trim())}" +
                $"&CompanyCode={Uri.EscapeDataString(companyCode)}");
        });
    }
}
