using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record JobDisplay(Job Job, string ClientName, string AssigneeName, string LinkedProjectName)
{
    public string JobCodeDisplay => Job.JobCodeDisplay;

    public string StatusLabel => Job.StatusRaw switch
    {
        "inProgress" or "in_progress" => "In progress",
        "scheduled" => "Scheduled",
        "completed" => "Completed",
        "cancelled" => "Cancelled",
        _ => Job.StatusRaw
    };

    public string StatusChipKind => Job.StatusRaw switch
    {
        "completed" => "success",
        "inProgress" or "in_progress" => "info",
        "scheduled" => "warning",
        "cancelled" => "neutral",
        _ => "neutral"
    };
}

public partial class HrJobsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;
    private readonly IPermissionsService _permissions;
    private readonly EmployeeScopeService _scope;

    [ObservableProperty] private ObservableCollection<JobDisplay> _jobs = [];
    [ObservableProperty] private ObservableCollection<ProjectRowItem> _projects = [];
    [ObservableProperty] private string _viewMode = "jobs";
    [ObservableProperty] private string _scopeFilter = "all";
    [ObservableProperty] private string _statusFilter = "open";
    [ObservableProperty] private string _projectStatusFilter = "all";
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private string _listSummary = "";
    [ObservableProperty] private DateTime _dateFrom = DateTime.Today.AddDays(-30);
    [ObservableProperty] private DateTime _dateTo = DateTime.Today.AddDays(30);
    [ObservableProperty] private bool _useDateFilter;
    [ObservableProperty] private int _pageIndex;
    [ObservableProperty] private int _pageSize = 25;
    [ObservableProperty] private string _pageSummary = "";
    [ObservableProperty] private bool _canGoPrevious;
    [ObservableProperty] private bool _canGoNext;
    private List<Job> _allJobs = [];
    private List<ClientDeal> _allProjects = [];
    private Dictionary<Guid, string> _clientNames = [];
    private Dictionary<Guid, string> _employeeNames = [];
    private Dictionary<Guid, Job> _jobById = new();
    private Dictionary<Guid, ClientDeal> _dealById = new();
    private bool _scopeInitialized;

    public bool IsJobsView => ViewMode == "jobs";
    public bool IsProjectsView => ViewMode == "projects";
    public bool IsAllScope => ScopeFilter == "all";
    public bool IsMyScope => ScopeFilter == "mine";

    public string ScopeAllLabel => IsJobsView ? "All jobs" : "All projects";
    public string ScopeMineLabel => IsJobsView ? "My jobs" : "My projects";

    public List<string> StatusOptions { get; } = ["open", "all", "scheduled", "inProgress", "completed", "cancelled"];
    public List<string> ProjectStatusOptions { get; } = ["all", "draft", "sent", "negotiation", "in_progress", "won", "lost"];

    public bool CanViewAllScope =>
        _permissions.Can(PermissionKeys.ProjectsViewAll) || _permissions.Can(PermissionKeys.JobsViewAll);

    public HrJobsViewModel(
        IStorageService storage, IExportService export, TimesheetStateService state,
        IPermissionsService permissions, EmployeeScopeService scope)
    {
        _storage = storage;
        _export = export;
        _state = state;
        _permissions = permissions;
        _scope = scope;
        Title = "Jobs";
    }

    public void PrepareAsJobsList()
    {
        ViewMode = "jobs";
        UpdateTitle();
        OnPropertyChanged(nameof(IsJobsView));
        OnPropertyChanged(nameof(IsProjectsView));
    }

    public void PrepareAsProjectsList()
    {
        ViewMode = "projects";
        UpdateTitle();
        OnPropertyChanged(nameof(IsJobsView));
        OnPropertyChanged(nameof(IsProjectsView));
    }

    partial void OnViewModeChanged(string value)
    {
        OnPropertyChanged(nameof(IsJobsView));
        OnPropertyChanged(nameof(IsProjectsView));
        OnPropertyChanged(nameof(ScopeAllLabel));
        OnPropertyChanged(nameof(ScopeMineLabel));
        UpdateTitle();
        ApplyFilter();
        ApplyProjectFilter();
    }

    partial void OnScopeFilterChanged(string value)
    {
        OnPropertyChanged(nameof(IsAllScope));
        OnPropertyChanged(nameof(IsMyScope));
        ApplyFilter();
        ApplyProjectFilter();
    }

    private void UpdateTitle()
    {
        var kind = ViewMode == "projects" ? "Projects" : "Jobs";
        var scope = ScopeFilter == "mine" ? "My" : "All";
        Title = $"{scope} {kind}";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var companyId = employee.CompanyId;
            await _permissions.RefreshAsync(companyId, employee);

            if (!_scopeInitialized)
            {
                ScopeFilter = CanViewAllScope ? "all" : "mine";
                _scopeInitialized = true;
            }

            _allJobs = await _storage.GetJobsAsync(companyId);
            _jobById = _allJobs.ToDictionary(j => j.Id);
            _allProjects = await _storage.GetClientDealsAsync(companyId);
            _dealById = _allProjects.ToDictionary(d => d.Id);
            EnrichProjectJobCounts();
            await RefreshAllProjectMetricsAsync();

            var clients = await _storage.GetClientsAsync(companyId);
            _clientNames = clients.ToDictionary(c => c.Id, c => c.Name);

            var employees = await _storage.GetEmployeesAsync(companyId);
            _employeeNames = employees.ToDictionary(e => e.Id, e => e.FullName);

            UpdateTitle();
            ApplyFilter();
            ApplyProjectFilter();
        });
    }

    private async Task OnProjectStatusChangedAsync(ProjectRowItem row, string stageValue)
    {
        if (row.Deal.StatusRaw == stageValue) return;
        await RunAsync(async () =>
        {
            var from = row.Deal.StatusRaw;
            row.Deal.StatusRaw = stageValue;
            var updated = await _storage.UpdateClientDealAsync(row.Deal);
            await _storage.AddClientDealUpdateAsync(new ClientDealUpdate
            {
                CompanyId = updated.CompanyId,
                DealId = updated.Id,
                Body = $"Stage changed to {ProjectPipeline.LabelFor(stageValue)}.",
                StatusFrom = from,
                StatusTo = stageValue
            });
            await RefreshProjectMetricsAsync(updated);
            var idx = _allProjects.FindIndex(p => p.Id == updated.Id);
            if (idx >= 0) _allProjects[idx] = updated;
            row.ReplaceDeal(updated);
            ApplyProjectFilter();
        });
    }

    private async Task RefreshProjectMetricsAsync(ClientDeal deal)
    {
        var payments = await _storage.GetProjectClientPaymentsAsync(deal.Id);
        deal.AmountPaid = payments.Sum(p => p.Amount);
        deal.ProgressPercent = ProjectProgressHelper.ComputePercent(deal, _allJobs);
        deal = await _storage.UpdateClientDealAsync(deal);
    }

    private async Task RefreshAllProjectMetricsAsync()
    {
        foreach (var p in _allProjects)
            await RefreshProjectMetricsAsync(p);
    }

    [RelayCommand]
    private async Task AddClientPaymentAsync(ProjectRowItem? row)
    {
        if (row?.Deal == null) return;
        var amountStr = await Shell.Current.DisplayPromptAsync(
            "Client payment", $"Amount for '{row.Deal.Title}' (R):", "Add", "Cancel", keyboard: Keyboard.Numeric);
        if (string.IsNullOrWhiteSpace(amountStr) || !double.TryParse(amountStr, out var amount) || amount <= 0)
            return;

        await RunAsync(async () =>
        {
            await _storage.AddProjectClientPaymentAsync(new ProjectClientPayment
            {
                CompanyId = row.Deal.CompanyId,
                DealId = row.Deal.Id,
                Amount = amount,
                PaidAt = DateTime.UtcNow
            });
            var synced = await _storage.SyncClientDealFinancialsAsync(row.Deal.Id);
            var idx = _allProjects.FindIndex(p => p.Id == synced.Id);
            if (idx >= 0) _allProjects[idx] = synced;
            row.ReplaceDeal(synced);
            ApplyProjectFilter();
        });
    }

    partial void OnStatusFilterChanged(string value) { PageIndex = 0; ApplyFilter(); }
    partial void OnSearchTextChanged(string value)
    {
        PageIndex = 0;
        ApplyFilter();
        ApplyProjectFilter();
    }
    partial void OnDateFromChanged(DateTime value) { PageIndex = 0; ApplyFilter(); }
    partial void OnDateToChanged(DateTime value) { PageIndex = 0; ApplyFilter(); }
    partial void OnUseDateFilterChanged(bool value) { PageIndex = 0; ApplyFilter(); }
    partial void OnPageIndexChanged(int value) => ApplyFilter();
    partial void OnProjectStatusFilterChanged(string value) => ApplyProjectFilter();

    private Guid CurrentEmployeeId => _state.CurrentEmployee!.Id;

    private bool IsJobMine(Job job) => job.IsAssignedTo(CurrentEmployeeId);

    private bool IsProjectMine(ClientDeal deal)
    {
        if (deal.ManagerEmployeeId == CurrentEmployeeId)
            return true;

        return _allJobs.Any(j => j.DealId == deal.Id && IsJobMine(j));
    }

    private void EnrichProjectJobCounts()
    {
        var counts = _allJobs
            .Where(j => j.DealId.HasValue)
            .GroupBy(j => j.DealId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());
        foreach (var d in _allProjects)
            d.JobCount = counts.GetValueOrDefault(d.Id, 0);
    }

    private void ApplyFilter()
    {
        var filtered = FilterJobs(_allJobs).ToList();
        var displays = filtered.Select(j => new JobDisplay(
            j,
            j.ClientId.HasValue ? _clientNames.GetValueOrDefault(j.ClientId.Value, "—") : "—",
            j.AssigneeEmployeeId.HasValue ? _employeeNames.GetValueOrDefault(j.AssigneeEmployeeId.Value, "—") : "—",
            GetLinkedProjectName(j))).ToList();

        var result = TableQuery.Apply(new TableQueryOptions<JobDisplay>
        {
            Source = displays,
            SortKey = "created",
            SortAscending = false,
            SortSelectors = new Dictionary<string, Func<JobDisplay, IComparable>>(StringComparer.OrdinalIgnoreCase)
            {
                ["created"] = d => d.Job.CreatedAt,
                ["title"] = d => d.Job.Title,
                ["status"] = d => d.Job.StatusRaw,
                ["client"] = d => d.ClientName,
            },
            PageIndex = PageIndex,
            PageSize = PageSize,
        });

        Jobs = new ObservableCollection<JobDisplay>(result.Page);
        PageIndex = result.PageIndex;
        PageSummary = result.PageSummary;
        CanGoPrevious = result.CanGoPrevious;
        CanGoNext = result.CanGoNext;

        if (IsJobsView)
            ListSummary = $"{result.TotalCount} {(ScopeFilter == "mine" ? "my" : "company")} job(s)";
    }

    private IEnumerable<Job> FilterJobs(IEnumerable<Job> source)
    {
        var filtered = source.AsEnumerable();

        if (ScopeFilter == "mine")
            filtered = filtered.Where(IsJobMine);

        if (StatusFilter == "open")
            filtered = filtered.Where(j => j.IsOpen);
        else if (StatusFilter == "inProgress")
            filtered = filtered.Where(j => j.StatusRaw == "inProgress" || j.StatusRaw == "in_progress");
        else if (StatusFilter != "all")
            filtered = filtered.Where(j => j.StatusRaw == StatusFilter);

        if (!string.IsNullOrWhiteSpace(SearchText))
            filtered = filtered.Where(j =>
                j.Title.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (j.JobCode?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (j.ClientId.HasValue && _clientNames.GetValueOrDefault(j.ClientId.Value, "")
                    .Contains(SearchText, StringComparison.OrdinalIgnoreCase)) ||
                GetLinkedProjectName(j).Contains(SearchText, StringComparison.OrdinalIgnoreCase));

        if (UseDateFilter)
            filtered = filtered.Where(j =>
                !j.ScheduledStart.HasValue ||
                (j.ScheduledStart.Value >= DateFrom && j.ScheduledStart.Value <= DateTo));

        return filtered;
    }

    [RelayCommand]
    private void PreviousPage()
    {
        if (CanGoPrevious) PageIndex--;
    }

    [RelayCommand]
    private void NextPage()
    {
        if (CanGoNext) PageIndex++;
    }

    private void ApplyProjectFilter()
    {
        var filtered = _allProjects.AsEnumerable();

        if (ScopeFilter == "mine")
            filtered = filtered.Where(IsProjectMine);

        if (ProjectStatusFilter != "all")
            filtered = filtered.Where(p => p.StatusRaw == ProjectStatusFilter);

        if (!string.IsNullOrWhiteSpace(SearchText))
            filtered = filtered.Where(p =>
                p.Title.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (p.ProjectCode?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (p.HasClient && _clientNames.GetValueOrDefault(p.ClientId!.Value, "")
                    .Contains(SearchText, StringComparison.OrdinalIgnoreCase)) ||
                (!p.HasClient && "internal".Contains(SearchText, StringComparison.OrdinalIgnoreCase)));

        var list = filtered.OrderByDescending(p => p.CreatedAt).ToList();
        Projects = new ObservableCollection<ProjectRowItem>(
            list.Select(p => new ProjectRowItem(
                p,
                OnProjectStatusChangedAsync,
                p.HasClient && p.ClientId.HasValue
                    ? _clientNames.GetValueOrDefault(p.ClientId.Value, "—")
                    : "Internal",
                p.ManagerEmployeeId.HasValue
                    ? _employeeNames.GetValueOrDefault(p.ManagerEmployeeId.Value, "—")
                    : "—")));

        if (IsProjectsView)
            ListSummary = $"{Projects.Count} {(ScopeFilter == "mine" ? "my" : "company")} project(s)";
    }

    [RelayCommand]
    private void SetViewMode(string mode) => ViewMode = mode;

    [RelayCommand]
    private void SetScope(string scope) => ScopeFilter = scope;

    [RelayCommand]
    private void SetFilter(string filter) => StatusFilter = filter;

    [RelayCommand]
    private void SetProjectFilter(string filter) => ProjectStatusFilter = filter;

    [RelayCommand]
    private async Task CreateJobAsync()
    {
        var client = await PickClientOptionalAsync();
        var args = new Dictionary<string, object>();
        if (client != null)
            args["ClientId"] = client.Id.ToString();
        await ShellNavigation.GoToAsync(nameof(HrCreateJobPage), args);
    }

    [RelayCommand]
    private async Task CreateProjectAsync()
    {
        await ShellNavigation.GoToAsync(nameof(HrProjectDetailPage),
            new Dictionary<string, object> { ["DealId"] = "new" });
    }

    private async Task<Client?> PickClientOptionalAsync()
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        var clients = (await _storage.GetClientsAsync(companyId)).OrderBy(c => c.Name).ToList();
        if (clients.Count == 0)
            return null;

        var options = new[] { "No client (internal job)" }.Concat(clients.Select(c => c.Name)).ToArray();
        var pick = await Shell.Current.DisplayActionSheetAsync(
            "Client for this job (optional)", "Cancel", null, options);
        if (pick == null || pick == "Cancel") return null;
        if (pick == "No client (internal job)") return null;
        return clients.FirstOrDefault(c => c.Name == pick);
    }

    private string GetLinkedProjectName(Job job)
    {
        if (!job.DealId.HasValue || !_dealById.TryGetValue(job.DealId.Value, out var deal))
            return "—";
        var code = deal.ProjectCodeDisplay;
        return string.IsNullOrWhiteSpace(code) ? deal.Title : $"{code} · {deal.Title}";
    }

    [RelayCommand]
    private async Task ViewJobAsync(JobDisplay? display)
    {
        if (display?.Job == null) return;
        try
        {
            await ShellNavigation.GoToAsync($"{nameof(HrJobDetailsPage)}?JobId={display.Job.Id}");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Jobs", $"Could not open job: {ex.Message}", "OK");
        }
    }

    [RelayCommand]
    private async Task ViewLinkedProjectAsync(JobDisplay? display)
    {
        if (display?.Job?.DealId is not { } dealId || !_dealById.ContainsKey(dealId)) return;
        await ShellNavigation.GoToAsync(nameof(HrProjectDetailPage),
            new Dictionary<string, object> { ["DealId"] = dealId.ToString() });
    }

    [RelayCommand]
    private async Task ViewProjectAsync(ProjectRowItem row)
        => await ShellNavigation.GoToAsync(nameof(HrProjectDetailPage),
            new Dictionary<string, object> { ["DealId"] = row.Deal.Id.ToString() });

    [RelayCommand]
    private async Task ExportAsync()
    {
        if (IsProjectsView)
        {
            await _export.ExportToCsvAsync("projects_report.csv",
                ["Code", "Title", "Client", "Manager", "Status", "Offer", "Paid", "Progress", "Expected Close", "Job Link"],
                Projects.Select(d => new[]
                {
                    d.ProjectCodeDisplay,
                    d.Deal.Title,
                    d.ClientName ?? "",
                    d.ManagerName ?? "",
                    d.Deal.StatusRaw,
                    d.Deal.OfferAmount.ToString("F2"),
                    d.Deal.PaidDisplay,
                    d.ProgressDisplay,
                    d.Deal.ExpectedCloseDisplay,
                    d.JobCountLabel
                }));
            return;
        }

        await _export.ExportToCsvAsync("jobs_report.csv",
            ["Code", "Title", "Status", "Priority", "Client", "Linked project", "Assignee", "Scheduled Start", "Est. Cost"],
            Jobs.Select(d => new[]
            {
                d.JobCodeDisplay,
                d.Job.Title,
                d.Job.StatusRaw,
                d.Job.PriorityRaw,
                d.ClientName,
                d.LinkedProjectName,
                d.AssigneeName,
                d.Job.ScheduledStart?.ToString("yyyy-MM-dd HH:mm") ?? "",
                d.Job.EstimatedCost.ToString("F2")
            }));
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
