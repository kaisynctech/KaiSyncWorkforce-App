using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(IncidentId), "incidentId")]
public partial class HrIncidentDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _incidentId = "";
    [ObservableProperty] private IncidentReport? _incident;
    [ObservableProperty] private string _reportedBy = "";
    [ObservableProperty] private string _assigneeName = "Unassigned";
    [ObservableProperty] private string _jobTitle = "";
    [ObservableProperty] private ObservableCollection<IncidentComment> _comments = [];
    [ObservableProperty] private ObservableCollection<IncidentStatusHistory> _statusHistory = [];
    [ObservableProperty] private string _newComment = "";

    public bool CanManage => _state.IsHrOrAbove
        || (Incident?.AssigneeId == _state.CurrentEmployee?.Id);

    private List<Employee> _employees = [];

    public HrIncidentDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Incident Details";
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(IncidentId, out var id)) return;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            Incident = await _storage.GetIncidentAsync(id, employee.CompanyId, employee.Id);
            if (Incident == null) return;

            _employees = await _storage.GetEmployeesAsync(employee.CompanyId, employee.Id);
            ReportedBy = Incident.EmployeeId.HasValue
                ? _employees.FirstOrDefault(e => e.Id == Incident.EmployeeId)?.FullName ?? "Unknown"
                : (Incident.ReportedByName ?? "Contractor");
            AssigneeName = Incident.AssigneeId.HasValue
                ? _employees.FirstOrDefault(e => e.Id == Incident.AssigneeId)?.FullName ?? "Unknown"
                : "Unassigned";

            if (Incident.JobId.HasValue)
            {
                var job = await _storage.GetJobAsync(Incident.JobId.Value, employee.CompanyId, employee.Id);
                JobTitle = job?.Title ?? "Linked job";
            }
            else
            {
                JobTitle = "";
            }

            Comments = new ObservableCollection<IncidentComment>(
                await _storage.GetIncidentCommentsAsync(employee.CompanyId, employee.Id, id));
            StatusHistory = new ObservableCollection<IncidentStatusHistory>(
                await _storage.GetIncidentStatusHistoryAsync(employee.CompanyId, employee.Id, id));

            OnPropertyChanged(nameof(CanManage));
        });
    }

    [RelayCommand]
    private async Task AssignAsync()
    {
        if (Incident == null || !CanManage || !_employees.Any()) return;
        var names = _employees.Select(e => e.FullName).Prepend("Unassigned").ToArray();
        var chosen = await Shell.Current.DisplayActionSheet("Assign to:", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        await RunAsync(async () =>
        {
            if (chosen == "Unassigned")
            {
                Incident.AssigneeId = null;
                AssigneeName = "Unassigned";
            }
            else
            {
                var target = _employees.FirstOrDefault(e => e.FullName == chosen);
                if (target == null) return;
                Incident.AssigneeId = target.Id;
                AssigneeName = target.FullName;
            }
            Incident = await _storage.UpdateIncidentAsync(Incident, _state.CurrentEmployee?.Id);
        });
    }

    [RelayCommand]
    private async Task SetStatusAsync(string status)
    {
        if (Incident == null || !CanManage) return;
        string? note = null;
        if (status is "closed" or "resolved")
        {
            note = await Shell.Current.DisplayPromptAsync("Close Incident", "Resolution notes (optional):", "Save", "Cancel", "");
            if (note == null) return;
        }

        await RunAsync(async () =>
        {
            Incident.StatusRaw = status;
            Incident.IsClosed = status is "closed" or "resolved";
            if (note != null)
                Incident.ResolutionNotes = note;
            Incident = await _storage.UpdateIncidentAsync(Incident, _state.CurrentEmployee?.Id);
            StatusHistory = new ObservableCollection<IncidentStatusHistory>(
                await _storage.GetIncidentStatusHistoryAsync(
                    Incident.CompanyId, _state.CurrentEmployee!.Id, Incident.Id));
            OnPropertyChanged(nameof(CanManage));
        });
    }

    [RelayCommand]
    private async Task CloseAsync() => await SetStatusAsync("closed");

    [RelayCommand]
    private async Task AddCommentAsync()
    {
        if (Incident == null || string.IsNullOrWhiteSpace(NewComment)) return;
        var body = NewComment.Trim();
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var comment = await _storage.AddIncidentCommentAsync(
                employee.CompanyId, employee.Id, Incident.Id, body);
            Comments.Add(comment);
            NewComment = "";
        });
    }
}
