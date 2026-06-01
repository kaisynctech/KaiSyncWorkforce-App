using KaiFlow.Timesheets.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Auth;

[QueryProperty(nameof(CompanyName), "CompanyName")]
[QueryProperty(nameof(CompanyCode), "CompanyCode")]
public partial class HrRegistrationSuccessViewModel : BaseViewModel
{
    [ObservableProperty] private string _companyName = "";
    [ObservableProperty] private string _companyCode = "";

    public HrRegistrationSuccessViewModel()
    {
        Title = "Welcome!";
    }

    [RelayCommand]
    private async Task CopyCodeAsync()
        => await Clipboard.Default.SetTextAsync(CompanyCode);

    [RelayCommand]
    private async Task ContinueAsync()
    {
        await ShellNavigation.GoToAsync("//HrSignIn");
        // After sign-in, owners see the setup wizard prompt on the HR dashboard overview.
    }
}
