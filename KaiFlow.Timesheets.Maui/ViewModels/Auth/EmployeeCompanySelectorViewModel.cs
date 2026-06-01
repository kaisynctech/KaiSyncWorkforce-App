using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Auth;

public partial class EmployeeCompanySelectorViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;

    [ObservableProperty] private ObservableCollection<EmployeeMembership> _memberships = [];
    [ObservableProperty] private string _employeeName = "";
    [ObservableProperty] private int _unreadNotificationCount;

    public bool HasMemberships => Memberships.Count > 0;

    public bool CanReturnToDashboard =>
        _state.IsSignedIn || CodeSessionStore.HasCodeSession();

    partial void OnMembershipsChanged(ObservableCollection<EmployeeMembership> value)
        => OnPropertyChanged(nameof(HasMemberships));

    public EmployeeCompanySelectorViewModel(IStorageService storage, TimesheetStateService state, RealtimeService realtime)
    {
        _storage = storage;
        _state = state;
        _realtime = realtime;
        Title = "My Companies";
        _state.StateChanged += OnStateChanged;
    }

    private void OnStateChanged(object? sender, EventArgs e)
        => OnPropertyChanged(nameof(CanReturnToDashboard));

    public void SubscribeAccountRealtime()
    {
        _realtime.MembershipChanged += OnAccountChanged;
        _realtime.AccountNotificationChanged += OnAccountChanged;
        _ = _realtime.EnsureAccountSubscriptionAsync();
    }

    public void UnsubscribeAccountRealtime()
    {
        _realtime.MembershipChanged -= OnAccountChanged;
        _realtime.AccountNotificationChanged -= OnAccountChanged;
    }

    private async void OnAccountChanged(object? sender, EventArgs e)
    {
        try { await LoadAsync(); }
        catch { /* ignore */ }
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var list = await _storage.GetMyMembershipsAsync();
            Memberships = new ObservableCollection<EmployeeMembership>(list);

            OnPropertyChanged(nameof(CanReturnToDashboard));

            var first = list.FirstOrDefault();
            EmployeeName = first?.FullName
                ?? _state.CurrentEmployee?.FullName
                ?? "";

            var notifications = await _storage.GetMyNotificationsAsync();
            UnreadNotificationCount = notifications.Count(n => !n.IsRead);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task SelectMembershipAsync(EmployeeMembership membership)
    {
        if (membership.IsRejected)
        {
            await Shell.Current.DisplayAlert(
                "Registration Declined",
                $"Your request to join {membership.CompanyName} was declined. Contact their HR team if you need help.",
                "OK");
            return;
        }

        var company = await _storage.GetCurrentCompanyAsync(membership.CompanyId)
            ?? new Company
            {
                Id = membership.CompanyId,
                Name = membership.CompanyName,
                Code = membership.CompanyCode
            };

        var employee = await _storage.GetEmployeeForCompanyAsync(membership.CompanyId)
            ?? membership.ToEmployee();
        _state.SetEmployee(employee);
        _state.SetCompany(company);
        await _storage.EnsureEmployeeCompanyRelationshipAsync(employee);

        if (membership.IsPending)
        {
            await EmployeeAccountRouting.GoToEmployeeDashboardAsync();
            return;
        }

        await EmployeeAccountRouting.RouteAfterCompanySelectedAsync(employee);
    }

    [RelayCommand]
    private async Task BackToDashboardAsync()
        => await EmployeeAccountRouting.GoToEmployeeDashboardAsync();

    [RelayCommand]
    private async Task LinkAnotherCompanyAsync()
    {
        var email = await _storage.GetCurrentUserEmailAsync();
        if (string.IsNullOrWhiteSpace(email))
        {
            await Shell.Current.DisplayAlert(
                "Email sign-in required",
                "Link another company after you sign in with your email and password, or complete self-registration.",
                "OK");
            return;
        }

        var first = Memberships.FirstOrDefault();
        var firstName = first?.Name ?? _state.CurrentEmployee?.Name ?? "";
        var lastName = first?.Surname ?? _state.CurrentEmployee?.Surname ?? "";

        await ShellNavigation.GoToAsync(
            $"{nameof(EmployeeLinkCompanyPage)}" +
            $"?email={Uri.EscapeDataString(email)}" +
            $"&firstName={Uri.EscapeDataString(firstName)}" +
            $"&lastName={Uri.EscapeDataString(lastName)}");
    }

    [RelayCommand]
    private async Task GoToNotificationsAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeNotificationsPage));

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _storage.SignOutAsync();
        _state.SuppressAutoLogin = true;
        _state.Clear();
        await EmployeeAccountRouting.GoToLoginAsync();
    }
}
