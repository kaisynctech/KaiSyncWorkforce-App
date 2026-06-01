using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.Services.Production;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.ViewModels.Employees;
using KaiFlow.Timesheets.Views.Employee;
using KaiFlow.Timesheets.Views.Hr;
using KaiFlow.Timesheets.Views.Platform;
using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrDashboardViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;
    private readonly IOfflineQueueService _queue;
    private readonly RealtimeService _realtime;
    private readonly AccountNotificationAlertService _notificationAlerts;
    private readonly IBranchGeofenceService _geofence;
    private readonly HrJobsViewModel _workList;
    private readonly IPermissionsService _permissions;
    private readonly IFeatureAccessService _features;
    private readonly IOnboardingService _onboarding;
    private readonly IReleaseManagementService _releases;
    private readonly IUsageMeteringService _usage;
    private readonly IFeatureFlagService _featureFlags;
    private readonly EmployeeScopeService _scope;
    private readonly MyPaSectionViewModel _myPa;
    private readonly HashSet<int> _loadedTabs = new();
    private bool _punchRefreshInFlight;

    private List<Employee> _allEmployees = new();
    private List<Job> _allJobs = new();
    private List<PunchSession> _allAttendanceSessions = new();
    private Dictionary<Guid, EmployeeShiftTemplate> _templateMap = new();
    private List<WorkTeam> _allDashboardTeams = new();

    [ObservableProperty] private ObservableCollection<EmployeeShiftTemplate> _dashboardTemplates = [];
    private List<LeaveRequest> _allDashboardLeave = new();

    // KPI counts
    [ObservableProperty] private int _employeeCount;
    [ObservableProperty] private int _activeJobCount;
    [ObservableProperty] private int _projectCount;
    [ObservableProperty] private int _pendingLeaveCount;
    [ObservableProperty] private int _openIncidentCount;
    [ObservableProperty] private int _pendingPaymentCount;
    [ObservableProperty] private int _unreadNotificationCount;
    public string UnreadNotificationLabel =>
        UnreadNotificationCount > 0 ? $"Notifications ({UnreadNotificationCount})" : "Notifications";
    [ObservableProperty] private int _clockedInCount;

    // Collections
    [ObservableProperty] private ObservableCollection<Employee> _employees = new();
    [ObservableProperty] private ObservableCollection<Job> _jobs = new();
    [ObservableProperty] private ObservableCollection<MessageThread> _threads = new();
    [ObservableProperty] private ObservableCollection<PunchSession> _attendanceSessions = new();
    [ObservableProperty] private ObservableCollection<PaymentDisplay> _payments = new();
    [ObservableProperty] private ObservableCollection<Contractor> _contractors = new();
    [ObservableProperty] private ObservableCollection<Contractor> _suppliers = new();
    [ObservableProperty] private ObservableCollection<Client> _clients = new();
    [ObservableProperty] private string _clientSearchText = "";
    private List<Client> _allClients = [];
    [ObservableProperty] private ObservableCollection<InventoryItem> _inventoryItems = new();
    [ObservableProperty] private ObservableCollection<Asset> _assets = new();
    [ObservableProperty] private ObservableCollection<Site> _sites = new();
    [ObservableProperty] private ObservableCollection<IncidentReport> _incidents = new();
    [ObservableProperty] private ObservableCollection<CalendarEvent> _scheduleEvents = new();
    [ObservableProperty] private ObservableCollection<WorkTeam> _workTeams = new();

    [ObservableProperty] private string _employeeSearch = "";
    [ObservableProperty] private string _jobStatusFilter = "open";
    [ObservableProperty] private string _attendancePeriod = "week";
    [ObservableProperty] private string _attendanceEmployeeSearch = "";
    [ObservableProperty] private int _activeTab = 0;
    [ObservableProperty] private DateTime _customAttendanceFrom = DateTime.Today.AddDays(-7);
    [ObservableProperty] private DateTime _customAttendanceTo = DateTime.Today;

    public bool IsCustomPeriod => AttendancePeriod == "custom";

    // Employees panel sub-tabs and branch filter
    [ObservableProperty] private string _employeesSubTab = "employees";
    [ObservableProperty] private string _dashboardBranchFilter = "all";
    [ObservableProperty] private ObservableCollection<string> _dashboardBranchFilters = new();
    [ObservableProperty] private ObservableCollection<WorkTeam> _dashboardTeams = new();
    [ObservableProperty] private string _dashboardTeamSearch = "";
    [ObservableProperty] private ObservableCollection<LeaveRequestDisplay> _dashboardLeaveRequests = new();
    [ObservableProperty] private string _dashboardLeaveSearch = "";

    // Today's absence summary (Overview card)
    [ObservableProperty] private ObservableCollection<string> _onLeaveTodayNames = new();
    [ObservableProperty] private ObservableCollection<string> _absentTodayNames = new();
    [ObservableProperty] private ObservableCollection<Employee> _notClockedInToday = new();
    [ObservableProperty] private int _onLeaveTodayCount;
    [ObservableProperty] private int _absentTodayCount;
    public bool HasOnLeaveToday      => OnLeaveTodayCount > 0;
    public bool HasAbsentToday       => AbsentTodayCount > 0;
    public bool HasNotClockedInToday => NotClockedInToday.Count > 0;

    partial void OnNotClockedInTodayChanged(ObservableCollection<Employee> value) =>
        OnPropertyChanged(nameof(HasNotClockedInToday));
    public int  MessageThreadCount => Threads.Count;

    partial void OnThreadsChanged(ObservableCollection<MessageThread> value)
        => OnPropertyChanged(nameof(MessageThreadCount));

    // Tab booleans — 0=Overview, 1=MyProfile, 2=Employees, 3=Attendance, 4=Jobs, 5=Payroll,
    // 6=Contractors, 7=Clients, 8=Inventory, 9=Assets, 10=Properties,
    // 11=Incidents, 12=Reports, 13=Scheduling, 14=WorkTeams,
    // 15=Notifications, 16=ActivityLog, 17=Messages, 18=Settings, 19=Projects,
    // 20=Leave, 21=Suppliers, 22=My PA
    public HrJobsViewModel WorkList => _workList;
    public MyPaSectionViewModel MyPa => _myPa;
    public bool IsEmployeesSubTab      => EmployeesSubTab == "employees";
    public bool IsTeamsSubTab          => EmployeesSubTab == "teams";
    public bool IsTemplatesSubTab      => EmployeesSubTab == "templates";

    public bool IsEmployeesSidebarActive => ActiveTab == 2;
    public bool IsLeaveNavActive         => ActiveTab == 20;

    public bool IsOverviewTab      => ActiveTab == 0;
    public bool IsMyProfileTab     => ActiveTab == 1;
    public bool IsEmployeesTab     => ActiveTab == 2;
    public bool IsAttendanceTab    => ActiveTab == 3;
    public bool IsJobsTab          => ActiveTab == 4;
    public bool IsProjectsTab      => ActiveTab == 19;
    public bool IsPayrollTab       => ActiveTab == 5;
    public bool IsContractorsTab   => ActiveTab == 6;
    public bool IsClientsTab       => ActiveTab == 7;
    public bool IsInventoryTab     => ActiveTab == 8;
    public bool IsAssetsTab        => ActiveTab == 9;
    public bool IsPropertiesTab    => ActiveTab == 10;
    public bool IsIncidentsTab     => ActiveTab == 11;
    public bool IsReportsTab       => ActiveTab == 12;
    public bool IsSchedulingTab    => ActiveTab == 13;
    public bool IsWorkTeamsTab     => ActiveTab == 14;
    public bool IsNotificationsTab => ActiveTab == 15;
    public bool IsActivityLogTab   => ActiveTab == 16;
    public bool IsMessagesTab      => ActiveTab == 17;
    public bool IsSettingsTab      => ActiveTab == 18;
    public bool IsLeaveTab         => ActiveTab == 20;
    public bool IsSuppliersTab     => ActiveTab == 21;
    public bool IsMyPaTab          => ActiveTab == 22;

    public double AttendancePercent  => EmployeeCount > 0 ? (double)ClockedInCount / EmployeeCount : 0;
    public double AttendanceTotalHours => AttendanceSessions.Sum(s => s.TotalHours);
    public int    AttendanceSessionCount => AttendanceSessions.Count;
    public string TimeGreeting => DateTime.Now.Hour < 12 ? "Good morning" : DateTime.Now.Hour < 17 ? "Good afternoon" : "Good evening";
    public string TodayDate => DateTime.Now.ToString("dddd, dd MMM yyyy");

    public string ActiveTabTitle => ActiveTab switch
    {
        1  => "My Profile",
        2  => "Employees",
        3  => "Attendance",
        4  => "Jobs",
        19 => "Projects",
        5  => "Payroll",
        6  => "Contractors",
        7  => "Clients",
        8  => "Inventory",
        9  => "Assets",
        10 => "Properties",
        11 => "Incidents",
        12 => "Reports",
        13 => "Scheduling",
        14 => "Work Teams",
        15 => "Notifications",
        16 => "Activity Log",
        17 => "Messages",
        18 => "Settings",
        20 => "Leave",
        21 => "Suppliers",
        22 => "My PA",
        _  => "Dashboard"
    };

    partial void OnActiveTabChanged(int value)
    {
        OnPropertyChanged(nameof(IsOverviewTab));
        OnPropertyChanged(nameof(IsMyProfileTab));
        OnPropertyChanged(nameof(IsEmployeesTab));
        OnPropertyChanged(nameof(IsEmployeesSidebarActive));
        OnPropertyChanged(nameof(IsLeaveNavActive));
        OnPropertyChanged(nameof(IsAttendanceTab));
        OnPropertyChanged(nameof(IsJobsTab));
        OnPropertyChanged(nameof(IsProjectsTab));
        OnPropertyChanged(nameof(IsPayrollTab));
        OnPropertyChanged(nameof(IsContractorsTab));
        OnPropertyChanged(nameof(IsClientsTab));
        OnPropertyChanged(nameof(IsInventoryTab));
        OnPropertyChanged(nameof(IsAssetsTab));
        OnPropertyChanged(nameof(IsPropertiesTab));
        OnPropertyChanged(nameof(IsIncidentsTab));
        OnPropertyChanged(nameof(IsReportsTab));
        OnPropertyChanged(nameof(IsSchedulingTab));
        OnPropertyChanged(nameof(IsWorkTeamsTab));
        OnPropertyChanged(nameof(IsNotificationsTab));
        OnPropertyChanged(nameof(IsActivityLogTab));
        OnPropertyChanged(nameof(IsMessagesTab));
        OnPropertyChanged(nameof(IsSettingsTab));
        OnPropertyChanged(nameof(IsLeaveTab));
        OnPropertyChanged(nameof(IsSuppliersTab));
        OnPropertyChanged(nameof(IsMyPaTab));
        OnPropertyChanged(nameof(ActiveTabTitle));
        if (!IsTabAllowed(value))
        {
            ActiveTab = 0;
            return;
        }
        if (value == 7)
            _ = ReloadClientsAsync();
        else if (value == 4)
            _ = ActivateWorkListTabAsync(jobs: true);
        else if (value == 19)
            _ = ActivateWorkListTabAsync(jobs: false);
        else if (value == 22)
        {
            if (!_myPa.IsHrWorkspace)
                _myPa.HrMode = "true";
            _ = _myPa.LoadAsync();
        }
        else
            _ = LoadTabDataAsync(value);
    }

    private async Task ActivateWorkListTabAsync(bool jobs)
    {
        if (jobs)
            _workList.PrepareAsJobsList();
        else
            _workList.PrepareAsProjectsList();
        await _workList.LoadAsync();
    }

    partial void OnClockedInCountChanged(int value) => OnPropertyChanged(nameof(AttendancePercent));
    partial void OnEmployeeCountChanged(int value) => OnPropertyChanged(nameof(AttendancePercent));

    partial void OnEmployeesSubTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsEmployeesSubTab));
        OnPropertyChanged(nameof(IsTeamsSubTab));
        OnPropertyChanged(nameof(IsTemplatesSubTab));
        OnPropertyChanged(nameof(IsEmployeesSidebarActive));
        if (value == "templates")
            _ = ReloadDashboardTemplatesAsync();
    }

    private async Task ReloadDashboardTemplatesAsync()
    {
        var cId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (!cId.HasValue) return;
        var templates = await _storage.GetShiftTemplatesAsync(cId.Value);
        _templateMap = templates.ToDictionary(t => t.Id, t => t);
        DashboardTemplates = new ObservableCollection<EmployeeShiftTemplate>(templates);
    }

    partial void OnDashboardBranchFilterChanged(string value)
    {
        ApplyEmployeeFilter();
        ApplyDashboardTeamFilter();
        ApplyDashboardLeaveFilter();
    }

    partial void OnDashboardTeamSearchChanged(string value) => ApplyDashboardTeamFilter();
    partial void OnDashboardLeaveSearchChanged(string value) => ApplyDashboardLeaveFilter();

    partial void OnAttendancePeriodChanged(string value)
    {
        OnPropertyChanged(nameof(IsCustomPeriod));
        if (value != "custom")
        {
            _loadedTabs.Remove(3);
            _ = LoadTabDataAsync(3);
        }
    }

    [RelayCommand]
    private async Task ApplyCustomRangeAsync()
    {
        _loadedTabs.Remove(3);
        await LoadTabDataAsync(3);
    }

    [RelayCommand]
    private async Task MarkAbsentAsync(Employee employee)
    {
        var reason = await Shell.Current.DisplayActionSheet(
            $"Mark {employee.Name} as absent",
            "Cancel", null,
            "Sick", "Personal", "Emergency", "Other");
        if (reason == null || reason == "Cancel") return;

        var note = await Shell.Current.DisplayPromptAsync(
            "Absence Note (optional)",
            "Add a note for this absence:",
            "Save", "Skip", placeholder: "e.g. called in sick at 7am");

        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee!.CompanyId;
        var absence = new DailyAbsence
        {
            Id         = Guid.NewGuid(),
            CompanyId  = companyId,
            EmployeeId = employee.Id,
            Date       = DateOnly.FromDateTime(DateTime.Today),
            Reason     = reason.ToLower(),
            Note       = string.IsNullOrWhiteSpace(note) ? null : note
        };

        await RunAsync(async () =>
        {
            await _storage.ReportAbsenceAsync(absence);
            NotClockedInToday.Remove(employee);
            OnPropertyChanged(nameof(HasNotClockedInToday));
            AbsentTodayNames.Add($"{employee.FullName} · {absence.ReasonLabel}");
            AbsentTodayCount++;
            OnPropertyChanged(nameof(HasAbsentToday));
        });
    }

    partial void OnAttendanceEmployeeSearchChanged(string value) => ApplyAttendanceFilter();

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = int.Parse(tab);

    [RelayCommand]
    private void SetAttendancePeriod(string period) => AttendancePeriod = period;

    [RelayCommand]
    private void SetEmployeesSubTab(string tab) => EmployeesSubTab = tab;

    [RelayCommand]
    private void SetDashboardBranchFilter(string filter) => DashboardBranchFilter = filter;

    public Company? CurrentCompany => _state.CurrentCompany;
    public Employee? CurrentEmployee => _state.CurrentEmployee;
    public string MyFullName => _state.CurrentEmployee?.FullName ?? "";
    public string MyEmail    => _state.CurrentEmployee?.Email ?? "";
    public bool IsOwnerOrAdmin => _state.IsOwnerOrAdmin;
    public bool IsOwner => _state.IsOwner;

    public bool IsManager => _state.CurrentEmployee?.AccessLevel == Models.AccessLevel.Manager;
    public string DashboardTitle => IsManager ? "Operations" : "HR Dashboard";
    public bool CanSeePayroll => _permissions.Can(PermissionKeys.PaymentsViewPayroll);
    public bool CanSeeSettings => _permissions.Can(PermissionKeys.SettingsView);
    public bool CanSeeLeaveAdmin => _permissions.Can(PermissionKeys.LeaveViewAll);

    // Module-gated sidebar (company enabled_modules)
    [ObservableProperty] private bool _showEmployeesNav;
    [ObservableProperty] private bool _showLeaveNav;
    [ObservableProperty] private bool _showAttendanceNav;
    [ObservableProperty] private bool _showJobsNav;
    [ObservableProperty] private bool _showProjectsNav;
    [ObservableProperty] private bool _showPayrollNav;
    [ObservableProperty] private bool _showContractorsNav;
    [ObservableProperty] private bool _showClientsNav;
    [ObservableProperty] private bool _showInventoryNav;
    [ObservableProperty] private bool _showSuppliersNav;
    [ObservableProperty] private bool _showAssetsNav;
    [ObservableProperty] private bool _showPropertiesNav;
    [ObservableProperty] private bool _showIncidentsNav;
    [ObservableProperty] private bool _showReportsNav;
    [ObservableProperty] private bool _showSchedulingNav;
    [ObservableProperty] private bool _showMyPaNav;
    [ObservableProperty] private bool _showWorkTeamsNav;
    [ObservableProperty] private bool _showMessagingNav;
    [ObservableProperty] private bool _showSettingsNav;
    [ObservableProperty] private bool _showFinanceNav;
    [ObservableProperty] private bool _showOnboardingPrompt;
    [ObservableProperty] private bool _showSubscriptionBanner;
    [ObservableProperty] private string _subscriptionBannerText = "";

    public bool ShowAdminSection =>
        IsOwnerOrAdmin && ShowSettingsNav && CanSeeSettings;

    public bool ShowPeopleWorkSection =>
        ShowEmployeesNav || ShowLeaveNav || ShowAttendanceNav || ShowJobsNav || ShowProjectsNav;

    public bool ShowOperationsSection =>
        ShowPayrollNav || ShowContractorsNav || ShowClientsNav || ShowInventoryNav
        || ShowSuppliersNav || ShowAssetsNav || ShowPropertiesNav;

    public bool ShowAnalyticsSection =>
        ShowIncidentsNav || ShowReportsNav || ShowSchedulingNav || ShowMyPaNav || ShowWorkTeamsNav;

    public bool ShowCommsSection =>
        ShowMessagingNav || IsOwner;

    // Self-punch (for all HR dashboard users)
    [ObservableProperty] private bool   _amIClockedIn;
    [ObservableProperty] private string _myClockButtonLabel = "Clock In";
    [ObservableProperty] private string _myTodayHoursDisplay = "0h 0m";
    [ObservableProperty] private string _myPunchAddress = "";
    [ObservableProperty] private bool   _isGettingLocation;
    [ObservableProperty] private bool _showPlatformAdminNav;
    [ObservableProperty] private bool   _isSelfPunching;
    private TimePunch? _myLastPunch;
    private double? _myLat;
    private double? _myLng;

    private readonly ILocationService _location;

    public HrDashboardViewModel(
        IStorageService storage, IExportService export, TimesheetStateService state,
        ILocationService location, IOfflineQueueService queue, RealtimeService realtime,
        AccountNotificationAlertService notificationAlerts,
        IBranchGeofenceService geofence, HrJobsViewModel workList,
        IPermissionsService permissions, EmployeeScopeService scope,
        IFeatureAccessService features, IOnboardingService onboarding,
        IReleaseManagementService releases, IUsageMeteringService usage,
        IFeatureFlagService featureFlags,
        MyPaSectionViewModel myPa)
    {
        _storage = storage;
        _export = export;
        _state = state;
        _location = location;
        _queue = queue;
        _realtime = realtime;
        _notificationAlerts = notificationAlerts;
        _geofence = geofence;
        _workList = workList;
        _permissions = permissions;
        _scope = scope;
        _features = features;
        _onboarding = onboarding;
        _releases = releases;
        _usage = usage;
        _featureFlags = featureFlags;
        _myPa = myPa;
        Title = "HR Dashboard";
        _realtime.PunchChanged += OnPunchChanged;
    }

    public void SubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged += OnAccountNotificationChanged;
        _ = _realtime.EnsureAccountSubscriptionAsync();
    }

    public void UnsubscribeAccountRealtime()
    {
        _realtime.AccountNotificationChanged -= OnAccountNotificationChanged;
    }

    public void Dispose()
    {
        _realtime.PunchChanged -= OnPunchChanged;
        UnsubscribeAccountRealtime();
    }

    private async void OnAccountNotificationChanged(object? sender, EventArgs e)
    {
        try
        {
            await _notificationAlerts.OnRealtimeNotificationAsync();
            UnreadNotificationCount = await _notificationAlerts.RefreshUnreadCountAsync();
            OnPropertyChanged(nameof(UnreadNotificationLabel));
        }
        catch { /* non-critical */ }
    }

    public async Task RefreshNotificationBadgeAsync()
    {
        try
        {
            UnreadNotificationCount = await _notificationAlerts.RefreshUnreadCountAsync();
            OnPropertyChanged(nameof(UnreadNotificationLabel));
        }
        catch { /* ignore */ }
    }

    private void OnPunchChanged(object? sender, EventArgs e)
        => MainThread.BeginInvokeOnMainThread(() => _ = HandlePunchChangedAsync());

    private async Task HandlePunchChangedAsync()
    {
        if (_punchRefreshInFlight) return;
        _punchRefreshInFlight = true;
        try
        {
            await RefreshTodayPunchSummaryAsync();
            _loadedTabs.Remove(3);
            if (IsAttendanceTab)
                await LoadTabDataAsync(3);
        }
        catch { /* non-critical refresh */ }
        finally
        {
            _punchRefreshInFlight = false;
        }
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee!.CompanyId;

            if (_state.CurrentCompany == null || _state.CurrentCompany.Id != companyId)
            {
                var company = await _storage.GetCurrentCompanyAsync(companyId);
                if (company != null)
                    _state.SetCompany(company);
            }
            var viewer = _state.CurrentEmployee!;
            await _permissions.RefreshAsync(companyId, viewer);
            await _features.RefreshAsync(companyId);
            await _featureFlags.RefreshAsync(companyId);
            ShowPlatformAdminNav = await _features.IsPlatformAdminAsync();
            ShowOnboardingPrompt = IsOwner
                && !await _onboarding.IsOnboardingCompleteAsync(companyId);
            UpdateSubscriptionBanner();
            await RecordAppVersionAsync(companyId);
            _ = _usage.FlushMonthlySnapshotAsync(companyId);
            Title = DashboardTitle;
            OnPropertyChanged(nameof(DashboardTitle));
            OnPropertyChanged(nameof(CanSeePayroll));
            OnPropertyChanged(nameof(CanSeeSettings));
            OnPropertyChanged(nameof(CanSeeLeaveAdmin));

            RefreshModuleNavigation();
            await RefreshNotificationBadgeAsync();

            var teamList = await _storage.GetWorkTeamsAsync(companyId);
            _allDashboardTeams = _scope.FilterTeams(viewer, teamList, _permissions).ToList();

            var allCompanyEmployees = await _storage.GetEmployeesAsync(companyId);
            _allEmployees = _scope.FilterEmployees(viewer, allCompanyEmployees, teamList, _permissions).ToList();
            EmployeeCount = _allEmployees.Count;

            var templates = await _storage.GetShiftTemplatesAsync(companyId);
            _templateMap = templates.ToDictionary(t => t.Id, t => t);
            DashboardTemplates = new ObservableCollection<EmployeeShiftTemplate>(templates);

            var branches = _allEmployees
                .Where(e => !string.IsNullOrEmpty(e.Branch))
                .Select(e => e.Branch!)
                .Distinct()
                .OrderBy(b => b)
                .ToList();
            DashboardBranchFilters = new ObservableCollection<string>(new[] { "all" }.Concat(branches));

            WorkTeams = new ObservableCollection<WorkTeam>(_allDashboardTeams);
            ApplyDashboardTeamFilter();
            _loadedTabs.Add(14);

            ApplyEmployeeFilter();
            _loadedTabs.Add(2);

            _allJobs = await _storage.GetJobsAsync(companyId);
            ActiveJobCount = _allJobs.Count(j => j.IsOpen);
            var deals = await _storage.GetClientDealsAsync(companyId);
            ProjectCount = deals.Count;
            ApplyJobFilter();
            _loadedTabs.Add(4);

            if (CanSeeLeaveAdmin)
            {
                var leave = await _storage.GetLeaveRequestsAsync(companyId);
                var scopedIds = _allEmployees.Select(e => e.Id).ToHashSet();
                leave = leave.Where(l => scopedIds.Contains(l.EmployeeId)).ToList();
                PendingLeaveCount = leave.Count(l => l.IsPending);
                _allDashboardLeave = leave;
                ApplyDashboardLeaveFilter();
            }
            else
            {
                PendingLeaveCount = 0;
                _allDashboardLeave = [];
            }

            var incidentList = await _storage.GetIncidentsAsync(companyId);
            OpenIncidentCount = incidentList.Count(i => !i.IsClosed);
            Incidents = new ObservableCollection<IncidentReport>(incidentList);
            _loadedTabs.Add(11);

            if (CanSeePayroll)
            {
                var paymentList = await _storage.GetPaymentsAsync(companyId);
                PendingPaymentCount = paymentList.Count(p => p.Status == PaymentStatus.Pending);
                var empNames = _allEmployees.ToDictionary(e => e.Id, e => e.FullName);
                Payments = new ObservableCollection<PaymentDisplay>(
                    paymentList.Select(p => new PaymentDisplay(p, empNames.GetValueOrDefault(p.EmployeeId, "Unknown"))));
                _loadedTabs.Add(5);
            }
            else
            {
                PendingPaymentCount = 0;
                Payments = [];
            }

            var today = DateOnly.FromDateTime(DateTime.Today);
            await RefreshTodayPunchSummaryAsync(companyId, today);

            var employeeId = _state.CurrentEmployee!.Id;
            var threadList = await _storage.GetMessageThreadsAsync(companyId, employeeId);
            Threads = new ObservableCollection<MessageThread>(threadList.Take(20));
            _loadedTabs.Add(17);

            // Self-punch status
            await LoadMySelfPunchStatusAsync(companyId, employeeId);
            RefreshModuleNavigation();
        });
    }

    private void RefreshModuleNavigation()
    {
        var company = CurrentCompany;
        bool PlanModule(string key, bool permissionOk) =>
            permissionOk && _features.CanAccessModule(company, key);

        ShowEmployeesNav = PlanModule(CompanyModules.Employees, _permissions.Can(PermissionKeys.EmployeesView));
        ShowLeaveNav = PlanModule(CompanyModules.Leave, CanSeeLeaveAdmin);
        ShowAttendanceNav = PlanModule(CompanyModules.Attendance,
            _permissions.Can(PermissionKeys.AttendanceViewTeam)
                || _permissions.Can(PermissionKeys.AttendanceViewAll));
        ShowJobsNav = PlanModule(CompanyModules.Ticketing, _permissions.Can(PermissionKeys.JobsView));
        ShowProjectsNav = ShowJobsNav && _permissions.Can(PermissionKeys.ProjectsView);
        ShowPayrollNav = PlanModule(CompanyModules.Payroll, CanSeePayroll);
        ShowFinanceNav = _features.IsFeatureEnabled(SaasFeatureCodes.ModuleFinance)
            && CompanyModules.IsEnabled(company, CompanyModules.Payroll);
        ShowContractorsNav = PlanModule(CompanyModules.Contractors, _permissions.Can(PermissionKeys.ContractorsView));
        ShowClientsNav = PlanModule(CompanyModules.Clients, _permissions.Can(PermissionKeys.ClientsView));
        ShowInventoryNav = PlanModule(CompanyModules.Inventory, _permissions.Can(PermissionKeys.InventoryView));
        ShowSuppliersNav = PlanModule(CompanyModules.Suppliers,
            _permissions.Can(PermissionKeys.SuppliersView) || _permissions.Can(PermissionKeys.InventoryView));
        ShowAssetsNav = PlanModule(CompanyModules.AssetCompliance, true);
        ShowPropertiesNav = PlanModule(CompanyModules.PropertyManagement, true);
        ShowIncidentsNav = CompanyModules.IsIncidentsEnabled(company)
            && _features.CanAccessModule(company, CompanyModules.Incidents);
        ShowReportsNav = PlanModule(CompanyModules.Reports,
            _permissions.Can(PermissionKeys.ReportsViewOperational)
                || _permissions.Can(PermissionKeys.ReportsViewFinancial));
        ShowSchedulingNav = PlanModule(CompanyModules.Scheduling, true);
        ShowMyPaNav = PlanModule(CompanyModules.MyPa, true);
        ShowWorkTeamsNav = ShowEmployeesNav;
        ShowMessagingNav = PlanModule(CompanyModules.Messaging, true);
        ShowSettingsNav = PlanModule(CompanyModules.Settings, CanSeeSettings);

        OnPropertyChanged(nameof(ShowPeopleWorkSection));
        OnPropertyChanged(nameof(ShowOperationsSection));
        OnPropertyChanged(nameof(ShowAnalyticsSection));
        OnPropertyChanged(nameof(ShowCommsSection));
        OnPropertyChanged(nameof(ShowAdminSection));

        if (!IsTabAllowed(ActiveTab))
            ActiveTab = 0;
    }

    private bool IsTabAllowed(int tab) => tab switch
    {
        0 or 1 or 15 => true,
        2 or 14 => ShowEmployeesNav,
        3 => ShowAttendanceNav,
        4 => ShowJobsNav,
        19 => ShowProjectsNav,
        5 => ShowPayrollNav,
        6 => ShowContractorsNav,
        7 => ShowClientsNav,
        8 => ShowInventoryNav,
        21 => ShowSuppliersNav,
        9 => ShowAssetsNav,
        10 => ShowPropertiesNav,
        11 => ShowIncidentsNav,
        12 => ShowReportsNav,
        13 => ShowSchedulingNav,
        20 => ShowLeaveNav,
        22 => ShowMyPaNav,
        16 => IsOwner,
        17 => true,
        18 => ShowAdminSection,
        _ => false,
    };

    private async Task RefreshTodayPunchSummaryAsync()
    {
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee!.CompanyId;
        var today = DateOnly.FromDateTime(DateTime.Today);
        await RefreshTodayPunchSummaryAsync(companyId, today);
    }

    private async Task RefreshTodayPunchSummaryAsync(Guid companyId, DateOnly today)
    {
        var todayPunches = await _storage.GetPunchesAsync(companyId, today, today);
        ClockedInCount = todayPunches
            .GroupBy(p => p.EmployeeId)
            .Count(g => g.OrderBy(p => p.DateTime).Last().PunchType == PunchType.In);

        var empMap = _allEmployees.ToDictionary(e => e.Id, e => e.FullName);
        var onLeaveNames = _allDashboardLeave
            .Where(r => r.IsApproved && r.StartDate <= today && r.EndDate >= today)
            .Select(r => empMap.TryGetValue(r.EmployeeId, out var n) ? n : "Employee")
            .Distinct()
            .OrderBy(n => n)
            .ToList();
        OnLeaveTodayCount = onLeaveNames.Count;
        OnLeaveTodayNames = new ObservableCollection<string>(onLeaveNames);
        OnPropertyChanged(nameof(HasOnLeaveToday));

        var absences = await _storage.GetDailyAbsencesAsync(companyId, today);
        var absentNames = absences
            .Select(a =>
            {
                var name = empMap.TryGetValue(a.EmployeeId, out var n) ? n : "Employee";
                return $"{name} · {a.ReasonLabel}";
            })
            .OrderBy(n => n)
            .ToList();
        AbsentTodayCount = absentNames.Count;
        AbsentTodayNames = new ObservableCollection<string>(absentNames);
        OnPropertyChanged(nameof(HasAbsentToday));

        var punchedTodayIds = todayPunches
            .Select(p => p.EmployeeId)
            .ToHashSet();
        var onLeaveIds = _allDashboardLeave
            .Where(r => r.IsApproved && r.StartDate <= today && r.EndDate >= today)
            .Select(r => r.EmployeeId).ToHashSet();
        var alreadyAbsent = absences.Select(a => a.EmployeeId).ToHashSet();
        var notIn = _allEmployees
            .Where(e => e.IsActive && !punchedTodayIds.Contains(e.Id)
                                   && !onLeaveIds.Contains(e.Id)
                                   && !alreadyAbsent.Contains(e.Id))
            .OrderBy(e => e.FullName)
            .ToList();
        NotClockedInToday = new ObservableCollection<Employee>(notIn);
        OnPropertyChanged(nameof(HasNotClockedInToday));
    }

    private async Task LoadMySelfPunchStatusAsync(Guid companyId, Guid employeeId)
    {
        _myLastPunch = await _storage.GetLastPunchAsync(employeeId);
        AmIClockedIn = _myLastPunch?.PunchType == PunchType.In;
        MyClockButtonLabel = AmIClockedIn ? "Clock Out" : "Clock In";

        // Today's hours
        var today = DateOnly.FromDateTime(DateTime.Today);
        var todayMyPunches = await _storage.GetPunchesAsync(companyId, today, today, employeeId);
        var sessions = PunchSession.Build(todayMyPunches.OrderBy(p => p.DateTime).ToList());
        var totalMinutes = sessions.Where(s => !s.IsOpen).Sum(s => (int)s.Duration.TotalMinutes);
        if (AmIClockedIn && _myLastPunch != null)
            totalMinutes += (int)(DateTime.UtcNow - _myLastPunch.DateTime).TotalMinutes;
        MyTodayHoursDisplay = $"{totalMinutes / 60}h {totalMinutes % 60}m";

        // Get current location in background
        _ = Task.Run(async () =>
        {
            IsGettingLocation = true;
            var pos = await _location.GetCurrentPositionAsync(highAccuracy: false);
            if (pos != null)
            {
                _myLat = pos.Latitude;
                _myLng = pos.Longitude;
                var addr = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude);
                MainThread.BeginInvokeOnMainThread(() => MyPunchAddress = addr ?? "");
            }
            IsGettingLocation = false;
        });
    }

    [RelayCommand]
    private async Task ClockSelfAsync()
    {
        var employee = _state.CurrentEmployee;
        if (employee == null)
        {
            await Shell.Current.DisplayAlert(
                "Cannot Clock In",
                "Your employee profile is not loaded. Please sign in again.",
                "OK");
            return;
        }

        if (IsSelfPunching) return;

        var clockingIn = !AmIClockedIn;
        try
        {
            IsSelfPunching = true;
            ErrorMessage = null;

            if (!_myLat.HasValue || !_myLng.HasValue)
            {
                var pos = await _location.GetCurrentPositionAsync(highAccuracy: true);
                if (pos != null)
                {
                    _myLat = pos.Latitude;
                    _myLng = pos.Longitude;
                    MyPunchAddress = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude) ?? MyPunchAddress;
                }
            }

            if (clockingIn)
            {
                if (await _storage.IsOnLeaveTodayAsync(employee.CompanyId, employee.Id))
                {
                    await MainThread.InvokeOnMainThreadAsync(() =>
                        Shell.Current.DisplayAlert(
                            "On Leave Today",
                            "You are on approved leave today and cannot clock in.",
                            "OK"));
                    return;
                }

                var today = DateOnly.FromDateTime(DateTime.Today);
                var absences = await _storage.GetDailyAbsencesAsync(employee.CompanyId, today, employee.Id);
                if (absences.Count > 0)
                {
                    await MainThread.InvokeOnMainThreadAsync(() =>
                        Shell.Current.DisplayAlert(
                            "Marked Absent",
                            "You are marked absent today and cannot clock in.",
                            "OK"));
                    return;
                }

                var company = _state.CurrentCompany ?? await _storage.GetCurrentCompanyAsync(employee.CompanyId);
                if (company != null)
                {
                    var geofence = await _geofence.ValidateClockInAsync(
                        employee, company, _myLat, _myLng);
                    if (!geofence.IsAllowed)
                    {
                        await MainThread.InvokeOnMainThreadAsync(() =>
                            Shell.Current.DisplayAlert("Cannot Clock In", geofence.BlockReason!, "OK"));
                        return;
                    }
                }
            }

            var punch = new TimePunch
            {
                Id         = Guid.NewGuid(),
                EmployeeId = employee.Id,
                CompanyId  = employee.CompanyId,
                TypeRaw    = clockingIn ? "in" : "out",
                DateTime   = DateTime.UtcNow,
                Latitude   = _myLat,
                Longitude  = _myLng,
                Address    = string.IsNullOrEmpty(MyPunchAddress) ? null : MyPunchAddress,
            };

            var savedOnline = false;
            try
            {
                punch = await _storage.InsertPunchAsync(punch);
                savedOnline = true;
            }
            catch
            {
                await _queue.EnqueuePunchAsync(punch);
            }

            _state.SetLastPunch(punch);
            _myLastPunch = punch;

            var companyId = employee.CompanyId;
            if (savedOnline)
                await LoadMySelfPunchStatusAsync(companyId, employee.Id);
            else
            {
                AmIClockedIn = clockingIn;
                MyClockButtonLabel = AmIClockedIn ? "Clock Out" : "Clock In";
                var today = DateOnly.FromDateTime(DateTime.Today);
                var todayMyPunches = await _storage.GetPunchesAsync(companyId, today, today, employee.Id);
                todayMyPunches.Add(punch);
                var sessions = PunchSession.Build(todayMyPunches.OrderBy(p => p.DateTime).ToList());
                var totalMinutes = sessions.Where(s => !s.IsOpen).Sum(s => (int)s.Duration.TotalMinutes);
                if (AmIClockedIn)
                    totalMinutes += (int)(DateTime.UtcNow - punch.DateTime).TotalMinutes;
                MyTodayHoursDisplay = $"{totalMinutes / 60}h {totalMinutes % 60}m";
            }

            var allToday = await _storage.GetPunchesAsync(companyId, DateOnly.FromDateTime(DateTime.Today), DateOnly.FromDateTime(DateTime.Today));
            ClockedInCount = allToday
                .GroupBy(p => p.EmployeeId)
                .Count(g => g.OrderBy(p => p.DateTime).Last().PunchType == PunchType.In);

            var action = AmIClockedIn ? "Clocked In" : "Clocked Out";
            var locationLine = string.IsNullOrWhiteSpace(MyPunchAddress) ? "" : $"\n📍 {MyPunchAddress}";
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert(action, $"Recorded at {DateTime.Now:HH:mm}{locationLine}", "OK"));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await MainThread.InvokeOnMainThreadAsync(() =>
                Shell.Current.DisplayAlert("Clock Failed", ex.Message, "OK"));
        }
        finally
        {
            IsSelfPunching = false;
        }
    }

    private async Task LoadTabDataAsync(int tab)
    {
        if (_loadedTabs.Contains(tab)) return;
        var cId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (!cId.HasValue) return;
        var companyId = cId.Value;

        await RunAsync(async () =>
        {
            switch (tab)
            {
                case 1:
                    OnPropertyChanged(nameof(MyFullName));
                    OnPropertyChanged(nameof(MyEmail));
                    _loadedTabs.Add(1);
                    break;

                case 3:
                    var (from, to) = GetAttendanceDateRange();
                    var punches = await _storage.GetPunchesAsync(companyId, from, to);
                    await BackfillAddressesAsync(punches);
                    var empMap = _allEmployees.ToDictionary(e => e.Id, e => e);
                    _allAttendanceSessions = BuildAttendanceSessions(punches, empMap);
                    ApplyAttendanceFilter();
                    _loadedTabs.Add(3);
                    break;

                case 6:
                    var contractors = await _storage.GetContractorsAsync(companyId);
                    Contractors = new ObservableCollection<Contractor>(
                        contractors.Where(c => PartnerKinds.IsContractorKind(c.PartnerKindRaw)).Take(8));
                    _loadedTabs.Add(6);
                    break;

                case 7:
                    await ReloadClientsCoreAsync(companyId);
                    _loadedTabs.Add(7);
                    break;

                case 8:
                    var items = await _storage.GetInventoryItemsAsync(companyId);
                    InventoryItems = new ObservableCollection<InventoryItem>(items);
                    _loadedTabs.Add(8);
                    break;

                case 21:
                    var partners = await _storage.GetContractorsAsync(companyId);
                    Suppliers = new ObservableCollection<Contractor>(
                        partners.Where(c => PartnerKinds.IsSupplierKind(c.PartnerKindRaw)).Take(12));
                    _loadedTabs.Add(21);
                    break;

                case 9:
                    var assets = await _storage.GetAssetsAsync(companyId);
                    Assets = new ObservableCollection<Asset>(assets);
                    _loadedTabs.Add(9);
                    break;

                case 10:
                    var sites = await _storage.GetSitesAsync(companyId);
                    Sites = new ObservableCollection<Site>(sites);
                    _loadedTabs.Add(10);
                    break;

                case 13:
                    var evFrom = DateOnly.FromDateTime(DateTime.Today);
                    var evTo = DateOnly.FromDateTime(DateTime.Today.AddDays(30));
                    var events = await _storage.GetCalendarEventsAsync(companyId, evFrom, evTo);
                    ScheduleEvents = new ObservableCollection<CalendarEvent>(events);
                    _loadedTabs.Add(13);
                    break;

                case 14:
                    var teams = await _storage.GetWorkTeamsAsync(companyId);
                    WorkTeams = new ObservableCollection<WorkTeam>(teams);
                    _loadedTabs.Add(14);
                    break;
            }
        });
    }

    private (DateOnly from, DateOnly to) GetAttendanceDateRange() => AttendancePeriod switch
    {
        "today"  => (DateOnly.FromDateTime(DateTime.Today), DateOnly.FromDateTime(DateTime.Today)),
        "month"  => (DateOnly.FromDateTime(DateTime.Today.AddDays(-30)), DateOnly.FromDateTime(DateTime.Today)),
        "all"    => (DateOnly.FromDateTime(DateTime.Today.AddYears(-5)), DateOnly.FromDateTime(DateTime.Today)),
        "custom" => (DateOnly.FromDateTime(CustomAttendanceFrom), DateOnly.FromDateTime(CustomAttendanceTo)),
        _        => (DateOnly.FromDateTime(DateTime.Today.AddDays(-7)), DateOnly.FromDateTime(DateTime.Today)),
    };

    private async Task BackfillAddressesAsync(List<TimePunch> punches)
    {
        foreach (var p in punches.Where(p => string.IsNullOrEmpty(p.Address) && p.Latitude.HasValue))
        {
            var addr = await _location.ReverseGeocodeAsync(p.Latitude!.Value, p.Longitude!.Value);
            if (!string.IsNullOrEmpty(addr))
            {
                p.Address = addr;
                try { await _storage.UpdatePunchAddressAsync(p.Id, addr!); } catch { }
            }
        }
    }

    private List<PunchSession> BuildAttendanceSessions(List<TimePunch> punches, Dictionary<Guid, Employee> employeeMap)
    {
        var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
        int lateMin = settings.TryGetValue("late_threshold_minutes", out var l) && int.TryParse(l?.ToString(), out var li) ? li : 30;
        int otMin   = settings.TryGetValue("ot_start_after_minutes",  out var o) && int.TryParse(o?.ToString(), out var oi) ? oi : 30;
        return PunchSession.Build(punches, employeeMap, _templateMap, lateMin, otMin);
    }

    private void ApplyAttendanceFilter()
    {
        var q = AttendanceEmployeeSearch?.Trim() ?? "";
        var filtered = string.IsNullOrEmpty(q)
            ? _allAttendanceSessions
            : _allAttendanceSessions.Where(s => s.EmployeeName?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false).ToList();
        AttendanceSessions = new ObservableCollection<PunchSession>(filtered);
        OnPropertyChanged(nameof(AttendanceTotalHours));
        OnPropertyChanged(nameof(AttendanceSessionCount));
    }

    partial void OnEmployeeSearchChanged(string value) => ApplyEmployeeFilter();
    partial void OnJobStatusFilterChanged(string value) => ApplyJobFilter();

    private void ApplyEmployeeFilter()
    {
        var q = EmployeeSearch?.Trim() ?? "";
        var filtered = _allEmployees.AsEnumerable();

        if (!string.IsNullOrEmpty(q))
            filtered = filtered.Where(e =>
                (e.FullName?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (e.Position?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false));

        if (!string.IsNullOrEmpty(DashboardBranchFilter) && DashboardBranchFilter != "all")
            filtered = filtered.Where(e =>
                string.Equals(e.Branch, DashboardBranchFilter, StringComparison.OrdinalIgnoreCase));

        Employees = new ObservableCollection<Employee>(filtered);
    }

    private void ApplyDashboardTeamFilter()
    {
        var q = DashboardTeamSearch?.Trim() ?? "";
        var filtered = _allDashboardTeams.AsEnumerable();

        if (!string.IsNullOrEmpty(q))
            filtered = filtered.Where(t => t.Name.Contains(q, StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrEmpty(DashboardBranchFilter) && DashboardBranchFilter != "all")
        {
            var branchEmpIds = _allEmployees
                .Where(e => string.Equals(e.Branch, DashboardBranchFilter, StringComparison.OrdinalIgnoreCase))
                .Select(e => e.Id)
                .ToHashSet();
            filtered = filtered.Where(t => t.MemberIds.Any(id => branchEmpIds.Contains(id)));
        }

        DashboardTeams = new ObservableCollection<WorkTeam>(filtered);
    }

    private void ApplyDashboardLeaveFilter()
    {
        var q = DashboardLeaveSearch?.Trim() ?? "";
        var currentYear = DateTime.Today.Year;

        var pending = _allDashboardLeave.Where(r => r.IsPending);

        if (!string.IsNullOrEmpty(DashboardBranchFilter) && DashboardBranchFilter != "all")
        {
            var branchEmpIds = _allEmployees
                .Where(e => string.Equals(e.Branch, DashboardBranchFilter, StringComparison.OrdinalIgnoreCase))
                .Select(e => e.Id)
                .ToHashSet();
            pending = pending.Where(r => branchEmpIds.Contains(r.EmployeeId));
        }

        var displays = pending
            .OrderBy(r => r.StartDate)
            .Select(req =>
            {
                var emp = _allEmployees.FirstOrDefault(e => e.Id == req.EmployeeId);
                var empName = emp?.FullName ?? "Unknown Employee";

                var policy = LeavePolicy.Types.FirstOrDefault(t =>
                    string.Equals(t.Key, req.LeaveType, StringComparison.OrdinalIgnoreCase));
                var entitlement = policy.AnnualDays;
                var color = policy.Color ?? "#64748B";

                var takenDays = _allDashboardLeave
                    .Where(r => r.EmployeeId == req.EmployeeId
                             && r.LeaveType == req.LeaveType
                             && r.IsApproved
                             && r.StartDate.Year == currentYear)
                    .Sum(r => r.TotalDays);

                return new LeaveRequestDisplay(req, empName, color, entitlement, takenDays);
            })
            .Where(d => string.IsNullOrEmpty(q) ||
                d.EmployeeName.Contains(q, StringComparison.OrdinalIgnoreCase) ||
                d.Request.LeaveType.Contains(q, StringComparison.OrdinalIgnoreCase))
            .ToList();

        DashboardLeaveRequests = new ObservableCollection<LeaveRequestDisplay>(displays);
    }

    [RelayCommand]
    private async Task ApproveLeaveAsync(LeaveRequestDisplay display)
    {
        if (display == null) return;
        var note = await Shell.Current.DisplayPromptAsync(
            "Approve Leave", "Add a note (optional):", "Approve", "Cancel", "");
        if (note == null) return;

        await RunAsync(async () =>
        {
            await _storage.UpdateLeaveStatusAsync(display.Request.Id, "approved",
                string.IsNullOrWhiteSpace(note) ? null : note.Trim());
            var existing = _allDashboardLeave.FirstOrDefault(r => r.Id == display.Request.Id);
            if (existing != null) existing.StatusRaw = "approved";
            PendingLeaveCount = Math.Max(0, PendingLeaveCount - 1);
            ApplyDashboardLeaveFilter();
        });
    }

    [RelayCommand]
    private void GoToLeaveTab()
    {
        if (!ShowLeaveNav) return;
        ActiveTab = 20;
    }

    [RelayCommand]
    private async Task RejectLeaveAsync(LeaveRequestDisplay display)
    {
        if (display == null) return;
        var note = await Shell.Current.DisplayPromptAsync(
            "Reject Leave", "Reason for rejection:", "Reject", "Cancel", "");
        if (note == null) return;

        await RunAsync(async () =>
        {
            await _storage.UpdateLeaveStatusAsync(display.Request.Id, "declined",
                string.IsNullOrWhiteSpace(note) ? "Rejected" : note.Trim());
            var existing = _allDashboardLeave.FirstOrDefault(r => r.Id == display.Request.Id);
            if (existing != null) existing.StatusRaw = "declined";
            PendingLeaveCount = Math.Max(0, PendingLeaveCount - 1);
            ApplyDashboardLeaveFilter();
        });
    }

    private void ApplyJobFilter()
    {
        var filtered = JobStatusFilter switch
        {
            "open" => _allJobs.Where(j => j.IsOpen).ToList(),
            "completed" => _allJobs.Where(j => !j.IsOpen).ToList(),
            _ => _allJobs
        };
        Jobs = new ObservableCollection<Job>(filtered);
    }

    [RelayCommand]
    private void SetJobFilter(string filter) => JobStatusFilter = filter;

    private string AttendancePeriodLabel => AttendancePeriod == "custom"
        ? $"{CustomAttendanceFrom:yyyy-MM-dd}_to_{CustomAttendanceTo:yyyy-MM-dd}"
        : AttendancePeriod;

    private IEnumerable<string[]> AttendanceExportRows => AttendanceSessions.Select(s => new[]
    {
        s.EmployeeName ?? "",
        s.DateDisplay,
        s.TimeInDisplay,
        s.InLocationDisplay,
        s.TimeOutDisplay,
        s.OutLocationDisplay,
        s.RegularHours.ToString("F1"),
        s.OvertimeHours.ToString("F1"),
        s.TotalHrsDisplay,
        s.Notes ?? ""
    });

    private static readonly string[] AttendanceExportHeaders =
        ["Employee", "Date", "Time In", "In Location", "Time Out", "Out Location", "Reg hrs", "OT hrs", "Total hrs", "Notes"];

    [RelayCommand]
    private async Task ExportAttendanceExcelAsync()
    {
        if (!AttendanceSessions.Any()) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Export Excel");
        if (downloadToDevice == null) return;
        var companyName = _state.CurrentCompany?.Name ?? "Company";
        await _export.ExportToExcelAsync(
            $"attendance_{AttendancePeriodLabel}.xlsx",
            "Attendance",
            AttendanceExportHeaders,
            AttendanceExportRows,
            downloadToDevice: downloadToDevice.Value);
    }

    [RelayCommand]
    private async Task ExportAttendancePdfAsync()
    {
        if (!AttendanceSessions.Any()) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Export PDF");
        if (downloadToDevice == null) return;
        var companyName = _state.CurrentCompany?.Name ?? "Company";
        await _export.ExportToPdfAsync(
            $"attendance_{AttendancePeriodLabel}.pdf",
            $"Attendance Report – {companyName}",
            AttendanceExportHeaders,
            AttendanceExportRows,
            downloadToDevice: downloadToDevice.Value);
    }

    [RelayCommand]
    private async Task AddDashboardTemplateAsync()
        => await ShellNavigation.GoToAsync(nameof(HrCreateTimeTemplatePage));

    [RelayCommand]
    private async Task EditDashboardTemplateAsync(EmployeeShiftTemplate template)
    {
        if (template == null) return;
        await ShellNavigation.GoToAsync($"{nameof(HrCreateTimeTemplatePage)}?TemplateId={template.Id}");
    }

    [RelayCommand]
    private async Task DeleteDashboardTemplateAsync(EmployeeShiftTemplate template)
    {
        if (template == null) return;
        var confirm = await Shell.Current.DisplayAlert("Delete Template",
            $"Delete '{template.Name}'? Employees assigned to this template will have no time template.", "Delete", "Cancel");
        if (!confirm) return;
        await RunAsync(async () =>
        {
            await _storage.DeleteShiftTemplateAsync(template.Id, template.CompanyId);
            DashboardTemplates.Remove(template);
            _templateMap.Remove(template.Id);
        });
    }

    [RelayCommand]
    private async Task SetDefaultDashboardTemplateAsync(EmployeeShiftTemplate template)
    {
        if (template == null || template.IsDefault) return;
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (companyId == null) return;
        await RunAsync(async () =>
        {
            await _storage.SetDefaultShiftTemplateAsync(companyId.Value, template.Id);
            await ReloadDashboardTemplatesAsync();
        });
    }

    [RelayCommand] private async Task GoToCreateEmployeeAsync() => await ShellNavigation.GoToAsync(nameof(HrCreateEmployeePage));
    [RelayCommand] private async Task GoToImportEmployeesAsync() => await ShellNavigation.GoToAsync(nameof(HrImportEmployeesPage));
    [RelayCommand] private async Task GoToCreateJobAsync() => await ShellNavigation.GoToAsync(nameof(HrCreateJobPage));

    [RelayCommand]
    private async Task CreateTeamAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync(
            "New Work Team", "Team name:", "Create", "Cancel", "e.g. Morning Shift Team");
        if (string.IsNullOrWhiteSpace(name)) return;

        var desc = await Shell.Current.DisplayPromptAsync(
            "New Work Team", "Description (optional):", "Add", "Skip", "");

        WorkTeam? created = null;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee!.CompanyId;
            var team = new WorkTeam
            {
                Name = name.Trim(),
                Description = string.IsNullOrWhiteSpace(desc) ? null : desc.Trim(),
                CompanyId = companyId,
                IsActive = true
            };
            created = await _storage.CreateWorkTeamAsync(team);
            _allDashboardTeams.Insert(0, created);
            WorkTeams.Insert(0, created);
            ApplyDashboardTeamFilter();
        });

        if (created == null) return;

        var addMembers = await Shell.Current.DisplayAlert(
            "Team Created",
            $"'{created.Name}' is ready. Add employees to this team so you can clock them in together.",
            "Add Members Now",
            "Later");
        if (addMembers)
            await ShellNavigation.GoToAsync($"{nameof(HrTeamPunchPage)}?TeamId={created.Id}");
    }

    [RelayCommand]
    private async Task ViewEmployeeDashboardAsync(Employee? employee)
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
    private async Task ViewTeamAsync(WorkTeam team)
    {
        if (team == null) return;
        await ShellNavigation.GoToAsync(nameof(HrWorkTeamDetailsPage),
            new Dictionary<string, object> { ["TeamId"] = team.Id.ToString() });
    }

    [RelayCommand]
    private async Task ViewJobAsync(Job job)
    {
        if (job == null) return;
        try
        {
            await ShellNavigation.GoToAsync($"{nameof(HrJobDetailsPage)}?JobId={job.Id}");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Jobs", $"Could not open job: {ex.Message}", "OK");
        }
    }

    [RelayCommand]
    private async Task OpenThreadAsync(MessageThread thread)
    {
        var subject = thread.ListTitle;
        await ShellNavigation.GoToAsync(
            $"{nameof(HrSimpleThreadChatPage)}?ThreadId={thread.Id}&ThreadSubject={Uri.EscapeDataString(subject)}");
    }

    [RelayCommand]
    private async Task NewThreadAsync()
    {
        var employee = _state.CurrentEmployee!;
        var companyId = employee.CompanyId;
        var colleagues = await _storage.GetEmployeesAsync(companyId);
        var others = colleagues.Where(e => e.Id != employee.Id).ToList();
        if (!others.Any()) return;

        var names = others.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheet("Message employee", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var target = others.FirstOrDefault(e => e.FullName == chosen);
        if (target == null) return;

        await RunAsync(async () =>
        {
            var thread = new MessageThread
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                Subject = $"{employee.FullName} & {target.FullName}",
                ParticipantIds = [employee.Id, target.Id]
            };
            var created = await _storage.CreateThreadAsync(thread);
            Threads.Insert(0, created);
            await ShellNavigation.GoToAsync(
                $"{nameof(HrSimpleThreadChatPage)}?ThreadId={created.Id}&ThreadSubject={Uri.EscapeDataString(created.Subject ?? "")}");
        });
    }

    [RelayCommand]
    private async Task GoBackAsync()
    {
        _state.SuppressAutoLogin = true;
        await ShellNavigation.GoToAsync("//IdEntry");
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _storage.SignOutAsync();
        _state.Clear();
        await ShellNavigation.GoToAsync("//IdEntry");
    }

    [RelayCommand] private async Task GoToAttendanceAsync() => await ShellNavigation.GoToAsync(nameof(HrAttendancePage));
    [RelayCommand] private async Task GoToPaymentsAsync() => await ShellNavigation.GoToAsync(nameof(HrPaymentsPage));
    [RelayCommand]
    private async Task GoToFinanceAsync()
    {
        if (!_features.IsFeatureEnabled(SaasFeatureCodes.ModuleFinance))
        {
            await Shell.Current.DisplayAlert("Upgrade required", "Finance is not included in your current plan.", "OK");
            return;
        }
        await ShellNavigation.GoToAsync(ViewModels.Finance.FinanceRoutes.Dashboard);
    }

    [RelayCommand]
    private async Task GoToPlatformAdminAsync() => await ShellNavigation.GoToAsync(nameof(PlatformDashboardPage));

    [RelayCommand]
    private async Task GoToOnboardingAsync() => await ShellNavigation.GoToAsync(nameof(TenantOnboardingPage));

    private void UpdateSubscriptionBanner()
    {
        var sub = _features.CurrentSubscription;
        if (sub is null)
        {
            ShowSubscriptionBanner = false;
            SubscriptionBannerText = "";
            return;
        }

        if (!sub.IsActive)
        {
            ShowSubscriptionBanner = true;
            SubscriptionBannerText = $"Subscription {sub.StatusLabel} — some features may be restricted. Contact support.";
            return;
        }

        if (sub.RemainingCapacity <= 2)
        {
            ShowSubscriptionBanner = true;
            SubscriptionBannerText = sub.RemainingCapacity <= 0
                ? $"Employee limit reached ({sub.CurrentEmployeeCount}/{sub.EmployeeLimit}). Upgrade your plan to add more."
                : $"Almost at employee limit ({sub.CurrentEmployeeCount}/{sub.EmployeeLimit}).";
            return;
        }

        if (sub.SubscriptionStatus == "trialing" && sub.TrialEndsAt.HasValue)
        {
            var days = (sub.TrialEndsAt.Value - DateTime.UtcNow).TotalDays;
            if (days <= 14)
            {
                ShowSubscriptionBanner = true;
                SubscriptionBannerText = $"Trial ends {sub.TrialEndsAt.Value:dd MMM yyyy} ({Math.Max(0, (int)days)} days left).";
                return;
            }
        }

        ShowSubscriptionBanner = false;
        SubscriptionBannerText = "";
    }

    private async Task RecordAppVersionAsync(Guid companyId)
    {
        try
        {
            var version = AppInfo.Current.VersionString;
            var platform = DeviceInfo.Current.Platform.ToString();
            await _releases.RecordAppVersionAsync(companyId, version, platform);
        }
        catch { /* non-critical */ }
    }
    [RelayCommand] private async Task GoToTeamPunchAsync() => await ShellNavigation.GoToAsync(nameof(HrTeamPunchPage));
    [RelayCommand] private async Task GoToContractorsAsync() => await ShellNavigation.GoToAsync(nameof(HrContractorsPage));
    [RelayCommand] private async Task GoToClientsAsync() => await ShellNavigation.GoToAsync(nameof(HrClientsPage));

    partial void OnClientSearchTextChanged(string value) => ApplyClientSearch();

    private void ApplyClientSearch()
    {
        var filtered = string.IsNullOrWhiteSpace(ClientSearchText)
            ? _allClients
            : _allClients.Where(c =>
                c.Name.Contains(ClientSearchText, StringComparison.OrdinalIgnoreCase) ||
                (c.ClientCode?.Contains(ClientSearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.ContactPerson?.Contains(ClientSearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Email?.Contains(ClientSearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Phone?.Contains(ClientSearchText, StringComparison.OrdinalIgnoreCase) ?? false))
            .ToList();
        Clients = new ObservableCollection<Client>(filtered);
        OnPropertyChanged(nameof(Clients));
    }

    [RelayCommand]
    private async Task AddClientAsync()
        => await ShellNavigation.GoToAsync(nameof(ClientDetailPage),
            new Dictionary<string, object> { ["ClientId"] = "new" });

    [RelayCommand]
    private async Task OpenClientAsync(Client client)
        => await ShellNavigation.GoToAsync(nameof(ClientDetailPage),
            new Dictionary<string, object> { ["ClientId"] = client.Id.ToString() });

    public async Task ReloadClientsAsync()
    {
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (!companyId.HasValue) return;
        await RunAsync(async () => await ReloadClientsCoreAsync(companyId.Value));
    }

    private async Task ReloadClientsCoreAsync(Guid companyId)
    {
        _allClients = await _storage.GetClientsAsync(companyId);
        ApplyClientSearch();
    }

    [RelayCommand]
    private Task RefreshClientsAsync() => ReloadClientsAsync();
    [RelayCommand] private async Task GoToInventoryAsync() => await ShellNavigation.GoToAsync(nameof(HrInventoryPage));
    [RelayCommand] private async Task GoToSuppliersAsync() => await ShellNavigation.GoToAsync(nameof(HrSuppliersPage));
    [RelayCommand] private async Task GoToAssetsAsync() => await ShellNavigation.GoToAsync(nameof(HrAssetsPage));
    [RelayCommand] private async Task GoToPropertiesAsync() => await ShellNavigation.GoToAsync(nameof(HrPropertiesPage));
    [RelayCommand] private async Task GoToReportsAsync() => await ShellNavigation.GoToAsync(nameof(HrReportsPage));
    [RelayCommand] private async Task GoToSchedulingAsync() => await ShellNavigation.GoToAsync(nameof(HrSchedulingPage));

    [RelayCommand]
    private async Task GoToMyPaAsync()
    {
        if (!ShowMyPaNav) return;
        ActiveTab = 22;
        if (!_myPa.IsHrWorkspace)
            _myPa.HrMode = "true";
        await _myPa.LoadAsync();
    }

    [RelayCommand] private async Task GoToIncidentsAsync() => await ShellNavigation.GoToAsync(nameof(HrIncidentsPage));
    [RelayCommand] private async Task GoToSettingsAsync() => await ShellNavigation.GoToAsync(nameof(HrSettingsPage));
    [RelayCommand] private async Task GoToMyProfileAsync() => await ShellNavigation.GoToAsync(nameof(MyProfilePage));
    [RelayCommand] private async Task GoToMyPayslipsAsync() => await ShellNavigation.GoToAsync(nameof(MyPayslipsPage));
    [RelayCommand] private async Task GoToMyLeaveAsync() => await ShellNavigation.GoToAsync(nameof(MyLeavePage));
    [RelayCommand] private async Task GoToMyDocumentsAsync() => await ShellNavigation.GoToAsync(nameof(MyDocumentsPage));
    [RelayCommand] private async Task GoToActivityLogAsync() => await ShellNavigation.GoToAsync(nameof(HrActivityLogPage));
    [RelayCommand] private async Task GoToNotificationsAsync() => await ShellNavigation.GoToAsync(nameof(HrNotificationsPage));
    [RelayCommand] private async Task GoToWorkTeamsAsync() => await ShellNavigation.GoToAsync(nameof(HrWorkTeamsPage));
}
