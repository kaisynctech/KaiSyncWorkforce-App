using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class EmployeePunchRow : ObservableObject
{
    public Employee Employee { get; }

    [ObservableProperty] private bool _isSelected;
    [ObservableProperty] private bool _isClockedIn;
    [ObservableProperty] private bool _isOnLeave;
    [ObservableProperty] private bool _isAbsent;
    [ObservableProperty] private string _lastPunchTime = "";
    [ObservableProperty] private string _unavailabilityNote = "";

    public bool CanSelect => !IsOnLeave && !IsAbsent;
    public bool IsEligibleForClockIn => CanSelect && !IsClockedIn;
    public bool IsEligibleForClockOut => CanSelect && IsClockedIn;

    public string StatusLabel => IsOnLeave ? "On Leave" : IsAbsent ? "Absent" : IsClockedIn ? "In" : "Out";
    public string StatusColor => IsOnLeave ? "#F59E0B" : IsAbsent ? "#EF4444" : IsClockedIn ? "#22C55E" : "#64748B";
    public string StatusBackgroundColor => IsOnLeave ? "#78350F" : IsAbsent ? "#7F1D1D" : IsClockedIn ? "#14532D" : "#1E293B";
    public double RowOpacity => CanSelect ? 1.0 : 0.55;

    public EmployeePunchRow(
        Employee employee,
        TimePunch? lastPunch,
        bool isOnLeave = false,
        bool isAbsent = false,
        string? unavailabilityNote = null)
    {
        Employee = employee;
        IsOnLeave = isOnLeave;
        IsAbsent = isAbsent;
        UnavailabilityNote = unavailabilityNote ?? "";
        IsSelected = CanSelect;
        IsClockedIn = lastPunch?.PunchType == PunchType.In;
        LastPunchTime = lastPunch != null
            ? lastPunch.LocalDateTime.ToString("HH:mm")
            : "";
    }

    partial void OnIsClockedInChanged(bool value)
    {
        OnPropertyChanged(nameof(IsEligibleForClockIn));
        OnPropertyChanged(nameof(IsEligibleForClockOut));
        OnPropertyChanged(nameof(StatusLabel));
        OnPropertyChanged(nameof(StatusColor));
        OnPropertyChanged(nameof(StatusBackgroundColor));
    }

    partial void OnIsOnLeaveChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSelect));
        OnPropertyChanged(nameof(IsEligibleForClockIn));
        OnPropertyChanged(nameof(IsEligibleForClockOut));
        OnPropertyChanged(nameof(StatusLabel));
        OnPropertyChanged(nameof(StatusColor));
        OnPropertyChanged(nameof(StatusBackgroundColor));
        OnPropertyChanged(nameof(RowOpacity));
    }

    partial void OnIsAbsentChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSelect));
        OnPropertyChanged(nameof(IsEligibleForClockIn));
        OnPropertyChanged(nameof(IsEligibleForClockOut));
        OnPropertyChanged(nameof(StatusLabel));
        OnPropertyChanged(nameof(StatusColor));
        OnPropertyChanged(nameof(StatusBackgroundColor));
        OnPropertyChanged(nameof(RowOpacity));
    }
}

