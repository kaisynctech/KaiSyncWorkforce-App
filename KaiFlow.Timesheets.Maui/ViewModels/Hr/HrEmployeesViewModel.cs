using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrEmployeesViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;
    private readonly IPermissionsService _permissions;
    private readonly EmployeeScopeService _scope;

    // Employees
    [ObservableProperty] private ObservableCollection<Employee> _employees = [];
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private string _typeFilter = "all";
    private List<Employee> _allEmployees = [];

    // Teams
    [ObservableProperty] private ObservableCollection<WorkTeam> _teams = [];
    [ObservableProperty] private string _teamSearchText = "";
    private List<WorkTeam> _allTeams = [];

    // Leave tab
    [ObservableProperty] private ObservableCollection<LeaveRequestDisplay> _leaveRequests = [];
    [ObservableProperty] private ObservableCollection<LeaveRequestDisplay> _onLeaveToday = [];
    [ObservableProperty] private string _leaveSearchText = "";
    [ObservableProperty] private string _leaveStatusFilter = "pending";
    [ObservableProperty] private int _pendingCount;
    private List<LeaveRequestDisplay> _allLeaveDisplays = [];

    // Pending registrations
    [ObservableProperty] private ObservableCollection<Employee> _pendingEmployees = [];
    [ObservableProperty] private int _pendingRegistrationCount;

    // Tabs + branch
    [ObservableProperty] private string _activeTab = "employees";
    [ObservableProperty] private string _branchFilter = "all";
    [ObservableProperty] private ObservableCollection<string> _branchFilters = ["all"];

    public bool IsEmployeesTab  => ActiveTab == "employees";
    public bool IsTeamsTab      => ActiveTab == "teams";
    public bool IsLeaveTab      => ActiveTab == "leave";
    public bool CanSeeLeaveAdmin => _permissions.Can(PermissionKeys.LeaveViewAll);
    public bool IsPendingTab    => ActiveTab == "pending";
    public bool IsNotLeaveTab   => ActiveTab != "leave";
    public bool HasOnLeaveToday => OnLeaveToday.Count > 0;
    public bool HasPending      => PendingRegistrationCount > 0;

    public HrEmployeesViewModel(
        IStorageService storage, TimesheetStateService state, RealtimeService realtime,
        IPermissionsService permissions, EmployeeScopeService scope)
    {
        _storage = storage;
        _state = state;
        _realtime = realtime;
        _permissions = permissions;
        _scope = scope;
        Title = "Employees";
    }

    public void SubscribeRealtime()  => _realtime.LeaveChanged += OnLeaveChanged;
    public void UnsubscribeRealtime() => _realtime.LeaveChanged -= OnLeaveChanged;
    public void Dispose()             => UnsubscribeRealtime();

    private void OnLeaveChanged(object? sender, EventArgs e)
    {
        MainThread.BeginInvokeOnMainThread(async () =>
        {
            var companyId = _state.CurrentEmployee?.CompanyId;
            if (companyId == null) return;
            await RebuildLeaveDisplaysAsync(companyId.Value, _allEmployees);
            ApplyLeaveFilter();
        });
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var viewer = _state.CurrentEmployee!;
            await _permissions.RefreshAsync(companyId, viewer);
            OnPropertyChanged(nameof(CanSeeLeaveAdmin));
            if (ActiveTab == "leave" && !CanSeeLeaveAdmin)
                ActiveTab = "employees";

            var teams = await _storage.GetWorkTeamsAsync(companyId);
            var allEmployees = await _storage.GetEmployeesAsync(companyId);
            _allEmployees = _scope.FilterEmployees(viewer, allEmployees, teams, _permissions).ToList();
            _allTeams = _scope.FilterTeams(viewer, teams, _permissions).ToList();

            var pending = await _storage.GetPendingEmployeesAsync(companyId);
            PendingEmployees = new ObservableCollection<Employee>(pending);
            PendingRegistrationCount = pending.Count;
            OnPropertyChanged(nameof(HasPending));

            var branches = await _storage.GetBranchesAsync(companyId);
            var branchNames = branches.Select(b => b.Name).OrderBy(n => n).ToList();
            BranchFilters = new ObservableCollection<string>(["all", .. branchNames]);

            if (CanSeeLeaveAdmin)
                await RebuildLeaveDisplaysAsync(companyId, _allEmployees);
            else
            {
                _allLeaveDisplays = [];
                LeaveRequests = [];
                OnLeaveToday = [];
            }

            ApplyFilter();
            ApplyTeamFilter();
            ApplyLeaveFilter();
        });
    }

    partial void OnSearchTextChanged(string value) => ApplyFilter();
    partial void OnTypeFilterChanged(string value) => ApplyFilter();
    partial void OnBranchFilterChanged(string value) { ApplyFilter(); ApplyTeamFilter(); }
    partial void OnTeamSearchTextChanged(string value) => ApplyTeamFilter();

    partial void OnActiveTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsEmployeesTab));
        OnPropertyChanged(nameof(IsTeamsTab));
        OnPropertyChanged(nameof(IsLeaveTab));
        OnPropertyChanged(nameof(IsPendingTab));
        OnPropertyChanged(nameof(IsNotLeaveTab));
    }

    partial void OnLeaveSearchTextChanged(string value) => ApplyLeaveFilter();
    partial void OnLeaveStatusFilterChanged(string value) => ApplyLeaveFilter();

    private void ApplyFilter()
    {
        IEnumerable<Employee> filtered = _allEmployees;

        if (!string.IsNullOrWhiteSpace(SearchText))
            filtered = filtered.Where(e =>
                e.FullName.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (e.EmployeeCode?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));

        if (BranchFilter != "all")
            filtered = filtered.Where(e =>
                e.Branch?.Equals(BranchFilter, StringComparison.OrdinalIgnoreCase) == true);

        filtered = TypeFilter switch
        {
            "permanent" => filtered.Where(e => e.EmploymentTypeRaw == "permanent"),
            "contract"  => filtered.Where(e => e.EmploymentTypeRaw == "contract"),
            "part-time" => filtered.Where(e => e.EmploymentTypeRaw is "part-time" or "partTime"),
            "student"   => filtered.Where(e => e.EmploymentTypeRaw == "student"),
            _ => filtered
        };

        Employees = new ObservableCollection<Employee>(filtered);
    }

    private async Task RebuildLeaveDisplaysAsync(Guid companyId, List<Employee> employees)
    {
        var leaveRequests = await _storage.GetLeaveRequestsAsync(companyId);
        var empMap = employees.ToDictionary(e => e.Id);
        var today = DateOnly.FromDateTime(DateTime.Today);

        _allLeaveDisplays = leaveRequests
            .OrderByDescending(r => r.StatusRaw == "pending" ? 1 : 0)
            .ThenByDescending(r => r.CreatedAt)
            .Select(lr =>
            {
                var emp = empMap.TryGetValue(lr.EmployeeId, out var e) ? e : null;
                var policies = LeavePolicy.Types.Where(t => t.Key.Equals(lr.LeaveType, StringComparison.OrdinalIgnoreCase)).ToList();
                var annualDays = policies.Count > 0 ? policies[0].AnnualDays : 15.0;
                var typeColor  = policies.Count > 0 ? policies[0].Color : "#94A3B8";
                var taken = leaveRequests
                    .Where(r => r.EmployeeId == lr.EmployeeId && r.IsApproved && r.StartDate.Year == today.Year)
                    .Sum(r => r.TotalDays);
                return new LeaveRequestDisplay(lr, emp?.FullName ?? "Unknown", typeColor, annualDays, taken);
            })
            .ToList();

        PendingCount = _allLeaveDisplays.Count(d => d.Request.IsPending);

        OnLeaveToday = new ObservableCollection<LeaveRequestDisplay>(
            _allLeaveDisplays.Where(d => d.Request.IsApproved && d.Request.StartDate <= today && d.Request.EndDate >= today));
        OnPropertyChanged(nameof(HasOnLeaveToday));
    }

    private void ApplyLeaveFilter()
    {
        IEnumerable<LeaveRequestDisplay> filtered = _allLeaveDisplays;

        if (!string.IsNullOrWhiteSpace(LeaveSearchText))
            filtered = filtered.Where(d =>
                d.EmployeeName.Contains(LeaveSearchText, StringComparison.OrdinalIgnoreCase) ||
                d.Request.LeaveType.Contains(LeaveSearchText, StringComparison.OrdinalIgnoreCase));

        if (LeaveStatusFilter != "all")
            filtered = filtered.Where(d => d.Request.StatusRaw == LeaveStatusFilter);

        LeaveRequests = new ObservableCollection<LeaveRequestDisplay>(filtered);
    }

    private void ApplyTeamFilter()
    {
        IEnumerable<WorkTeam> filtered = _allTeams;

        if (BranchFilter != "all")
        {
            var branchIds = _allEmployees
                .Where(e => e.Branch?.Equals(BranchFilter, StringComparison.OrdinalIgnoreCase) == true)
                .Select(e => e.Id)
                .ToHashSet();
            filtered = filtered.Where(t => t.MemberIds.Any(id => branchIds.Contains(id)));
        }

        if (!string.IsNullOrWhiteSpace(TeamSearchText))
            filtered = filtered.Where(t =>
                t.Name.Contains(TeamSearchText, StringComparison.OrdinalIgnoreCase) ||
                (t.Description?.Contains(TeamSearchText, StringComparison.OrdinalIgnoreCase) ?? false));

        Teams = new ObservableCollection<WorkTeam>(filtered);
    }

    [RelayCommand]
    private async Task ApprovePendingAsync(Employee employee)
    {
        await RunAsync(async () =>
        {
            var approved = await _storage.ApproveEmployeeAsync(employee.Id);
            PendingEmployees.Remove(employee);
            PendingRegistrationCount = PendingEmployees.Count;
            OnPropertyChanged(nameof(HasPending));
            _allEmployees.Add(approved);
            ApplyFilter();
        });
    }

    [RelayCommand]
    private async Task RejectPendingAsync(Employee employee)
    {
        var confirm = await Shell.Current.DisplayAlert(
            "Reject Registration",
            $"Reject {employee.FullName}'s request to join?",
            "Reject", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.RejectEmployeeAsync(employee.Id);
            PendingEmployees.Remove(employee);
            PendingRegistrationCount = PendingEmployees.Count;
            OnPropertyChanged(nameof(HasPending));
        });
    }

    [RelayCommand]
    private async Task ApproveAllPendingAsync()
    {
        if (PendingEmployees.Count == 0) return;

        var confirm = await Shell.Current.DisplayAlert(
            "Approve All",
            $"Approve all {PendingEmployees.Count} pending registration requests?",
            "Approve All", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            foreach (var emp in PendingEmployees.ToList())
            {
                var approved = await _storage.ApproveEmployeeAsync(emp.Id);
                _allEmployees.Add(approved);
            }
            PendingEmployees.Clear();
            PendingRegistrationCount = 0;
            OnPropertyChanged(nameof(HasPending));
            ApplyFilter();
        });
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private void SetLeaveFilter(string status) => LeaveStatusFilter = status;

    [RelayCommand]
    private async Task ApproveLeaveAsync(LeaveRequestDisplay item)
    {
        await RunAsync(async () =>
        {
            await _storage.DecideLeaveRequestAsync(_state.CurrentEmployee!.CompanyId, item.Request.Id, "approved");
            await RebuildLeaveDisplaysAsync(_state.CurrentEmployee!.CompanyId, _allEmployees);
            ApplyLeaveFilter();
        });
    }

    [RelayCommand]
    private async Task RejectLeaveAsync(LeaveRequestDisplay item)
    {
        var note = await Shell.Current.DisplayPromptAsync(
            "Reject Leave", $"Reason for rejecting {item.EmployeeName}'s request? (optional):",
            "Reject", "Cancel", placeholder: "Enter reason…");
        if (note == null) return;

        await RunAsync(async () =>
        {
            await _storage.DecideLeaveRequestAsync(_state.CurrentEmployee!.CompanyId, item.Request.Id, "declined", string.IsNullOrWhiteSpace(note) ? null : note);
            await RebuildLeaveDisplaysAsync(_state.CurrentEmployee!.CompanyId, _allEmployees);
            ApplyLeaveFilter();
        });
    }

    [RelayCommand]
    private void SetBranchFilter(string branch) => BranchFilter = branch;

    [RelayCommand]
    private void SetTypeFilter(string filter) => TypeFilter = filter;

    [RelayCommand]
    private async Task CreateAsync()
        => await ShellNavigation.GoToAsync(nameof(HrCreateEmployeePage));

    [RelayCommand]
    private async Task GoToImportAsync()
        => await ShellNavigation.GoToAsync(nameof(HrImportEmployeesPage));

    [RelayCommand]
    private async Task EditAsync(Employee? employee)
    {
        if (employee == null) return;
        try
        {
            await ShellNavigation.GoToAsync(nameof(HrEditEmployeePage),
                new Dictionary<string, object> { ["EmployeeId"] = employee.Id.ToString() });
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Employees", $"Could not open employee: {ex.Message}", "OK");
        }
    }

    [RelayCommand]
    private async Task ViewDashboardAsync(Employee? employee)
    {
        if (employee == null) return;
        try
        {
            await ShellNavigation.GoToAsync(nameof(HrEmployeeDashboardPage),
                new Dictionary<string, object> { ["EmployeeId"] = employee.Id.ToString() });
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Employees", $"Could not open profile: {ex.Message}", "OK");
        }
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task DeleteAsync(Employee employee)
    {
        var confirm = await Shell.Current.DisplayAlert(
            "Delete Employee", $"Remove {employee.FullName}?", "Delete", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.DeleteEmployeeAsync(employee.CompanyId, employee.Id);
            Employees.Remove(employee);
            _allEmployees.Remove(employee);
        });
    }

    [RelayCommand]
    private async Task SendInviteAsync(Employee employee)
    {
        if (string.IsNullOrWhiteSpace(employee.Email))
        {
            await Shell.Current.DisplayAlert("No Email", $"{employee.FullName} has no email address on file.", "OK");
            return;
        }
        await RunAsync(async () =>
        {
            await _storage.SendOtpAsync(employee.Email!);
            await Shell.Current.DisplayAlert("Invite Sent", $"Login link sent to {employee.Email}.", "OK");
        });
    }

    [RelayCommand]
    private async Task CreateTeamAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync("New Team", "Team name:", "Create", "Cancel", "e.g. Morning Shift Team");
        if (string.IsNullOrWhiteSpace(name)) return;

        var desc = await Shell.Current.DisplayPromptAsync("New Team", "Description (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            var team = new WorkTeam
            {
                Name = name.Trim(),
                Description = string.IsNullOrWhiteSpace(desc) ? null : desc.Trim(),
                CompanyId = _state.CurrentEmployee!.CompanyId,
                IsActive = true
            };
            await _storage.CreateWorkTeamAsync(team);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ViewTeamAsync(WorkTeam team)
        => await ShellNavigation.GoToAsync(nameof(HrWorkTeamDetailsPage),
            new Dictionary<string, object> { ["TeamId"] = team.Id.ToString() });
}
