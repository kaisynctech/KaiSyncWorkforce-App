using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(FilterEmployeeId), "EmployeeId")]
[QueryProperty(nameof(FilterEmployeeName), "EmployeeName")]
public partial class HrActiveSessionsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<ActiveSession> _sessions = [];
    [ObservableProperty] private string _filterEmployeeId = "";
    [ObservableProperty] private string _filterEmployeeName = "";

    public bool IsFilteredByEmployee => !string.IsNullOrWhiteSpace(FilterEmployeeId);

    public HrActiveSessionsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Active Sessions";
    }

    partial void OnFilterEmployeeIdChanged(string value)
        => Title = string.IsNullOrWhiteSpace(FilterEmployeeName)
            ? "Active Sessions"
            : $"Sessions: {FilterEmployeeName}";

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            Guid? employeeId = Guid.TryParse(FilterEmployeeId, out var eid) ? eid : null;

            var list = await _storage.HrListActiveSessionsAsync(companyId, employeeId);
            Sessions = new ObservableCollection<ActiveSession>(list);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task RevokeSessionAsync(Guid sessionId)
    {
        var confirmed = await Shell.Current.DisplayAlert(
            "Revoke session",
            "This will immediately sign out that device. Continue?",
            "Revoke", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.HrRevokeSessionAsync(companyId, sessionId);
            var toRemove = Sessions.FirstOrDefault(s => s.SessionId == sessionId);
            if (toRemove != null) Sessions.Remove(toRemove);
        });
    }

    [RelayCommand]
    private async Task RevokeAllEmployeeSessionsAsync(Guid employeeId)
    {
        var session = Sessions.FirstOrDefault(s => s.EmployeeId == employeeId);
        var name = session?.EmployeeName ?? "this employee";
        var confirmed = await Shell.Current.DisplayAlert(
            "Revoke all sessions",
            $"This will sign out all active sessions for {name}. Continue?",
            "Revoke all", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.HrRevokeAllEmployeeSessionsAsync(companyId, employeeId);
            var toRemove = Sessions.Where(s => s.EmployeeId == employeeId).ToList();
            foreach (var s in toRemove) Sessions.Remove(s);
        });
    }
}
