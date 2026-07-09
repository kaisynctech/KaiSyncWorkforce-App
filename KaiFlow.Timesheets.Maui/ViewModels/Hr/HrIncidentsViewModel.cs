using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record IncidentDisplay(IncidentReport Report, string ReporterName);

public partial class HrIncidentsViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly RealtimeService _realtime;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<IncidentDisplay> _incidents = [];
    [ObservableProperty] private bool _showOpenOnly = true;
    [ObservableProperty] private string _scope = "all";
    [ObservableProperty] private string _searchText = "";

    public HrIncidentsViewModel(IStorageService storage, RealtimeService realtime, TimesheetStateService state)
    {
        _storage = storage;
        _realtime = realtime;
        _state = state;
        Title = "Incidents";
        _realtime.IncidentChanged += OnIncidentChanged;
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var all = await _storage.GetIncidentsAsync(companyId, includeClosed: !ShowOpenOnly);
            var employees = await _storage.GetEmployeesAsync(companyId);
            var map = employees.ToDictionary(e => e.Id, e => e.FullName);

            var filtered = ShowOpenOnly ? all.Where(i => i.IsOpen) : all;

            filtered = Scope switch
            {
                "standalone" => filtered.Where(i => !i.JobId.HasValue),
                "job" => filtered.Where(i => i.JobId.HasValue),
                _ => filtered
            };

            if (!string.IsNullOrWhiteSpace(SearchText))
            {
                filtered = filtered.Where(i =>
                    i.Description.Contains(SearchText, StringComparison.OrdinalIgnoreCase)
                    || (i.Title?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));
            }

            Incidents = new ObservableCollection<IncidentDisplay>(
                filtered.OrderByDescending(i => i.CreatedAt)
                    .Select(i => new IncidentDisplay(i,
                        i.EmployeeId.HasValue
                            ? map.GetValueOrDefault(i.EmployeeId.Value, "Unknown")
                            : (i.ReportedByName ?? "Contractor"))));
        });
    }

    private async void OnIncidentChanged(object? sender, EventArgs e) => await LoadAsync();

    [RelayCommand]
    private async Task NewIncidentAsync()
        => await ShellNavigation.GoToAsync(nameof(Views.Employee.IncidentReportPage));

    [RelayCommand]
    private async Task CloseIncidentAsync(IncidentDisplay display)
    {
        var note = await Shell.Current.DisplayPromptAsync("Close Incident", "Resolution notes:");
        if (note == null) return;

        await RunAsync(async () =>
        {
            display.Report.StatusRaw = "closed";
            display.Report.IsClosed = true;
            display.Report.ResolutionNotes = note;
            await _storage.UpdateIncidentAsync(display.Report, _state.CurrentEmployee?.Id);
            Incidents.Remove(display);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task SetScopeAsync(string scope)
    {
        Scope = scope;
        await LoadAsync();
    }

    partial void OnShowOpenOnlyChanged(bool value) => _ = LoadAsync();
    partial void OnSearchTextChanged(string value) => _ = LoadAsync();

    [RelayCommand]
    private async Task ViewIncidentAsync(IncidentDisplay display)
    {
        if (display == null) return;
        await ShellNavigation.GoToAsync(nameof(Views.Hr.HrIncidentDetailsPage),
            new Dictionary<string, object> { ["incidentId"] = display.Report.Id.ToString() });
    }

    // Used by the dashboard workspace panel instead of code-behind event handlers.
    [RelayCommand] private void SetShowOpenOnly() => ShowOpenOnly = true;
    [RelayCommand] private void SetShowAll()      => ShowOpenOnly = false;

    public void Dispose() => _realtime.IncidentChanged -= OnIncidentChanged;
}
