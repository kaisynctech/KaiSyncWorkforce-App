using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record PunchActivity(string EmployeeName, string TypeLabel, DateTime DateTime, string? Address);

public partial class HrActivityLogViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<PunchActivity> _recentPunches = [];
    [ObservableProperty] private ObservableCollection<IncidentReport> _recentIncidents = [];
    [ObservableProperty] private ObservableCollection<LeaveRequest> _recentLeave = [];

    public HrActivityLogViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Activity Log";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var today = DateOnly.FromDateTime(DateTime.Today);

            var employees = await _storage.GetEmployeesAsync(companyId);
            var empById = employees.ToDictionary(e => e.Id, e => e.FullName);

            var punches = await _storage.GetPunchesAsync(companyId, today.AddDays(-7), today);
            RecentPunches = new ObservableCollection<PunchActivity>(
                punches
                    .OrderByDescending(p => p.DateTime)
                    .Take(20)
                    .Select(p => new PunchActivity(
                        empById.TryGetValue(p.EmployeeId, out var name) ? name : p.EmployeeId.ToString()[..8],
                        p.IsClockIn ? "Clock In" : "Clock Out",
                        p.DateTime,
                        p.Address)));

            var incidents = await _storage.GetIncidentsAsync(companyId);
            RecentIncidents = new ObservableCollection<IncidentReport>(
                incidents.OrderByDescending(i => i.CreatedAt).Take(10));

            var leave = await _storage.GetLeaveRequestsAsync(companyId);
            RecentLeave = new ObservableCollection<LeaveRequest>(
                leave.OrderByDescending(l => l.CreatedAt).Take(10));
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
