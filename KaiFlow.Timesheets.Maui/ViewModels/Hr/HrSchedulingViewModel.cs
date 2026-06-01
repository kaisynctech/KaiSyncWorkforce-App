using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrSchedulingViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<CalendarEvent> _events = [];
    [ObservableProperty] private DateTime _selectedDate = DateTime.Today;
    [ObservableProperty] private string _viewMode = "list";

    public List<string> ViewModes { get; } = ["list", "week"];

    public HrSchedulingViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export = export;
        _state = state;
        Title = "Scheduling";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var from = DateOnly.FromDateTime(SelectedDate.AddDays(-14));
            var to = DateOnly.FromDateTime(SelectedDate.AddDays(60));
            var events = await _storage.GetCalendarEventsAsync(companyId, from, to);
            Events = new ObservableCollection<CalendarEvent>(events.OrderBy(e => e.StartTime));
        });
    }

    partial void OnSelectedDateChanged(DateTime value) => _ = LoadAsync();

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task CreateEventAsync()
    {
        var title = await Shell.Current.DisplayPromptAsync("New Shift", "Title:", "Next", "Cancel", "e.g. Morning Shift");
        if (string.IsNullOrWhiteSpace(title)) return;

        var type = await Shell.Current.DisplayActionSheet("Event Type", "Cancel", null, "shift", "meeting", "reminder");
        if (type == null || type == "Cancel") type = "shift";

        var startTimeStr = await Shell.Current.DisplayPromptAsync("New Shift", "Start time (HH:mm):", "Next", "Skip", "08:00");
        var endTimeStr = await Shell.Current.DisplayPromptAsync("New Shift", "End time (HH:mm):", "Next", "Skip", "16:00");
        var desc = await Shell.Current.DisplayPromptAsync("New Shift", "Description (optional):", "Create", "Skip", "");

        TimeSpan startSpan = TimeSpan.Zero, endSpan = TimeSpan.FromHours(8);
        TimeSpan.TryParse(startTimeStr, out startSpan);
        TimeSpan.TryParse(endTimeStr, out endSpan);

        var companyId = _state.CurrentEmployee!.CompanyId;

        var employees = await _storage.GetEmployeesAsync(companyId);
        var names = employees.Select(e => e.FullName).ToArray();
        var chosenName = await Shell.Current.DisplayActionSheet("Assign to employee (optional)", "Skip", null, names);
        var assignee = employees.FirstOrDefault(e => e.FullName == chosenName);

        if (assignee != null)
        {
            var shiftDate = DateOnly.FromDateTime(SelectedDate.Date);
            var allLeave  = await _storage.GetLeaveRequestsAsync(companyId, assignee.Id);
            var onLeave   = allLeave.Any(r => r.IsApproved && r.StartDate <= shiftDate && r.EndDate >= shiftDate);
            var absences  = await _storage.GetDailyAbsencesAsync(companyId, shiftDate, assignee.Id);

            if (onLeave || absences.Count > 0)
            {
                var reason  = onLeave ? "on approved leave" : $"reported absent ({absences[0].ReasonLabel})";
                var proceed = await Shell.Current.DisplayAlert(
                    "Employee Unavailable",
                    $"{assignee.FullName} is {reason} on {shiftDate:dd MMM}. Assign anyway?",
                    "Assign Anyway", "Cancel");
                if (!proceed) return;
            }
        }

        var attendees = assignee != null ? new List<Guid> { assignee.Id } : new List<Guid>();
        var ev = new CalendarEvent
        {
            CompanyId = companyId,
            Title = title.Trim(),
            Description = string.IsNullOrWhiteSpace(desc) ? null : desc.Trim(),
            StartTime = SelectedDate.Date + startSpan,
            EndTime = SelectedDate.Date + endSpan,
            EventType = type,
            AttendeeIds = attendees,
            CreatedBy = _state.CurrentEmployee!.Id
        };

        await RunAsync(async () =>
        {
            await _storage.CreateCalendarEventAsync(ev);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ExportAsync()
    {
        await _export.ExportToCsvAsync("schedule.csv",
            ["Title", "Type", "Start", "End", "Description"],
            Events.Select(e => new[]
            {
                e.Title, e.EventType,
                e.StartTime.ToString("yyyy-MM-dd HH:mm"),
                e.EndTime?.ToString("yyyy-MM-dd HH:mm") ?? "",
                e.Description ?? ""
            }));
    }
}
