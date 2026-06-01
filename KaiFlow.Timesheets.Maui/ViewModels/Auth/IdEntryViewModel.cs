using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.ClientPortal;
using KaiFlow.Timesheets.Views.ContractorPortal;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class IdEntryViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    public IdEntryViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "KaiFlow";
    }

    public async Task InitializeAsync()
    {
        await RunAsync(async () =>
        {
            if (ClientPortalSessionStore.IsSigningOut)
                ClientPortalSessionStore.CompleteSignOut();

            // User tapped "Back" from a dashboard — show the login screen, don't auto-navigate
            if (_state.SuppressAutoLogin)
            {
                _state.SuppressAutoLogin = false;
                return;
            }

            // Load persisted Supabase session (HR email/password users)
            await _storage.InitializeSessionAsync();

            var employee = await _storage.GetCurrentEmployeeAsync();
            if (employee != null)
            {
                _state.SetEmployee(employee);
                await NavigateAfterAuthAsync(employee);
                return;
            }

            // Client portal session (no employee / HR auth required)
            if (ClientPortalSessionStore.HasSession && !ClientPortalSessionStore.ConsumeSkipAutoRestore())
            {
                await ShellNavigation.GoToAsync(ClientPortalNavigation.PortalRoute);
                return;
            }

            if (ContractorPortalSessionStore.HasSession)
            {
                await ShellNavigation.GoToAsync(nameof(ContractorPortalPage));
                return;
            }

            // No Supabase auth session — restore code login from Supabase server session
            if (CodeSessionStore.HasCodeSession())
            {
                var session = await _storage.RefreshCodeSessionAsync();
                if (session != null)
                {
                    _state.SetEmployee(session.Employee);
                    _state.SetCompany(session.Company);
                    await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(session.Employee);
                    return;
                }

                CodeSessionStore.Clear();
            }

            // Authenticated but no employee record — resume employee self-registration
            if (await _storage.IsAuthenticatedAsync())
            {
                var email = await _storage.GetCurrentUserEmailAsync();
                if (!string.IsNullOrWhiteSpace(email))
                {
                    await ShellNavigation.GoToAsync(
                        $"{nameof(EmployeeLinkCompanyPage)}" +
                        $"?email={Uri.EscapeDataString(email.Trim().ToLowerInvariant())}" +
                        $"&firstName=&lastName=");
                }
            }
        });
    }

    internal async Task NavigateAfterAuthAsync(Models.Employee employee)
    {
        if (!employee.LoginPasswordReady)
        {
            await ShellNavigation.GoToAsync($"{nameof(EmployeeMandatoryPasswordPage)}");
            return;
        }

        await EmployeeAccountRouting.GoToCompanyPickerAsync();
    }

    [RelayCommand]
    private async Task GoToEmployeeLoginAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeLoginPage));

    [RelayCommand]
    private async Task GoToHrSignInAsync()
        => await ShellNavigation.GoToAsync(nameof(HrSignInPage));

    [RelayCommand]
    private async Task GoToHrRegisterAsync()
        => await ShellNavigation.GoToAsync(nameof(HrRegisterPage));

    [RelayCommand]
    private async Task OpenGuestPortalAsync()
    {
        var code = await Shell.Current.DisplayPromptAsync(
            "Job portal (guest)",
            "Enter the portal code from your link:",
            "Open", "Cancel",
            placeholder: "Paste the code");
        if (string.IsNullOrWhiteSpace(code)) return;

        var url = $"https://portal.kaiflow.co.za/client/{code.Trim()}";
        await Launcher.Default.OpenAsync(new Uri(url));
    }

    [RelayCommand]
    private async Task OpenClientPortalAsync()
    {
        var companyCode = await Shell.Current.DisplayPromptAsync(
            "Client portal",
            "Enter your company code:",
            "Next", "Cancel",
            placeholder: "e.g. 28");
        if (string.IsNullOrWhiteSpace(companyCode)) return;

        var clientCode = await Shell.Current.DisplayPromptAsync(
            "Client portal",
            "Enter your client code:",
            "Sign in", "Cancel",
            placeholder: "e.g. C280001");
        if (string.IsNullOrWhiteSpace(clientCode)) return;

        await RunAsync(async () =>
        {
            var login = await _storage.ResolveClientByCodeAsync(companyCode, clientCode);
            if (login == null)
            {
                await Shell.Current.DisplayAlertAsync("Not found", "Check your company code and client code, then try again.", "OK");
                return;
            }

            ClientPortalSessionStore.Save(
                login.ClientId, login.CompanyId, login.ClientName, login.CompanyCode, login.ClientCode);
            await ShellNavigation.GoToAsync(ClientPortalNavigation.PortalRoute);
        });
    }

    [RelayCommand]
    private async Task OpenContractorPortalAsync()
    {
        var companyCode = await Shell.Current.DisplayPromptAsync(
            "Contractor portal",
            "Enter your company code:",
            "Next", "Cancel",
            placeholder: "e.g. 28");
        if (string.IsNullOrWhiteSpace(companyCode)) return;

        var contractorCode = await Shell.Current.DisplayPromptAsync(
            "Contractor portal",
            "Enter your contractor code:",
            "Sign in", "Cancel",
            placeholder: "e.g. CT280001");
        if (string.IsNullOrWhiteSpace(contractorCode)) return;

        await RunAsync(async () =>
        {
            var login = await _storage.ResolveContractorByCodeAsync(companyCode, contractorCode);
            if (login == null)
            {
                await Shell.Current.DisplayAlertAsync("Not found", "Check your company code and contractor code, then try again.", "OK");
                return;
            }

            ContractorPortalSessionStore.Save(
                login.ContractorId, login.CompanyId, login.ContractorName,
                login.CompanyCode, login.ContractorCode);
            await ShellNavigation.GoToAsync(nameof(ContractorPortalPage));
        });
    }
}