[QueryProperty(nameof(TeamId), "TeamId")]
public partial class HrTeamPunchViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly ILocationService _location;
    private readonly TimesheetStateService _state;
    private readonly IBranchGeofenceService _geofence;
    private readonly IPermissionsService _permissions;
    private readonly EmployeeScopeService _scope;

    private List<WorkTeam> _allTeams = [];
    private List<Employee> _allEmployees = [];
    private bool _suppressTeamChanged;
    private string? _pendingTeamId;
    private readonly List<EmployeePunchRow> _subscribedRows = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanClockIn))]
    [NotifyPropertyChangedFor(nameof(CanClockOut))]
    private bool _isTeamPunching;

    [ObservableProperty] private string _teamId = "";
    [ObservableProperty] private ObservableCollection<WorkTeam> _teams = [];
    [ObservableProperty] private ObservableCollection<EmployeePunchRow> _employeeRows = [];
    [ObservableProperty] private WorkTeam? _selectedTeam;
    [ObservableProperty] private string _currentAddress = "Fetching location…";
    [ObservableProperty] private bool _isGettingLocation;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ClockInCount))]
    [NotifyPropertyChangedFor(nameof(ClockOutCount))]
    [NotifyPropertyChangedFor(nameof(CanClockIn))]
    [NotifyPropertyChangedFor(nameof(CanClockOut))]
    [NotifyPropertyChangedFor(nameof(ClockInButtonLabel))]
    [NotifyPropertyChangedFor(nameof(ClockOutButtonLabel))]
    private bool _includeSelfInTeamPunch = true;

    private bool _managerIsClockedIn;
    private bool _managerIsOnLeave;
    private bool _managerIsAbsent;

    public string ManagerSelfName => _state.CurrentEmployee?.FullName ?? "You";
    public bool ManagerSelfEligibleForClockIn =>
        IncludeSelfInTeamPunch && !_managerIsOnLeave && !_managerIsAbsent && !_managerIsClockedIn;
    public bool ManagerSelfEligibleForClockOut =>
        IncludeSelfInTeamPunch && !_managerIsOnLeave && !_managerIsAbsent && _managerIsClockedIn;
    public string ManagerSelfStatusLabel =>
        _managerIsOnLeave ? "On Leave" : _managerIsAbsent ? "Absent" : _managerIsClockedIn ? "In" : "Out";
    public string ManagerSelfSummary =>
        $"{ManagerSelfName} · Currently {ManagerSelfStatusLabel}";

    private double? _lat;
    private double? _lng;

    public bool HasTeams    => Teams.Count > 0;
    public bool HasEmployees => EmployeeRows.Count > 0;

    public int SelectedCount => EmployeeRows.Count(r => r.IsSelected);
    public int ClockInCount
    {
        get
        {
            var count = EmployeeRows.Count(r => r.IsSelected && r.IsEligibleForClockIn);
            if (ManagerSelfEligibleForClockIn && !IsManagerInSelectedClockIn())
                count++;
            return count;
        }
    }
    public int ClockOutCount
    {
        get
        {
            var count = EmployeeRows.Count(r => r.IsSelected && r.IsEligibleForClockOut);
            if (ManagerSelfEligibleForClockOut && !IsManagerInSelectedClockOut())
                count++;
            return count;
        }
    }

    public string ClockInButtonLabel  => ClockInCount  > 0 ? $"Clock In {ClockInCount}"  : "Clock In";
    public string ClockOutButtonLabel => ClockOutCount > 0 ? $"Clock Out {ClockOutCount}" : "Clock Out";
    public bool CanClockIn  => ClockInCount  > 0 && !IsTeamPunching;
    public bool CanClockOut => ClockOutCount > 0 && !IsTeamPunching;

    public HrTeamPunchViewModel(
        IStorageService storage, ILocationService location, TimesheetStateService state,
        IBranchGeofenceService geofence, IPermissionsService permissions, EmployeeScopeService scope)
    {
        _storage  = storage;
        _location = location;
        _state    = state;
        _geofence = geofence;
        _permissions = permissions;
        _scope = scope;
        Title = "Team Clock In/Out";
    }

    partial void OnTeamIdChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            _pendingTeamId = value;
    }

    partial void OnIncludeSelfInTeamPunchChanged(bool value)
    {
        NotifyManagerSelfProperties();
        RefreshCounts();
    }

    private bool IsManagerInSelectedClockIn()
    {
        var mgrId = _state.CurrentEmployee?.Id;
        return mgrId != null && EmployeeRows.Any(r =>
            r.Employee.Id == mgrId && r.IsSelected && r.IsEligibleForClockIn);
    }

    private bool IsManagerInSelectedClockOut()
    {
        var mgrId = _state.CurrentEmployee?.Id;
        return mgrId != null && EmployeeRows.Any(r =>
            r.Employee.Id == mgrId && r.IsSelected && r.IsEligibleForClockOut);
    }

    private void NotifyManagerSelfProperties()
    {
        OnPropertyChanged(nameof(ManagerSelfName));
        OnPropertyChanged(nameof(ManagerSelfEligibleForClockIn));
        OnPropertyChanged(nameof(ManagerSelfEligibleForClockOut));
        OnPropertyChanged(nameof(ManagerSelfStatusLabel));
        OnPropertyChanged(nameof(ManagerSelfSummary));
    }

    private async Task RefreshManagerSelfStatusAsync(
        Guid companyId,
        DateOnly today,
        HashSet<Guid>? onLeaveIds = null,
        HashSet<Guid>? absentIds = null)
    {
        var manager = _state.CurrentEmployee;
        if (manager == null) return;

        var lastPunch = await _storage.GetLastPunchAsync(manager.Id);
        _managerIsClockedIn = lastPunch?.PunchType == PunchType.In;

        if (onLeaveIds == null)
        {
            var allLeave = await _storage.GetLeaveRequestsAsync(companyId);
            onLeaveIds = allLeave
                .Where(r => r.IsApproved && r.StartDate <= today && r.EndDate >= today)
                .Select(r => r.EmployeeId)
                .ToHashSet();
        }

        if (absentIds == null)
        {
            var absences = await _storage.GetDailyAbsencesAsync(companyId, today);
            absentIds = absences.Select(a => a.EmployeeId).ToHashSet();
        }

        _managerIsOnLeave = onLeaveIds.Contains(manager.Id);
        _managerIsAbsent = absentIds.Contains(manager.Id);
        NotifyManagerSelfProperties();
    }

    private List<Guid> BuildPunchIdList(List<EmployeePunchRow> teamRows, bool clockIn, Employee manager)
    {
        var ids = teamRows.Select(r => r.Employee.Id).Distinct().ToList();
        if (!IncludeSelfInTeamPunch || ids.Contains(manager.Id))
            return ids;

        var includeManager = clockIn ? ManagerSelfEligibleForClockIn : ManagerSelfEligibleForClockOut;
        if (includeManager)
            ids.Insert(0, manager.Id);

        return ids;
    }

    private void ApplyPunchResultToRows(IEnumerable<Guid> punchedIds, bool clockedIn)
    {
        var idSet = punchedIds.ToHashSet();
        var time = DateTime.Now.ToString("HH:mm");
        foreach (var row in EmployeeRows.Where(r => idSet.Contains(r.Employee.Id)))
        {
            row.IsClockedIn = clockedIn;
            row.LastPunchTime = time;
        }
    }

    private void UpdateManagerStateFromPunch(List<TimePunch> inserted, Employee manager)
    {
        var managerPunch = inserted.LastOrDefault(p => p.EmployeeId == manager.Id);
        if (managerPunch == null) return;

        _state.SetLastPunch(managerPunch);
        _managerIsClockedIn = managerPunch.PunchType == PunchType.In;
        NotifyManagerSelfProperties();
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var viewer = _state.CurrentEmployee!;
            await _permissions.RefreshAsync(companyId, viewer);

            var allEmployees = await _storage.GetEmployeesAsync(companyId);
            var allTeams = await _storage.GetWorkTeamsAsync(companyId);
            _allEmployees = _scope.FilterEmployees(viewer, allEmployees, allTeams, _permissions).ToList();
            _allTeams = _scope.FilterTeams(viewer, allTeams, _permissions).ToList();
            Teams = new ObservableCollection<WorkTeam>(_allTeams);
            OnPropertyChanged(nameof(HasTeams));

            var preferred = !string.IsNullOrWhiteSpace(_pendingTeamId)
                ? _allTeams.FirstOrDefault(t => t.Id.ToString() == _pendingTeamId)
                : null;
            _pendingTeamId = null;

            if (preferred != null)
            {
                _suppressTeamChanged = true;
                SelectedTeam = preferred;
                _suppressTeamChanged = false;
                await FetchTeamEmployeesAsync(preferred);
            }
            else if (_allTeams.Count > 0)
            {
                _suppressTeamChanged = true;
                SelectedTeam = _allTeams[0];
                _suppressTeamChanged = false;
                await FetchTeamEmployeesAsync(_allTeams[0]);
            }
            else
            {
                await SetEmployeeRowsAsync([]);
            }

            var today = DateOnly.FromDateTime(DateTime.Today);
            await RefreshManagerSelfStatusAsync(companyId, today);
        });

        RefreshCounts();
        _ = FetchLocationAsync();
    }

    partial void OnSelectedTeamChanged(WorkTeam? value)
    {
        if (_suppressTeamChanged) return;
        if (value == null)
        {
            _ = SetEmployeeRowsAsync([]);
            return;
        }
        _ = FetchTeamEmployeesAsync(value);
    }

    private void OnRowPropertyChanged(object? sender, PropertyChangedEventArgs e) => RefreshCounts();

    private void UnsubscribeRows()
    {
        foreach (var row in _subscribedRows)
            row.PropertyChanged -= OnRowPropertyChanged;
        _subscribedRows.Clear();
    }

    private async Task SetEmployeeRowsAsync(IEnumerable<EmployeePunchRow> rows)
    {
        var list = rows.ToList();
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            UnsubscribeRows();
            foreach (var row in list)
            {
                row.PropertyChanged += OnRowPropertyChanged;
                _subscribedRows.Add(row);
            }
            EmployeeRows = new ObservableCollection<EmployeePunchRow>(list);
            OnPropertyChanged(nameof(HasEmployees));
            RefreshCounts();
        });
    }

    private async Task FetchTeamEmployeesAsync(WorkTeam team)
    {
        try
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var today = DateOnly.FromDateTime(DateTime.Today);
            var members = _allEmployees
                .Where(e => team.MemberIds.Contains(e.Id) && e.IsActive)
                .ToList();

            var lastPunches = members.Count == 0
                ? []
                : await _storage.GetEmployeesLastPunchAsync(companyId, members.Select(e => e.Id).ToList());

            var punchMap = lastPunches
                .GroupBy(p => p.EmployeeId)
                .ToDictionary(g => g.Key, g => g.First());

            var allLeave = await _storage.GetLeaveRequestsAsync(companyId);
            var onLeaveIds = allLeave
                .Where(r => r.IsApproved && r.StartDate <= today && r.EndDate >= today)
                .Select(r => r.EmployeeId)
                .ToHashSet();

            var absences = await _storage.GetDailyAbsencesAsync(companyId, today);
            var absentByEmployee = absences
                .GroupBy(a => a.EmployeeId)
                .ToDictionary(g => g.Key, g => g.First());
            var absentIds = absentByEmployee.Keys.ToHashSet();

            var rows = members
                .OrderBy(e => e.FullName)
                .Select(e =>
                {
                    var isOnLeave = onLeaveIds.Contains(e.Id);
                    var isAbsent = absentByEmployee.ContainsKey(e.Id);
                    string? note = null;
                    if (isAbsent)
                        note = absentByEmployee[e.Id].ReasonLabel;
                    else if (isOnLeave)
                        note = "Approved leave";

                    return new EmployeePunchRow(
                        e,
                        punchMap.TryGetValue(e.Id, out var p) ? p : null,
                        isOnLeave,
                        isAbsent,
                        note);
                })
                .ToList();

            await SetEmployeeRowsAsync(rows);
            await RefreshManagerSelfStatusAsync(companyId, today, onLeaveIds, absentIds);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Could Not Load Team", ex.Message, "OK"));
        }
    }

    private void RefreshCounts()
    {
        MainThread.BeginInvokeOnMainThread(() =>
        {
            OnPropertyChanged(nameof(SelectedCount));
            OnPropertyChanged(nameof(ClockInCount));
            OnPropertyChanged(nameof(ClockOutCount));
            OnPropertyChanged(nameof(ClockInButtonLabel));
            OnPropertyChanged(nameof(ClockOutButtonLabel));
            OnPropertyChanged(nameof(CanClockIn));
            OnPropertyChanged(nameof(CanClockOut));
        });
    }

    private async Task FetchLocationAsync()
    {
        IsGettingLocation = true;
        var pos = await _location.GetCurrentPositionAsync(highAccuracy: true);
        IsGettingLocation = false;
        if (pos != null)
        {
            _lat = pos.Latitude;
            _lng = pos.Longitude;
            CurrentAddress = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude) ?? "Unknown location";
        }
        else
        {
            CurrentAddress = "Location unavailable";
        }
    }

    [RelayCommand]
    private void SelectAll()
    {
        foreach (var r in EmployeeRows.Where(r => r.CanSelect))
            r.IsSelected = true;
        RefreshCounts();
    }

    [RelayCommand]
    private void DeselectAll()
    {
        foreach (var r in EmployeeRows)
            r.IsSelected = false;
        RefreshCounts();
    }

    [RelayCommand]
    private async Task ClockInTeamAsync()
    {
        if (IsTeamPunching) return;

        var selected = EmployeeRows.Where(r => r.IsSelected).ToList();
        var toClockIn = selected.Where(r => r.IsEligibleForClockIn).ToList();
        var skippedAlreadyIn = selected.Where(r => r.IsClockedIn && r.CanSelect).ToList();
        var skippedOnLeave = selected.Where(r => r.IsOnLeave).ToList();
        var skippedAbsent = selected.Where(r => r.IsAbsent).ToList();

        var manager = _state.CurrentEmployee;
        if (manager == null)
        {
            await Shell.Current.DisplayAlert("Cannot Clock In", "Your profile is not loaded. Please sign in again.", "OK");
            return;
        }

        var punchIds = BuildPunchIdList(toClockIn, clockIn: true, manager);
        if (punchIds.Count == 0)
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert(
                    "Nothing to Clock In",
                    BuildSkipSummary(skippedAlreadyIn, skippedOnLeave, skippedAbsent, "clock in"),
                    "OK"));
            return;
        }

        try
        {
            IsTeamPunching = true;
            ErrorMessage = null;

            if (!_lat.HasValue || !_lng.HasValue)
                await FetchLocationAsync();

            var company = _state.CurrentCompany ?? await _storage.GetCurrentCompanyAsync(manager.CompanyId);
            var geofenceBlocked = new List<EmployeePunchRow>();
            var allowedIds = new List<Guid>();
            if (company != null)
            {
                foreach (var id in punchIds)
                {
                    var emp = _allEmployees.FirstOrDefault(e => e.Id == id);
                    if (emp == null) continue;
                    var check = await _geofence.ValidateClockInAsync(emp, company, _lat, _lng);
                    if (check.IsAllowed)
                        allowedIds.Add(id);
                    else
                    {
                        var row = EmployeeRows.FirstOrDefault(r => r.Employee.Id == id);
                        if (row != null) geofenceBlocked.Add(row);
                    }
                }
            }
            else
            {
                allowedIds = punchIds;
            }

            if (allowedIds.Count == 0)
            {
                var names = string.Join(", ", geofenceBlocked.Select(r => r.Employee.FullName));
                await MainThread.InvokeOnMainThreadAsync(() =>
                    Shell.Current.DisplayAlert(
                        "Cannot Clock In",
                        geofenceBlocked.Count == 1
                            ? $"{names} is not within their branch sign-in area."
                            : $"These team members are outside their branch sign-in area: {names}",
                        "OK"));
                return;
            }

            var inserted = await _storage.InsertTeamPunchAsync(
                allowedIds,
                manager.CompanyId,
                clockIn: true,
                _lat, _lng, CurrentAddress,
                _supabaseUserId(),
                manager.Id);

            ApplyPunchResultToRows(allowedIds, clockedIn: true);
            UpdateManagerStateFromPunch(inserted, manager);
            RefreshCounts();

            if (SelectedTeam != null)
                await FetchTeamEmployeesAsync(SelectedTeam);

            var includesSelf = allowedIds.Contains(manager.Id);
            var summary = BuildSuccessSummary(
                "clocked in", inserted.Count, skippedAlreadyIn, skippedOnLeave, skippedAbsent, includesSelf);
            if (geofenceBlocked.Count > 0)
                summary += $"\n\nOutside branch area: {FormatNames(geofenceBlocked)}";
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Team Clocked In", summary, "OK"));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Clock In Failed", ex.Message, "OK"));
        }
        finally
        {
            IsTeamPunching = false;
            RefreshCounts();
        }
    }

    [RelayCommand]
    private async Task ClockOutTeamAsync()
    {
        if (IsTeamPunching) return;

        var selected = EmployeeRows.Where(r => r.IsSelected).ToList();
        var toClockOut = selected.Where(r => r.IsEligibleForClockOut).ToList();
        var skippedAlreadyOut = selected.Where(r => !r.IsClockedIn && r.CanSelect).ToList();
        var skippedOnLeave = selected.Where(r => r.IsOnLeave).ToList();
        var skippedAbsent = selected.Where(r => r.IsAbsent).ToList();

        var manager = _state.CurrentEmployee;
        if (manager == null)
        {
            await Shell.Current.DisplayAlert("Cannot Clock Out", "Your profile is not loaded. Please sign in again.", "OK");
            return;
        }

        var punchIds = BuildPunchIdList(toClockOut, clockIn: false, manager);
        if (punchIds.Count == 0)
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert(
                    "Nothing to Clock Out",
                    BuildSkipSummary(skippedAlreadyOut, skippedOnLeave, skippedAbsent, "clock out"),
                    "OK"));
            return;
        }

        try
        {
            IsTeamPunching = true;
            ErrorMessage = null;

            if (!_lat.HasValue || !_lng.HasValue)
                await FetchLocationAsync();

            var inserted = await _storage.InsertTeamPunchAsync(
                punchIds,
                manager.CompanyId,
                clockIn: false,
                _lat, _lng, CurrentAddress,
                _supabaseUserId(),
                manager.Id);

            ApplyPunchResultToRows(punchIds, clockedIn: false);
            UpdateManagerStateFromPunch(inserted, manager);
            RefreshCounts();

            if (SelectedTeam != null)
                await FetchTeamEmployeesAsync(SelectedTeam);

            var includesSelf = punchIds.Contains(manager.Id);
            var summary = BuildSuccessSummary(
                "clocked out", inserted.Count, skippedAlreadyOut, skippedOnLeave, skippedAbsent, includesSelf);
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Team Clocked Out", summary, "OK"));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Clock Out Failed", ex.Message, "OK"));
        }
        finally
        {
            IsTeamPunching = false;
            RefreshCounts();
        }
    }

    private static string BuildSuccessSummary(
        string actionPast,
        int count,
        List<EmployeePunchRow> skippedAlready,
        List<EmployeePunchRow> skippedOnLeave,
        List<EmployeePunchRow> skippedAbsent,
        bool includedSelf = false)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"{count} employee{(count == 1 ? "" : "s")} {actionPast} at {DateTime.Now:HH:mm}.");
        if (includedSelf)
            sb.AppendLine("You were included in this punch.");
        var skip = BuildSkipLines(skippedAlready, skippedOnLeave, skippedAbsent, actionPast.Contains("in") ? "clock in" : "clock out");
        if (!string.IsNullOrEmpty(skip))
        {
            sb.AppendLine();
            sb.Append(skip);
        }
        return sb.ToString().TrimEnd();
    }

    private static string BuildSkipSummary(
        List<EmployeePunchRow> skippedAlready,
        List<EmployeePunchRow> skippedOnLeave,
        List<EmployeePunchRow> skippedAbsent,
        string action)
    {
        var lines = BuildSkipLines(skippedAlready, skippedOnLeave, skippedAbsent, action);
        return string.IsNullOrEmpty(lines)
            ? $"No selected employees can be {action}."
            : $"No one was {action}.\n\n{lines}";
    }

    private static string BuildSkipLines(
        List<EmployeePunchRow> skippedAlready,
        List<EmployeePunchRow> skippedOnLeave,
        List<EmployeePunchRow> skippedAbsent,
        string action)
    {
        var sb = new StringBuilder();
        if (skippedAlready.Count > 0)
        {
            var label = action == "clock in" ? "Already clocked in" : "Already clocked out";
            sb.AppendLine($"{label}: {FormatNames(skippedAlready)}");
        }
        if (skippedOnLeave.Count > 0)
            sb.AppendLine($"On leave: {FormatNames(skippedOnLeave)}");
        if (skippedAbsent.Count > 0)
            sb.AppendLine($"Absent today: {FormatNames(skippedAbsent)}");
        return sb.ToString().TrimEnd();
    }

    private static string FormatNames(IEnumerable<EmployeePunchRow> rows)
        => string.Join(", ", rows.Select(r => r.Employee.FullName));

    [RelayCommand]
    private async Task CreateTeamAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync(
            "New Team", "Team name:", "Create", "Cancel", "e.g. Morning Shift");
        if (string.IsNullOrWhiteSpace(name)) return;

        WorkTeam? created = null;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var team = new WorkTeam
            {
                Name      = name.Trim(),
                CompanyId = companyId,
                IsActive  = true
            };
            created = await _storage.CreateWorkTeamAsync(team);
            _allTeams.Add(created);
            Teams.Add(created);
            _suppressTeamChanged = true;
            SelectedTeam = created;
            _suppressTeamChanged = false;
            OnPropertyChanged(nameof(HasTeams));
        });

        if (created == null) return;

        await PromptAddMembersAsync(created);
        await FetchTeamEmployeesAsync(created);
        RefreshCounts();

        if (created.MemberIds.Count == 0)
        {
            await Shell.Current.DisplayAlert(
                "Add Team Members",
                "Select employees with '+ Add Members' so you can clock the team in together.",
                "OK");
        }
    }

    [RelayCommand]
    private async Task AddMembersAsync()
    {
        if (SelectedTeam == null)
        {
            await Shell.Current.DisplayAlert("Select a Team", "Choose or create a team first.", "OK");
            return;
        }

        try
        {
            await PromptAddMembersAsync(SelectedTeam);
            await FetchTeamEmployeesAsync(SelectedTeam);
            RefreshCounts();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlert("Could Not Add Members", ex.Message, "OK");
        }
    }

    private async Task PromptAddMembersAsync(WorkTeam team)
    {
        while (true)
        {
            var available = _allEmployees
                .Where(e => e.IsActive && !team.MemberIds.Contains(e.Id))
                .OrderBy(e => e.FullName)
                .ToList();

            if (available.Count == 0)
            {
                if (team.MemberIds.Count == 0)
                    await Shell.Current.DisplayAlert(
                        "No Employees Available",
                        "Add active employees to your company first, then assign them to this team.",
                        "OK");
                break;
            }

            var names = available.Select(e => e.FullName).ToArray();
            var title = team.MemberIds.Count == 0
                ? "Add employees to this team"
                : "Add another employee";

            string? chosen;
            try
            {
                chosen = await MainThread.InvokeOnMainThreadAsync(() =>
                    Shell.Current.DisplayActionSheet(title, "Done", null, names));
            }
            catch
            {
                break;
            }

            if (string.IsNullOrEmpty(chosen) || chosen == "Done") break;

            var employee = available.FirstOrDefault(e => e.FullName == chosen);
            if (employee == null) continue;

            team.MemberIds.Add(employee.Id);
            await _storage.UpdateWorkTeamAsync(team);

            var idx = _allTeams.FindIndex(t => t.Id == team.Id);
            if (idx >= 0) _allTeams[idx] = team;
        }
    }

    private Guid? _supabaseUserId()
    {
        var userId = _state.CurrentEmployee?.UserId;
        return userId is { } id && id != Guid.Empty ? id : null;
    }
}
