using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrAttendanceViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;

    private List<PunchSession> _allSessions = [];
    private Dictionary<Guid, Employee> _employeeMap = new();
    private Dictionary<Guid, EmployeeShiftTemplate> _templateMap = new();

    [ObservableProperty] private ObservableCollection<PunchSession> _sessions = [];
    [ObservableProperty] private DateTime _fromDate = DateTime.Today.AddDays(-7);
    [ObservableProperty] private DateTime _toDate = DateTime.Today;
    [ObservableProperty] private string _attendancePeriod = "week";
    [ObservableProperty] private string _employeeNameFilter = "";
    [ObservableProperty] private double _totalHours;
    [ObservableProperty] private double _totalPay;

    public HrAttendanceViewModel(IStorageService storage, IExportService export,
        TimesheetStateService state, RealtimeService realtime)
    {
        _storage = storage;
        _export = export;
        _state = state;
        _realtime = realtime;
        Title = "Attendance";
        _realtime.PunchChanged += OnPunchChanged;
    }

    private void OnPunchChanged(object? sender, EventArgs e)
        => MainThread.BeginInvokeOnMainThread(() => _ = LoadAsync());

    public void Dispose() => _realtime.PunchChanged -= OnPunchChanged;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            if (!_employeeMap.Any())
            {
                var emps = await _storage.GetEmployeesAsync(companyId);
                _employeeMap = emps.ToDictionary(e => e.Id, e => e);

                var templates = await _storage.GetShiftTemplatesAsync(companyId);
                _templateMap = templates.ToDictionary(t => t.Id, t => t);
            }

            var from = DateOnly.FromDateTime(FromDate);
            var to = DateOnly.FromDateTime(ToDate);
            var punches = await _storage.GetPunchesAsync(companyId, from, to);

            var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
            int lateMin = settings.TryGetValue("late_threshold_minutes", out var l) && int.TryParse(l?.ToString(), out var li) ? li : 30;
            int otMin   = settings.TryGetValue("ot_start_after_minutes",  out var o) && int.TryParse(o?.ToString(), out var oi) ? oi : 30;

            _allSessions = PunchSession.Build(punches, _employeeMap, _templateMap, lateMin, otMin);
            ApplyNameFilter();
        });
    }

    private void ApplyNameFilter()
    {
        var q = EmployeeNameFilter?.Trim() ?? "";
        var filtered = string.IsNullOrEmpty(q)
            ? _allSessions
            : _allSessions.Where(s => s.EmployeeName?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false).ToList();
        Sessions = new ObservableCollection<PunchSession>(filtered);
        TotalHours = Sessions.Sum(s => s.TotalHours);
        TotalPay = Sessions.Sum(s => s.TotalPay);
    }

    partial void OnEmployeeNameFilterChanged(string value) => ApplyNameFilter();

[RelayCommand]
    private async Task SetPeriodAsync(string period)
    {
        AttendancePeriod = period;
        (FromDate, ToDate) = period switch
        {
            "today" => (DateTime.Today, DateTime.Today),
            "month" => (DateTime.Today.AddDays(-30), DateTime.Today),
            "all"   => (DateTime.Today.AddYears(-5), DateTime.Today),
            _       => (DateTime.Today.AddDays(-7), DateTime.Today),
        };
        await LoadAsync();
    }

    [RelayCommand]
    private async Task ApplyFilterAsync() => await LoadAsync();

    [RelayCommand]
    private async Task ViewLocationAsync(PunchSession session)
    {
        if (!session.HasLocation || session.MapsUrl == null) return;
        await Launcher.OpenAsync(new Uri(session.MapsUrl));
    }

    [RelayCommand]
    private async Task ExportAsync()
    {
        var choice = await Shell.Current.DisplayActionSheet(
            "Export Attendance", "Cancel", null, "Export as CSV", "Export as PDF");

        if (choice == "Export as CSV")
        {
            await _export.ExportToCsvAsync("attendance.csv",
                ["Employee", "Clock In", "Clock Out", "Hours", "Pay"],
                Sessions.Select(s => new[]
                {
                    s.EmployeeName,
                    s.ClockIn.ToString("yyyy-MM-dd HH:mm"),
                    s.ClockOut?.ToString("yyyy-MM-dd HH:mm") ?? "Open",
                    s.TotalHours.ToString("F2"),
                    s.TotalPay.ToString("F2")
                }));
        }
        else if (choice == "Export as PDF")
        {
            await _export.ExportToPdfAsync("attendance.pdf", "Attendance Report",
                ["Employee", "Clock In", "Clock Out", "Hours", "Pay"],
                Sessions.Select(s => new[]
                {
                    s.EmployeeName,
                    s.ClockIn.ToString("yyyy-MM-dd HH:mm"),
                    s.ClockOut?.ToString("yyyy-MM-dd HH:mm") ?? "Open",
                    s.TotalHours.ToString("F2"),
                    s.TotalPay.ToString("F2")
                }));
        }
    }
}
