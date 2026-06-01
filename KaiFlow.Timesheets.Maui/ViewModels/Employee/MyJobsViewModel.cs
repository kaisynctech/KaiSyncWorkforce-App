using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyJobsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly AppTelemetry _telemetry;

    [ObservableProperty] private ObservableCollection<Job> _jobs = [];
    /// <summary>assigned | created | all</summary>
    [ObservableProperty] private string _scope = "assigned";
    /// <summary>all | open | scheduled | inProgress | completed | cancelled</summary>
    [ObservableProperty] private string _statusFilter = "all";

    public MyJobsViewModel(IStorageService storage, TimesheetStateService state, AppTelemetry telemetry)
    {
        _storage = storage;
        _state = state;
        _telemetry = telemetry;
        Title = "Jobs";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var all = await _storage.GetJobsAsync(employee.CompanyId, employee.Id);

            var createdCount = all.Count(j => j.IsCreatedBy(employee.Id));
            var assignedByOthersCount = all.Count(j => j.IsAssignedByOthers(employee.Id));
            _telemetry.LogEvent("my_jobs_query", new Dictionary<string, string>
            {
                ["scope"] = Scope,
                ["total"] = all.Count.ToString(),
                ["created_by_me"] = createdCount.ToString(),
                ["assigned_by_others"] = assignedByOthersCount.ToString(),
                ["missing_creator_ids"] = all.Count(j => !j.CreatedByEmployeeId.HasValue).ToString(),
            });

            if (Scope == "created" && createdCount == 0 && all.Any(j => j.IsAssignedByOthers(employee.Id) && !j.CreatedByEmployeeId.HasValue))
            {
                _telemetry.LogWarning(
                    "my_jobs_creator_mismatch",
                    nameof(LoadAsync),
                    new Dictionary<string, string>
                    {
                        ["employee_id"] = employee.Id.ToString(),
                        ["hint"] = "assigned_jobs_missing_created_by_employee_id",
                    });
            }

            var scoped = ApplyScope(all, employee.Id);
            var filtered = ApplyStatusFilter(scoped);
            Jobs = new ObservableCollection<Job>(filtered.OrderByDescending(j => j.CreatedAt));
        });
    }

    /// <summary>
    /// Assigned = given to you by HR/managers (not jobs you created).
    /// My Jobs = jobs you created.
    /// All = both combined.
    /// </summary>
    private IEnumerable<Job> ApplyScope(IEnumerable<Job> all, Guid employeeId) => Scope switch
    {
        "assigned" => all.Where(j => j.IsAssignedByOthers(employeeId)),
        "created" => all.Where(j => j.IsCreatedBy(employeeId)),
        _ => all.Where(j => j.IsInAllJobsScope(employeeId))
    };

    private IEnumerable<Job> ApplyStatusFilter(IEnumerable<Job> jobs) => StatusFilter switch
    {
        "open" => jobs.Where(j => j.IsOpen),
        "scheduled" => jobs.Where(j => j.StatusRaw == "scheduled"),
        "inProgress" => jobs.Where(j => j.StatusRaw is "inProgress" or "in_progress"),
        "completed" => jobs.Where(j => j.StatusRaw == "completed"),
        "cancelled" => jobs.Where(j => j.StatusRaw == "cancelled"),
        _ => jobs
    };

    public string EmptyMessage => Scope switch
    {
        "assigned" => "No jobs assigned to you by HR or your manager yet.",
        "created" => "You have not created any jobs yet. Tap + Job to add one.",
        _ => "No jobs yet — assigned jobs and jobs you create will appear here."
    };

    [RelayCommand]
    private async Task OpenJobCardAsync(Job job)
        => await ShellNavigation.GoToAsync(nameof(JobCardPage),
            new Dictionary<string, object> { ["JobId"] = job.Id.ToString() });

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

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

    [RelayCommand]
    private async Task CreateJobAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeJobRequestPage));
}
