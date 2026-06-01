using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(Email),     "email")]
[QueryProperty(nameof(FirstName), "firstName")]
[QueryProperty(nameof(LastName),  "lastName")]
public partial class EmployeeLinkCompanyViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _firstName = "";
    [ObservableProperty] private string _lastName = "";
    [ObservableProperty] private string _companyCode = "";

    public EmployeeLinkCompanyViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Link to Company";
    }

    [RelayCommand]
    private async Task LinkAsync()
    {
        ErrorMessage = null;

        if (string.IsNullOrWhiteSpace(CompanyCode))
        {
            ErrorMessage = "Enter the company code given to you by your employer.";
            return;
        }

        await RunAsync(async () =>
        {
            var result = await _storage.EmployeeSelfRegisterAsync(
                Email, FirstName, LastName, CompanyCode.Trim().ToUpperInvariant());

            if (result.IsPending)
            {
                await Shell.Current.DisplayAlert(
                    "Request Sent",
                    $"Your request to join {result.CompanyName ?? "the company"} has been sent to HR. " +
                    "You can upload documents for this company while you wait. Check notifications for approval updates.",
                    "OK");
            }
            else
            {
                await Shell.Current.DisplayAlert(
                    "Company Linked",
                    $"You're connected to {result.CompanyName ?? "your company"}. Select it from My Companies to continue.",
                    "OK");
            }

            await EmployeeAccountRouting.GoToCompanyPickerAsync();
        });
    }

    [RelayCommand]
    private async Task SkipAsync()
        => await EmployeeAccountRouting.GoToCompanyPickerAsync();
}
