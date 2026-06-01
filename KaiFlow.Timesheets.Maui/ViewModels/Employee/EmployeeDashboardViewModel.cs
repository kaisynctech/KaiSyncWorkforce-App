using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public record ActivityItem(string Category, string Label, string Sub, string When, string Color);

public partial class EmployeeDashboardViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly ILocationService _location;
    private readonly IOfflineQueueService _queue;
    private readonly IExportService _export;
    private readonly RealtimeService _realtime;
    private readonly IBranchGeofenceService _geofence;
    private readonly IFeatureAccessService _features;
    private bool _statusRefreshInFlight;

    [ObservableProperty] private ObservableCollection<Job> _myJobs = [];
    [ObservableProperty] private ObservableCollection<TimePunch> _recentPunches = [];
    [ObservableProperty] private ObservableCollection<PunchSession> _myAttendanceSessions = [];
    [ObservableProperty] private ObservableCollection<WorkTeam> _myTeams = [];
    [ObservableProperty] private string _attendanceRange = "week";
    [ObservableProperty] private DateTime _customAttendanceFrom = DateTime.Today.AddDays(-7);
    [ObservableProperty] private DateTime _customAttendanceTo = DateTime.Today;

    public bool IsCustomRange => AttendanceRange == "custom";

    private List<TimePunch> _allMyPunches = [];
    private List<DailyAbsence> _myAbsences = [];
    private List<LeaveRequest> _myLeave = [];
    private EmployeeShiftTemplate? _myTemplate;

    partial void OnAttendanceRangeChanged(string value)
    {
        OnPropertyChanged(nameof(IsCustomRange));
        if (value != "custom") RebuildSessions();
    }

    [RelayCommand]
    private void SetAttendanceRange(string range) => AttendanceRange = range;

    [RelayCommand]
    private void ApplyCustomRange() => RebuildSessions();

    private (DateOnly from, DateOnly to) GetAttendanceDateRange()
    {
        var now = DateTime.Now;
        return AttendanceRange switch
        {
            "today"  => (DateOnly.FromDateTime(now.Date), DateOnly.FromDateTime(now.Date)),
            "week"   => (DateOnly.FromDateTime(now.AddDays(-7).Date), DateOnly.FromDateTime(now.Date)),
            "month"  => (DateOnly.FromDateTime(now.AddDays(-30).Date), DateOnly.FromDateTime(now.Date)),
            "custom" => (DateOnly.FromDateTime(CustomAttendanceFrom.Date), DateOnly.FromDateTime(CustomAttendanceTo.Date)),
            _        => (DateOnly.FromDateTime(now.AddDays(-30).Date), DateOnly.FromDateTime(now.Date)),
        };
    }

    private void RebuildSessions()
    {
        var now = DateTime.Now;
        var filtered = AttendanceRange switch
        {
            "today"  => _allMyPunches.Where(p => p.LocalDateTime.Date == now.Date),
            "week"   => _allMyPunches.Where(p => p.LocalDateTime >= now.AddDays(-7)),
            "month"  => _allMyPunches.Where(p => p.LocalDateTime >= now.AddDays(-30)),
            "custom" => _allMyPunches.Where(p => p.LocalDateTime.Date >= CustomAttendanceFrom.Date && p.LocalDateTime.Date <= CustomAttendanceTo.Date),
            _        => _allMyPunches.AsEnumerable(),
        };
        var employee = _state.CurrentEmployee;
        Dictionary<Guid, Employee>? empMap = employee != null
            ? new Dictionary<Guid, Employee> { [employee.Id] = employee }
            : null;
        Dictionary<Guid, EmployeeShiftTemplate>? tmplMap = _myTemplate != null
            ? new Dictionary<Guid, EmployeeShiftTemplate> { [_myTemplate.Id] = _myTemplate }
            : null;
        var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
        int lateMin = settings.TryGetValue("late_threshold_minutes", out var l) && int.TryParse(l?.ToString(), out var li) ? li : 30;
        int otMin   = settings.TryGetValue("ot_start_after_minutes",  out var o) && int.TryParse(o?.ToString(), out var oi) ? oi : 30;
        var sessions = PunchSession.Build(filtered, empMap, tmplMap, lateMin, otMin);
        if (employee != null)
        {
            var (from, to) = GetAttendanceDateRange();
            sessions = AttendanceCalendarHelper.MergeNonWorkDays(
                sessions, _myAbsences, _myLeave, employee, from, to, lateMin, otMin, _myTemplate);
        }
        MyAttendanceSessions = new ObservableCollection<PunchSession>(sessions);
    }

    private async Task BackfillAddressesAsync(List<TimePunch> punches)
    {
        var missing = punches.Where(p => string.IsNullOrEmpty(p.Address) && p.Latitude.HasValue).ToList();
        if (missing.Count == 0) return;
        foreach (var p in missing)
        {
            var addr = await _location.ReverseGeocodeAsync(p.Latitude!.Value, p.Longitude!.Value);
            if (!string.IsNullOrEmpty(addr))
            {
                p.Address = addr;
                try
                {
                    var employee = _state.CurrentEmployee!;
                    await _storage.UpdatePunchAddressAsync(p.Id, addr!, employee.CompanyId, employee.Id);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"UpdatePunchAddressAsync: {ex.Message}");
                }
            }
        }
    }
    [ObservableProperty] private ObservableCollection<ActivityItem> _recentActivity = [];
    [ObservableProperty] private ObservableCollection<PaTask> _todayPaTasks = [];
    [ObservableProperty] private ObservableCollection<string> _colleaguesOnLeave = [];
    [ObservableProperty] private bool _isAbsentToday;
    [ObservableProperty] private string _absenceReason = "";
    [ObservableProperty] private bool _isOnLeaveToday;
    [ObservableProperty] private string _onLeaveLabel = "";

    public bool HasColleaguesOnLeave => ColleaguesOnLeave.Count > 0;
    public bool HasTodayPaTasks => TodayPaTasks.Count > 0;
    public bool IsNotAbsentToday     => !IsAbsentToday;
    public bool ShowOnLeaveBanner    => IsOnLeaveToday && !IsClockedIn;
    public bool CanClockInToday      => !IsOnLeaveToday && !IsAbsentToday;
    public int  MyJobCount           => MyJobs.Count;

    partial void OnColleaguesOnLeaveChanged(ObservableCollection<string> value)
        => OnPropertyChanged(nameof(HasColleaguesOnLeave));
    partial void OnIsAbsentTodayChanged(bool value)
    {
        OnPropertyChanged(nameof(IsNotAbsentToday));
        OnPropertyChanged(nameof(CanClockInToday));
        OnPropertyChanged(nameof(ClockButtonLabel));
    }
    partial void OnIsOnLeaveTodayChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowOnLeaveBanner));
        OnPropertyChanged(nameof(CanClockInToday));
        OnPropertyChanged(nameof(ClockButtonLabel));
    }
    partial void OnMyJobsChanged(ObservableCollection<Job> value)
        => OnPropertyChanged(nameof(MyJobCount));
    [ObservableProperty] private string _clockStatus = "Clocked Out";
    [ObservableProperty] private string _lastPunchTime = "";
    [ObservableProperty] private bool _isClockedIn;
    [ObservableProperty] private int _notificationCount;
    [ObservableProperty] private int _activeTab = 0;
    [ObservableProperty] private bool _branchGeofenceActive;
    [ObservableProperty] private bool _isWithinBranchRadius = true;
    [ObservableProperty] private string _branchGeofenceMessage = "";

    public bool ShowBranchGeofenceBanner => BranchGeofenceActive && !IsClockedIn && !string.IsNullOrEmpty(BranchGeofenceMessage);
    public bool IsOutsideBranchRadius => BranchGeofenceActive && !IsWithinBranchRadius && !IsClockedIn;

    public bool IsHomeTab => ActiveTab == 0;
    public bool IsMoreTab => ActiveTab == 4;

    partial void OnActiveTabChanged(int value)
    {
        OnPropertyChanged(nameof(IsHomeTab));
        OnPropertyChanged(nameof(IsMoreTab));
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = int.Parse(tab);

    public Employee? CurrentEmployee => _state.CurrentEmployee;
    public Company? CurrentCompany => _state.CurrentCompany;
    public string ClockButtonLabel => IsClockedIn
        ? "Clock Out"
        : IsOnLeaveToday ? "On Leave"
        : IsAbsentToday ? "Absent Today"
        : "Clock In";

    public bool IsPendingMembership =>
        _state.CurrentEmployee?.RegistrationStatus == "pending"
        || (_state.CurrentEmployee != null && !_state.CurrentEmployee.IsActive);

    public bool IsCompanyWorkspaceActive => !IsPendingMembership;
    public bool ShowClockCard => IsCompanyWorkspaceActive && ShowAttendanceModule;

    public string PendingBannerText =>
        CurrentCompany != null
            ? $"Awaiting HR approval at {CurrentCompany.Name}. You can upload documents below — only this company can see them."
            : "Awaiting HR approval. You can upload documents for this company while you wait.";

    partial void OnIsClockedInChanged(bool value)
    {
        OnPropertyChanged(nameof(ClockButtonLabel));
        OnPropertyChanged(nameof(ShowBranchGeofenceBanner));
        OnPropertyChanged(nameof(IsOutsideBranchRadius));
    }

    partial void OnBranchGeofenceActiveChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowBranchGeofenceBanner));
        OnPropertyChanged(nameof(IsOutsideBranchRadius));
    }

    partial void OnIsWithinBranchRadiusChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowBranchGeofenceBanner));
        OnPropertyChanged(nameof(IsOutsideBranchRadius));
    }

    partial void OnBranchGeofenceMessageChanged(string value) => OnPropertyChanged(nameof(ShowBranchGeofenceBanner));

    public EmployeeDashboardViewModel(IStorageService storage, TimesheetStateService state, ILocationService location, IOfflineQueueService queue, IExportService export, RealtimeService realtime, IBranchGeofenceService geofence, IFeatureAccessService features)
    {
        _storage = storage;
        _state = state;
        _location = location;
        _queue = queue;
        _export = export;
        _realtime = realtime;
        _geofence = geofence;
        _features = features;
        Title = "Dashboard";
        _state.StateChanged += OnStateChanged;
        _realtime.PunchChanged += OnPunchChanged;
    }

    private void OnPunchChanged(object? sender, EventArgs e)
        => MainThread.BeginInvokeOnMainThread(() => _ = LoadAsync());

    private void OnStateChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(CurrentEmployee));
        OnPropertyChanged(nameof(CurrentCompany));
        OnPropertyChanged(nameof(IsPendingMembership));
        OnPropertyChanged(nameof(IsCompanyWorkspaceActive));
        OnPropertyChanged(nameof(PendingBannerText));
    }

    public void Dispose()
    {
        UnsubscribeAccountRealtime();
        _realtime.PunchChanged -= OnPunchChanged;
        _state.StateChanged -= OnStateChanged;
    }

    public void SubscribeAccountRealtime()
    {
        _realtime.MembershipChanged += OnAccountChanged;
        _realtime.AccountNotificationChanged += OnAccountChanged;
        _ = _realtime.EnsureAccountSubscriptionAsync();
    }

    public void UnsubscribeAccountRealtime()
    {
        _realtime.MembershipChanged -= OnAccountChanged;
        _realtime.AccountNotificationChanged -= OnAccountChanged;
    }

    private async void OnAccountChanged(object? sender, EventArgs e)
    {
        try
        {
            if (IsPendingMembership)
                await RefreshMembershipStatusAsync();
            else
            {
                var appNotes = await _storage.GetMyNotificationsAsync(_state.CurrentEmployee?.Id);
                NotificationCount = appNotes.Count(n => !n.IsRead);
            }
        }
        catch { /* ignore */ }
    }

    private async Task RefreshMembershipStatusAsync()
    {
        if (_statusRefreshInFlight) return;
        _statusRefreshInFlight = true;

        try
        {
            var employee = _state.CurrentEmployee;
            if (employee == null) return;

            var memberships = await _storage.GetMyMembershipsAsync();
            var current = memberships.FirstOrDefault(m => m.EmployeeId == employee.Id);
            if (current == null) return;

            var wasPending = employee.RegistrationStatus == "pending" || !employee.IsActive;
            var refreshed = await _storage.GetEmployeeForCompanyAsync(current.CompanyId);
            _state.SetEmployee(refreshed ?? current.ToEmployee());

            if (!wasPending)
            {
                await LoadAsync();
                return;
            }

            if (current.IsApproved)
            {
                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    await Shell.Current.DisplayAlert(
                        "Account Approved",
                        $"Your account at {current.CompanyName} has been approved. Open My Companies to continue.",
                        "OK");
                    await EmployeeAccountRouting.GoToCompanyPickerAsync();
                });
                return;
            }

            if (current.IsRejected)
            {
                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    await Shell.Current.DisplayAlert(
                        "Registration Declined",
                        $"Your request to join {current.CompanyName} was declined.",
                        "OK");
                    await EmployeeAccountRouting.GoToCompanyPickerAsync();
                });
                return;
            }

            await LoadAsync();
        }
        finally
        {
            _statusRefreshInFlight = false;
        }
    }

    [ObservableProperty] private bool _showLeaveModule;
    [ObservableProperty] private bool _showJobsModule;
    [ObservableProperty] private bool _showSchedulingModule;
    [ObservableProperty] private bool _showIncidentsModule;
    [ObservableProperty] private bool _showPaModule;
    [ObservableProperty] private bool _showPaperlessModule;
    [ObservableProperty] private bool _showPayrollModule;
    [ObservableProperty] private bool _showContractorsModule;
    [ObservableProperty] private bool _showMessagingModule;
    [ObservableProperty] private bool _showAttendanceModule;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee;
            if (employee == null) return;

            var fullProfile = await _storage.GetEmployeeForCompanyAsync(employee.CompanyId);
            if (fullProfile != null)
                _state.SetEmployee(fullProfile);
            employee = _state.CurrentEmployee!;
            await _storage.EnsureEmployeeCompanyRelationshipAsync(employee);

            if (_state.CurrentCompany == null || _state.CurrentCompany.Id != employee.CompanyId)
            {
                var loadedCompany = await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (loadedCompany != null)
                    _state.SetCompany(loadedCompany);
            }
            await _features.RefreshAsync(employee.CompanyId);
            RefreshModuleNavigation();

            OnPropertyChanged(nameof(IsPendingMembership));
            OnPropertyChanged(nameof(IsCompanyWorkspaceActive));
            OnPropertyChanged(nameof(PendingBannerText));

            var appNotes = await _storage.GetMyNotificationsAsync(employee.Id);
            NotificationCount = appNotes.Count(n => !n.IsRead);

            if (IsPendingMembership)
            {
                ClockStatus = "Awaiting approval";
                IsClockedIn = false;
                LastPunchTime = "Available after HR approves your account";
                MyJobs = [];
                MyTeams = [];
                MyAttendanceSessions = [];
                RecentPunches = [];
                RecentActivity = [];
                ColleaguesOnLeave = [];
                return;
            }

            if (employee.ShiftTemplateId.HasValue)
            {
                var templates = await _storage.GetShiftTemplatesAsync(employee.CompanyId);
                _myTemplate = templates.FirstOrDefault(t => t.Id == employee.ShiftTemplateId.Value);
            }

            var lastPunch = await _storage.GetMyLastPunchAsync(employee.Id);
            _state.SetLastPunch(lastPunch);

            IsClockedIn = lastPunch?.PunchType == PunchType.In;
            ClockStatus = IsClockedIn ? "Clocked In" : "Clocked Out";
            LastPunchTime = lastPunch != null
                ? lastPunch.LocalDateTime.ToString("ddd, dd MMM yyyy HH:mm")
                : "No recent punches";

            var today = DateOnly.FromDateTime(DateTime.Today);
            var punches = await _storage.GetMyPunchesAsync(
                employee.CompanyId,
                employee.Id,
                today.AddDays(-30),
                today);

            _allMyPunches = punches;
            await BackfillAddressesAsync(punches);
            RecentPunches = new ObservableCollection<TimePunch>(punches.TakeLast(5));
            RebuildSessions();

            var company = _state.CurrentCompany ?? await _storage.GetCurrentCompanyAsync(employee.CompanyId);
            if (company != null && _state.CurrentCompany == null)
                _state.SetCompany(company);

            _ = RefreshBranchGeofenceStatusAsync();

            var jobs = await _storage.GetJobsAsync(employee.CompanyId, employee.Id);
            MyJobs = new ObservableCollection<Job>(jobs.Where(j => j.IsOpen));

            if (ShowPaModule)
            {
                await _storage.SyncOperationalPaTasksAsync(employee.CompanyId, employee.Id);
                var pa = await _storage.GetPaTasksAsync(employee.CompanyId, employee.Id);
                TodayPaTasks = new ObservableCollection<PaTask>(MyPaHelper.TodayStrip(pa));
                OnPropertyChanged(nameof(HasTodayPaTasks));
            }
            else
            {
                TodayPaTasks = [];
                OnPropertyChanged(nameof(HasTodayPaTasks));
            }

            var teams = await _storage.GetWorkTeamsAsync(employee.CompanyId, employee.Id);
            MyTeams = new ObservableCollection<WorkTeam>(
                teams.Where(t => t.MemberIds.Contains(employee.Id)));

            // Who's on approved leave today (company-wide, excluding self)
            var todayDate = DateOnly.FromDateTime(DateTime.Today);
            var allLeave = await _storage.GetLeaveRequestsAsync(employee.CompanyId);
            var allEmployees = await _storage.GetEmployeesAsync(employee.CompanyId, employee.Id);
            var empMap = allEmployees.ToDictionary(e => e.Id, e => e.FullName);
            var onLeave = allLeave
                .Where(r => r.IsApproved && r.StartDate <= todayDate && r.EndDate >= todayDate && r.EmployeeId != employee.Id)
                .Select(r =>
                {
                    var name = empMap.TryGetValue(r.EmployeeId, out var n) ? n : "Colleague";
                    return $"{name} · {r.LeaveType} until {r.EndDate:dd MMM}";
                })
                .ToList();
            ColleaguesOnLeave = new ObservableCollection<string>(onLeave);

            // Check if employee already reported absence today
            var todayAbsences = await _storage.GetDailyAbsencesAsync(employee.CompanyId, todayDate, employee.Id);
            _myAbsences = await _storage.GetDailyAbsencesRangeAsync(
                employee.CompanyId, today.AddDays(-30), today, employee.Id);
            if (todayAbsences.Count > 0)
            {
                IsAbsentToday = true;
                AbsenceReason = todayAbsences[0].ReasonLabel;
            }
            else
            {
                IsAbsentToday = false;
                AbsenceReason = "";
            }

            IsOnLeaveToday = await _storage.IsOnLeaveTodayAsync(employee.CompanyId, employee.Id);
            var myLeaveToday = allLeave.FirstOrDefault(r =>
                r.EmployeeId == employee.Id
                && r.IsApproved
                && r.StartDate <= todayDate
                && r.EndDate >= todayDate);
            OnLeaveLabel = myLeaveToday != null
                ? $"{myLeaveToday.LeaveType} until {myLeaveToday.EndDate:dd MMM}"
                : "";

            var leave = await _storage.GetLeaveRequestsAsync(employee.CompanyId, employee.Id);
            _myLeave = leave;
            var myIncidents = await _storage.GetIncidentsAsync(employee.CompanyId, employee.Id);

            var activities = leave
                .OrderByDescending(l => l.CreatedAt)
                .Take(5)
                .Select(l => new ActivityItem(
                    "Leave",
                    $"{l.LeaveType} leave – {l.StatusRaw}",
                    $"{l.StartDate:dd MMM} → {l.EndDate:dd MMM}",
                    l.CreatedAt.ToString("dd MMM"),
                    l.StatusRaw == "approved" ? "#22C55E" : l.StatusRaw == "declined" ? "#EF4444" : "#94A3B8"))
                .Concat(myIncidents
                    .OrderByDescending(i => i.CreatedAt)
                    .Take(3)
                    .Select(i => new ActivityItem(
                        "Incident",
                        $"Incident – {i.SeverityRaw}",
                        i.Description.Length > 60 ? i.Description[..57] + "..." : i.Description,
                        i.CreatedAt.ToString("dd MMM"),
                        i.IsClosed ? "#94A3B8" : "#F59E0B")))
                .OrderByDescending(a => a.When)
                .Take(6)
                .ToList();

            RecentActivity = new ObservableCollection<ActivityItem>(activities);

            NotificationCount = leave.Count(l => l.StatusRaw is "approved" or "declined" &&
                l.DecidedAt.HasValue && l.DecidedAt.Value >= DateTime.UtcNow.AddDays(-7));
        });
    }

    [RelayCommand]
    private async Task ExportAttendanceExcelAsync()
    {
        if (!MyAttendanceSessions.Any()) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Export Excel");
        if (downloadToDevice == null) return;
        var period = AttendanceRange == "custom"
            ? $"{CustomAttendanceFrom:yyyy-MM-dd}_to_{CustomAttendanceTo:yyyy-MM-dd}"
            : AttendanceRange;
        await _export.ExportToExcelAsync(
            $"my_attendance_{period}.xlsx",
            "My Attendance",
            ["Date", "Time In", "In Location", "Time Out", "Out Location", "Total hrs", "Notes"],
            MyAttendanceSessions.Select(s => new[]
            {
                s.DateDisplay,
                s.TimeInDisplay,
                s.InLocationDisplay,
                s.TimeOutDisplay,
                s.OutLocationDisplay,
                s.TotalHrsDisplay,
                s.Notes ?? ""
            }),
            downloadToDevice: downloadToDevice.Value);
    }

    [RelayCommand]
    private async Task ExportAttendancePdfAsync()
    {
        if (!MyAttendanceSessions.Any()) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Export PDF");
        if (downloadToDevice == null) return;
        var period = AttendanceRange == "custom"
            ? $"{CustomAttendanceFrom:yyyy-MM-dd}_to_{CustomAttendanceTo:yyyy-MM-dd}"
            : AttendanceRange;
        var empName = _state.CurrentEmployee?.FullName ?? "Employee";
        await _export.ExportToPdfAsync(
            $"my_attendance_{period}.pdf",
            $"Attendance Report – {empName}",
            ["Date", "Time In", "In Location", "Time Out", "Out Location", "Total hrs", "Notes"],
            MyAttendanceSessions.Select(s => new[]
            {
                s.DateDisplay,
                s.TimeInDisplay,
                s.InLocationDisplay,
                s.TimeOutDisplay,
                s.OutLocationDisplay,
                s.TotalHrsDisplay,
                s.Notes ?? ""
            }),
            downloadToDevice: downloadToDevice.Value);
    }

    private async Task RefreshBranchGeofenceStatusAsync()
    {
        var employee = _state.CurrentEmployee;
        var company = _state.CurrentCompany;
        if (employee == null || company == null) return;

        var pos = await _location.GetCurrentPositionAsync(highAccuracy: false);
        var status = await _geofence.GetStatusAsync(employee, company, pos?.Latitude, pos?.Longitude);
        BranchGeofenceActive = status.EnforcementActive;
        IsWithinBranchRadius = status.IsWithinRadius;
        BranchGeofenceMessage = status.DisplayMessage;
    }

    private void RefreshModuleNavigation()
    {
        var company = _state.CurrentCompany;
        bool PlanModule(string key) =>
            CompanyModules.IsEnabled(company, key) && _features.CanAccessModule(company, key);

        ShowLeaveModule = PlanModule(CompanyModules.Leave);
        ShowJobsModule = PlanModule(CompanyModules.Ticketing);
        ShowSchedulingModule = PlanModule(CompanyModules.Scheduling);
        ShowIncidentsModule = CompanyModules.IsIncidentsEnabled(company)
            && _features.CanAccessModule(company, CompanyModules.Incidents);
        ShowPaModule = PlanModule(CompanyModules.MyPa);
        ShowPaperlessModule = PlanModule(CompanyModules.Paperless);
        ShowPayrollModule = PlanModule(CompanyModules.Payroll);
        ShowContractorsModule = PlanModule(CompanyModules.Contractors);
        ShowMessagingModule = PlanModule(CompanyModules.Messaging);
        ShowAttendanceModule = PlanModule(CompanyModules.Attendance);
        OnPropertyChanged(nameof(ShowClockCard));
    }

    [RelayCommand]
    private async Task GoToPunchAsync()
    {
        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        if (IsPendingMembership)
        {
            await Shell.Current.DisplayAlert(
                "Awaiting Approval",
                "Clock in and other company features unlock once HR approves your account.",
                "OK");
            return;
        }

        if (!IsClockedIn && IsOnLeaveToday)
        {
            await Shell.Current.DisplayAlert(
                "On Leave Today",
                "You are on approved leave today and cannot clock in.",
                "OK");
            return;
        }

        if (!IsClockedIn && IsAbsentToday)
        {
            await Shell.Current.DisplayAlert(
                "Marked Absent",
                "You are marked absent today and cannot clock in.",
                "OK");
            return;
        }

        await RunAsync(async () =>
        {
            Guid? jobId = null;
            var punchType = IsClockedIn ? "out" : "in";

            if (!IsClockedIn)
            {
                var wantsJob = await Shell.Current.DisplayAlert(
                    "Clock In",
                    "Is this shift associated with a job?",
                    "Yes, select job",
                    "No, just clock in");

                if (wantsJob)
                {
                    var jobs = await _storage.GetJobsAsync(employee.CompanyId, employee.Id);
                    var openJobs = jobs.Where(j => j.IsOpen).ToList();

                    if (openJobs.Count == 0)
                    {
                        await Shell.Current.DisplayAlert("No Open Jobs", "You have no open jobs assigned to you.", "OK");
                        return;
                    }

                    var titles = openJobs.Select(j => j.Title).ToArray();
                    var chosen = await Shell.Current.DisplayActionSheet("Select Job", "Cancel", null, titles);

                    if (chosen == null || chosen == "Cancel") return;

                    jobId = openJobs.FirstOrDefault(j => j.Title == chosen)?.Id;
                }
            }

            // Optional note
            var note = await Shell.Current.DisplayPromptAsync(
                punchType == "in" ? "Clock In Note" : "Clock Out Note",
                "Add a note (optional)",
                accept: "Done", cancel: "Skip",
                placeholder: punchType == "in" ? "e.g. Arrived on site" : "e.g. Completed site inspection",
                maxLength: 200,
                keyboard: Keyboard.Plain);

            var pos = await _location.GetCurrentPositionAsync(highAccuracy: false);
            string? address = null;
            if (pos != null)
                address = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude);

            if (punchType == "in")
            {
                var company = _state.CurrentCompany ?? await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (company != null)
                {
                    var geofence = await _geofence.ValidateClockInAsync(
                        employee, company, pos?.Latitude, pos?.Longitude);
                    if (!geofence.IsAllowed)
                    {
                        await Shell.Current.DisplayAlert("Cannot Clock In", geofence.BlockReason!, "OK");
                        await RefreshBranchGeofenceStatusAsync();
                        return;
                    }
                }
            }

            var punch = new TimePunch
            {
                Id         = Guid.NewGuid(),
                EmployeeId = employee.Id,
                CompanyId  = employee.CompanyId,
                TypeRaw    = punchType,
                DateTime   = DateTime.UtcNow,
                Latitude   = pos?.Latitude,
                Longitude  = pos?.Longitude,
                Address    = address,
                JobId      = jobId,
                Notes      = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
                CreatedAt  = DateTime.UtcNow
            };

            // Try immediate DB save; fall back to offline queue if no connectivity
            bool savedToDb = false;
            try
            {
                punch = await _storage.InsertPunchAsync(punch);
                savedToDb = true;
            }
            catch
            {
                await _queue.EnqueuePunchAsync(punch);
            }

            _state.SetLastPunch(punch);

            var nowClockedIn = punch.PunchType == PunchType.In;
            IsClockedIn    = nowClockedIn;
            ClockStatus    = nowClockedIn ? "Clocked In" : "Clocked Out";
            LastPunchTime  = punch.LocalDateTime.ToString("ddd, dd MMM yyyy HH:mm");

            if (savedToDb)
            {
                var today = DateOnly.FromDateTime(DateTime.Today);
                var fresh = await _storage.GetMyPunchesAsync(
                    employee.CompanyId, employee.Id, today.AddDays(-30), today);
                _allMyPunches = fresh;
                await BackfillAddressesAsync(fresh);
                RecentPunches = new ObservableCollection<TimePunch>(fresh.TakeLast(5));
            }
            else
            {
                _allMyPunches = _allMyPunches.Append(punch).ToList();
                var optimistic = RecentPunches.ToList();
                optimistic.Add(punch);
                RecentPunches = new ObservableCollection<TimePunch>(optimistic.TakeLast(5));
            }
            RebuildSessions();
            await RefreshBranchGeofenceStatusAsync();

            await Shell.Current.DisplayAlert(
                nowClockedIn ? "Clocked In ✓" : "Clocked Out ✓",
                nowClockedIn ? "You're now clocked in. Have a great shift!" : "You're clocked out. See you next time!",
                "OK");
        });
    }

    [RelayCommand]
    private async Task GoToMyJobsAsync()
        => await ShellNavigation.GoToAsync(nameof(MyJobsPage));

    [RelayCommand]
    private async Task GoToMyShiftsAsync()
        => await ShellNavigation.GoToAsync(nameof(MyShiftsPage));

    [RelayCommand]
    private async Task GoToMyLeaveAsync()
        => await ShellNavigation.GoToAsync(nameof(MyLeavePage));

    [RelayCommand]
    private async Task GoToIncidentsAsync()
        => await ShellNavigation.GoToAsync(nameof(MyIncidentsPage));

    [RelayCommand]
    private async Task OpenJobCardAsync(Job job)
        => await ShellNavigation.GoToAsync(nameof(JobCardPage),
            new Dictionary<string, object> { ["jobId"] = job.Id.ToString() });

    [RelayCommand]
    private async Task GoToMessagesAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeThreadChatPage));

    [RelayCommand]
    private async Task GoToPaAsync()
        => await ShellNavigation.GoToAsync(nameof(Views.Employee.MyPaSectionPage));

    [RelayCommand]
    private async Task GoToNotificationsAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeNotificationsPage));

    [RelayCommand]
    private async Task GoToPaperlessAsync()
        => await ShellNavigation.GoToAsync(nameof(PaperlessPage));

    [RelayCommand]
    private async Task GoToContractorAdminAsync()
        => await ShellNavigation.GoToAsync(nameof(EmployeeContractorAdminPage));

    [RelayCommand]
    private async Task GoToMyPayslipsAsync()
        => await ShellNavigation.GoToAsync(nameof(MyPayslipsPage));

    [RelayCommand]
    private async Task GoToMyDocumentsAsync()
        => await ShellNavigation.GoToAsync(nameof(MyDocumentsPage));

    [RelayCommand]
    private async Task GoToMyProfileAsync()
    {
        try
        {
            await ShellNavigation.GoToAsync(nameof(MyProfilePage));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"GoToMyProfile failed: {ex}");
            await Shell.Current.DisplayAlert("Error", "Could not open My Profile. Please try again.", "OK");
        }
    }

    [RelayCommand]
    private async Task ReportAbsenceAsync()
    {
        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        var action = await Shell.Current.DisplayActionSheet(
            "Report Absence", "Cancel", null,
            "Sick", "Personal", "Emergency", "Other");
        if (action == null || action == "Cancel") return;

        var note = await Shell.Current.DisplayPromptAsync(
            "Report Absence", "Add a note (optional):", "Submit", "Skip", "");

        await RunAsync(async () =>
        {
            var absence = new DailyAbsence
            {
                CompanyId  = employee.CompanyId,
                EmployeeId = employee.Id,
                Date       = DateOnly.FromDateTime(DateTime.Today),
                Reason     = action.ToLower(),
                Note       = string.IsNullOrWhiteSpace(note) ? null : note.Trim()
            };
            await _storage.ReportAbsenceAsync(absence);
            IsAbsentToday = true;
            AbsenceReason = action;
        });
    }

    [RelayCommand]
    private async Task GoToCompaniesAsync()
        => await EmployeeAccountRouting.GoToCompanyPickerAsync();

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _storage.SignOutAsync();
        _state.SuppressAutoLogin = true;
        _state.Clear();
        await EmployeeAccountRouting.GoToLoginAsync();
    }
}
