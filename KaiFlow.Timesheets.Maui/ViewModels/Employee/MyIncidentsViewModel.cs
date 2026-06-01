using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyIncidentsViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly IOfflineQueueService _offline;
    private readonly RealtimeService _realtime;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<IncidentReport> _incidents = [];
    /// <summary>all | standalone | job</summary>
    [ObservableProperty] private string _scope = "all";
    [ObservableProperty] private string _statusFilter = "open";
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private int _pendingOfflineCount;

    public MyIncidentsViewModel(
        IStorageService storage,
        IExportService export,
        IOfflineQueueService offline,
        RealtimeService realtime,
        TimesheetStateService state)
    {
        _storage = storage;
        _export = export;
        _offline = offline;
        _realtime = realtime;
        _state = state;
        Title = "Incidents";
        _realtime.IncidentChanged += OnIncidentChanged;
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            PendingOfflineCount = _offline.QueuedIncidentCount;
            var employee = _state.CurrentEmployee!;
            var includeClosed = StatusFilter != "open";
            var all = await _storage.GetIncidentsAsync(employee.CompanyId, employee.Id, includeClosed: includeClosed);

            var scoped = Scope switch
            {
                "standalone" => all.Where(i => !i.JobId.HasValue),
                "job" => all.Where(i => i.JobId.HasValue),
                _ => all
            };

            if (StatusFilter == "open")
                scoped = scoped.Where(i => i.IsOpen);
            else if (StatusFilter == "closed")
                scoped = scoped.Where(i => !i.IsOpen);

            if (!string.IsNullOrWhiteSpace(SearchText))
            {
                scoped = scoped.Where(i =>
                    i.Description.Contains(SearchText, StringComparison.OrdinalIgnoreCase)
                    || (i.Title?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false)
                    || i.SeverityRaw.Contains(SearchText, StringComparison.OrdinalIgnoreCase));
            }

            Incidents = new ObservableCollection<IncidentReport>(
                scoped.OrderByDescending(i => i.CreatedAt));
        });
    }

    public string EmptyMessage => PendingOfflineCount > 0
        ? $"{PendingOfflineCount} incident(s) waiting to sync when online."
        : Scope switch
        {
            "standalone" => "No standalone incidents. Tap New to report one.",
            "job" => "No job-linked incidents yet.",
            _ => "No incidents found."
        };

    private async void OnIncidentChanged(object? sender, EventArgs e) => await LoadAsync();

    [RelayCommand]
    private async Task NewIncidentAsync()
        => await ShellNavigation.GoToAsync(nameof(IncidentReportPage));

    [RelayCommand]
    private async Task ViewIncidentAsync(IncidentReport incident)
        => await ShellNavigation.GoToAsync(nameof(HrIncidentDetailsPage),
            new Dictionary<string, object> { ["incidentId"] = incident.Id.ToString() });

    [RelayCommand]
    private async Task SetScopeAsync(string scope)
    {
        Scope = scope;
        await LoadAsync();
    }

    [RelayCommand]
    private async Task SetStatusFilterAsync(string filter)
    {
        StatusFilter = filter;
        await LoadAsync();
    }

    partial void OnSearchTextChanged(string value) => _ = LoadAsync();

    [RelayCommand]
    private async Task ExportAsync()
    {
        await _export.ExportToCsvAsync("my_incidents.csv",
            ["Date", "Title", "Severity", "Category", "Status", "JobLinked", "Description"],
            Incidents.Select(i => new[]
            {
                i.CreatedAt.ToString("yyyy-MM-dd"),
                i.DisplayTitle,
                i.SeverityRaw,
                i.CategoryRaw,
                i.StatusRaw,
                i.IsJobLinked ? "Yes" : "No",
                i.Description,
            }));
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    public void Dispose() => _realtime.IncidentChanged -= OnIncidentChanged;
}
