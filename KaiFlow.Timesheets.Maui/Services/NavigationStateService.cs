using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Services.Platform;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Singleton: owns sidebar mode, active module, badge counts, nav-visibility flags,
/// and navigation commands used by SidebarView across all top-level module pages.
///
/// HrDashboardViewModel populates visibility flags and badge counts during LoadAsync /
/// ResumeAsync. Each module page sets ActiveModule when it appears.
/// </summary>
public partial class NavigationStateService : ObservableObject
{
    private const string SidebarModePrefKey = "hr_sidebar_mode";
    private readonly IFeatureAccessService _features;

    public NavigationStateService(IFeatureAccessService features)
    {
        _features = features;
        // Restore persisted sidebar mode immediately so SidebarView renders in
        // the correct state on first frame without a layout jump.
        // Safety: never restore Hidden on launch. If the user quit while sidebar
        // was hidden they would have no visible toggle to restore it. Promote
        // Hidden → Collapsed so the icon strip + toggle are always accessible.
        var saved = (SidebarMode)Preferences.Get(SidebarModePrefKey, (int)SidebarMode.Expanded);
        SidebarMode = saved == SidebarMode.Hidden ? SidebarMode.Collapsed : saved;
    }

    // ── Sidebar mode ─────────────────────────────────────────────────────────

    [ObservableProperty] private SidebarMode _sidebarMode = SidebarMode.Expanded;

    partial void OnSidebarModeChanged(SidebarMode value)
    {
        Preferences.Set(SidebarModePrefKey, (int)value);
        OnPropertyChanged(nameof(IsSidebarTextVisible));
        OnPropertyChanged(nameof(IsSidebarCollapsed));
        OnPropertyChanged(nameof(SidebarWidthRequest));
        OnPropertyChanged(nameof(SidebarToggleIcon));
        OnPropertyChanged(nameof(SidebarToggleTooltip));
        NotifySectionHeaderText();
    }

    public bool   IsSidebarTextVisible => _sidebarMode == SidebarMode.Expanded;
    public bool   IsSidebarCollapsed   => _sidebarMode == SidebarMode.Collapsed;
    public double SidebarWidthRequest  => _sidebarMode switch
    {
        SidebarMode.Collapsed => 56,
        SidebarMode.Hidden    =>  0,
        _                     => 220,
    };
    public string SidebarToggleIcon => _sidebarMode switch
    {
        SidebarMode.Expanded  => "", // chevron_left  — will collapse
        SidebarMode.Collapsed => "", // chevron_right — will hide
        _                     => "", // menu          — will expand
    };
    public string SidebarToggleTooltip => _sidebarMode switch
    {
        SidebarMode.Expanded  => "Collapse sidebar",
        SidebarMode.Collapsed => "Hide sidebar (focus mode)",
        _                     => "Show sidebar",
    };

    [RelayCommand]
    private void CycleSidebarMode() => SidebarMode = SidebarMode switch
    {
        SidebarMode.Expanded  => SidebarMode.Collapsed,
        SidebarMode.Collapsed => SidebarMode.Hidden,
        _                     => SidebarMode.Expanded,
    };

    // ── Active module ─────────────────────────────────────────────────────────

    [ObservableProperty] private ActiveModule _activeModule = ActiveModule.Overview;

    partial void OnActiveModuleChanged(ActiveModule value) => NotifyActiveStates();

    private void NotifyActiveStates()
    {
        OnPropertyChanged(nameof(IsOverviewActive));
        OnPropertyChanged(nameof(IsMyProfileActive));
        OnPropertyChanged(nameof(IsEmployeesActive));
        OnPropertyChanged(nameof(IsMessagesActive));
        OnPropertyChanged(nameof(IsLeaveActive));
        OnPropertyChanged(nameof(IsAttendanceActive));
        OnPropertyChanged(nameof(IsJobsActive));
        OnPropertyChanged(nameof(IsProjectsActive));
        OnPropertyChanged(nameof(IsPayrollActive));
        OnPropertyChanged(nameof(IsFinanceActive));
        OnPropertyChanged(nameof(IsContractorsActive));
        OnPropertyChanged(nameof(IsClientsActive));
        OnPropertyChanged(nameof(IsInventoryActive));
        OnPropertyChanged(nameof(IsSuppliersActive));
        OnPropertyChanged(nameof(IsAssetsActive));
        OnPropertyChanged(nameof(IsPropertiesActive));
        OnPropertyChanged(nameof(IsIncidentsActive));
        OnPropertyChanged(nameof(IsReportsActive));
        OnPropertyChanged(nameof(IsSchedulingActive));
        OnPropertyChanged(nameof(IsMyPaActive));
        OnPropertyChanged(nameof(IsWorkTeamsActive));
        OnPropertyChanged(nameof(IsNotificationsActive));
        OnPropertyChanged(nameof(IsActivityLogActive));
        OnPropertyChanged(nameof(IsSettingsActive));
    }

    public bool IsOverviewActive      => _activeModule == ActiveModule.Overview;
    public bool IsMyProfileActive     => _activeModule == ActiveModule.MyProfile;
    public bool IsEmployeesActive     => _activeModule == ActiveModule.Employees;
    public bool IsMessagesActive      => _activeModule == ActiveModule.Messages;
    public bool IsLeaveActive         => _activeModule == ActiveModule.Leave;
    public bool IsAttendanceActive    => _activeModule == ActiveModule.Attendance;
    public bool IsJobsActive          => _activeModule == ActiveModule.Jobs;
    public bool IsProjectsActive      => _activeModule == ActiveModule.Projects;
    public bool IsPayrollActive       => _activeModule == ActiveModule.Payroll;
    public bool IsFinanceActive       => _activeModule == ActiveModule.Finance;
    public bool IsContractorsActive   => _activeModule == ActiveModule.Contractors;
    public bool IsClientsActive       => _activeModule == ActiveModule.Clients;
    public bool IsInventoryActive     => _activeModule == ActiveModule.Inventory;
    public bool IsSuppliersActive     => _activeModule == ActiveModule.Suppliers;
    public bool IsAssetsActive        => _activeModule == ActiveModule.Assets;
    public bool IsPropertiesActive    => _activeModule == ActiveModule.Properties;
    public bool IsIncidentsActive     => _activeModule == ActiveModule.Incidents;
    public bool IsReportsActive       => _activeModule == ActiveModule.Reports;
    public bool IsSchedulingActive    => _activeModule == ActiveModule.Scheduling;
    public bool IsMyPaActive          => _activeModule == ActiveModule.MyPa;
    public bool IsWorkTeamsActive     => _activeModule == ActiveModule.WorkTeams;
    public bool IsNotificationsActive => _activeModule == ActiveModule.Notifications;
    public bool IsActivityLogActive   => _activeModule == ActiveModule.ActivityLog;
    public bool IsSettingsActive      => _activeModule == ActiveModule.Settings;

    // ── Badge counts (populated by HrDashboardViewModel) ─────────────────────

    [ObservableProperty] private int _openIncidentCount;
    [ObservableProperty] private int _pendingLeaveCount;
    [ObservableProperty] private int _activeJobCount;
    [ObservableProperty] private int _unreadNotificationCount;
    [ObservableProperty] private int _pendingPaymentCount;
    [ObservableProperty] private int _messageThreadCount;
    [ObservableProperty] private int _projectCount;

    public string UnreadNotificationLabel =>
        UnreadNotificationCount > 0 ? $"Notifications ({UnreadNotificationCount})" : "Notifications";

    partial void OnUnreadNotificationCountChanged(int _)
        => OnPropertyChanged(nameof(UnreadNotificationLabel));

    // ── Nav-visibility flags (populated by HrDashboardViewModel) ─────────────

    [ObservableProperty] private bool _showEmployeesNav;
    [ObservableProperty] private bool _showLeaveNav;
    [ObservableProperty] private bool _showAttendanceNav;
    [ObservableProperty] private bool _showJobsNav;
    [ObservableProperty] private bool _showProjectsNav;
    [ObservableProperty] private bool _showPayrollNav;
    [ObservableProperty] private bool _showFinanceNav;
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
    [ObservableProperty] private bool _showPlatformAdminNav;
    [ObservableProperty] private bool _showPeopleWorkSection;
    [ObservableProperty] private bool _showOperationsSection;
    [ObservableProperty] private bool _showAnalyticsSection;
    [ObservableProperty] private bool _showCommsSection;
    [ObservableProperty] private bool _showAdminSection;
    [ObservableProperty] private bool _isOwner;

    // Section header combined visibility (permission × sidebar text mode)
    partial void OnShowPeopleWorkSectionChanged(bool _) => OnPropertyChanged(nameof(ShowPeopleWorkSectionText));
    partial void OnShowOperationsSectionChanged(bool _) => OnPropertyChanged(nameof(ShowOperationsSectionText));
    partial void OnShowAnalyticsSectionChanged(bool _)  => OnPropertyChanged(nameof(ShowAnalyticsSectionText));
    partial void OnShowCommsSectionChanged(bool _)      => OnPropertyChanged(nameof(ShowCommsSectionText));
    partial void OnShowAdminSectionChanged(bool _)      => OnPropertyChanged(nameof(ShowAdminSectionText));

    public bool ShowPeopleWorkSectionText => _showPeopleWorkSection && IsSidebarTextVisible;
    public bool ShowOperationsSectionText => _showOperationsSection && IsSidebarTextVisible;
    public bool ShowAnalyticsSectionText  => _showAnalyticsSection  && IsSidebarTextVisible;
    public bool ShowCommsSectionText      => _showCommsSection       && IsSidebarTextVisible;
    public bool ShowAdminSectionText      => _showAdminSection       && IsSidebarTextVisible;

    private void NotifySectionHeaderText()
    {
        OnPropertyChanged(nameof(ShowPeopleWorkSectionText));
        OnPropertyChanged(nameof(ShowOperationsSectionText));
        OnPropertyChanged(nameof(ShowAnalyticsSectionText));
        OnPropertyChanged(nameof(ShowCommsSectionText));
        OnPropertyChanged(nameof(ShowAdminSectionText));
    }

    // ── Current employee / company display (populated by HrDashboardViewModel) ─

    [ObservableProperty] private string? _currentEmployeeName;
    [ObservableProperty] private bool    _hasCurrentEmployee;
    [ObservableProperty] private string? _currentCompanyName;
    [ObservableProperty] private string? _currentCompanyCode;
    [ObservableProperty] private bool    _hasCurrentCompany;

    // ── Dashboard tab callback ────────────────────────────────────────────────

    /// <summary>
    /// Registered by HrDashboardPage.OnAppearing, cleared on OnDisappearing.
    /// Allows tab-swap sidebar commands to switch dashboard content in-place
    /// without a Shell navigation round-trip.
    /// </summary>
    public Action<int>? SetDashboardTabCallback { get; set; }

    // ── Navigation helpers ────────────────────────────────────────────────────

    /// <summary>
    /// For tab-swap modules: use the callback when on the dashboard, otherwise
    /// pop back to the dashboard root so OnAppearing can read ActiveModule and
    /// set the correct tab via HrDashboardViewModel.ResumeAsync().
    /// </summary>
    private async Task GoToTabAsync(int tab, ActiveModule module)
    {
        ActiveModule = module;
        if (SetDashboardTabCallback != null)
            SetDashboardTabCallback(tab);
        else
            await ShellNavigation.GoToAsync(AppRoutes.HrDashboard);
    }

    /// <summary>
    /// For shell-navigation modules: if currently inside a pushed page, navigate
    /// to dashboard+module in one step so Back returns to dashboard, not the
    /// previous module page.
    /// </summary>
    private async Task GoToModuleAsync(string pageName, ActiveModule module)
    {
        ActiveModule = module;
        var depth = Shell.Current?.Navigation?.NavigationStack?.Count ?? 0;
        if (depth > 1)
            // Already inside a pushed page — pop to root and push new module atomically
            await ShellNavigation.GoToAsync($"//HrDashboard/{pageName}");
        else
            await ShellNavigation.GoToAsync(pageName);
    }

    // ── Tab-swap module commands ──────────────────────────────────────────────

    [RelayCommand] private Task GoToOverviewAsync()      => GoToTabAsync( 0, ActiveModule.Overview);
    [RelayCommand] private Task GoToMyProfileAsync()     => GoToTabAsync( 1, ActiveModule.MyProfile);
    [RelayCommand] private Task GoToEmployeesAsync()     => GoToTabAsync( 2, ActiveModule.Employees);
    [RelayCommand] private Task GoToMessagesAsync()      => GoToTabAsync(17, ActiveModule.Messages);
    [RelayCommand] private Task GoToLeaveAsync()         => GoToTabAsync(20, ActiveModule.Leave);
    [RelayCommand] private Task GoToAttendanceTabAsync() => GoToTabAsync( 3, ActiveModule.Attendance);
    [RelayCommand] private Task GoToJobsTabAsync()       => GoToTabAsync( 4, ActiveModule.Jobs);
    [RelayCommand] private Task GoToProjectsTabAsync()   => GoToTabAsync(19, ActiveModule.Projects);
    [RelayCommand] private Task GoToPayrollTabAsync()    => GoToTabAsync( 5, ActiveModule.Payroll);
    [RelayCommand] private Task GoToClientsTabAsync()    => GoToTabAsync( 7, ActiveModule.Clients);
    [RelayCommand] private Task GoToMyPaTabAsync()       => GoToTabAsync(22, ActiveModule.MyPa);

    // ── Dashboard workspace tab commands (formerly Shell-push — now tab-swap) ────
    // These modules are now embedded in HrDashboardPage as workspace panels.
    // GoToTabAsync sets ActiveModule and switches the dashboard content area.

    [RelayCommand] private Task GoToContractorsAsync()   => GoToTabAsync( 6, ActiveModule.Contractors);
    [RelayCommand] private Task GoToInventoryAsync()     => GoToTabAsync( 8, ActiveModule.Inventory);
    [RelayCommand] private Task GoToSuppliersAsync()     => GoToTabAsync(21, ActiveModule.Suppliers);
    [RelayCommand] private Task GoToAssetsAsync()        => GoToTabAsync( 9, ActiveModule.Assets);
    [RelayCommand] private Task GoToPropertiesAsync()    => GoToTabAsync(10, ActiveModule.Properties);
    [RelayCommand] private Task GoToIncidentsAsync()     => GoToTabAsync(11, ActiveModule.Incidents);
    [RelayCommand] private Task GoToReportsAsync()       => GoToTabAsync(12, ActiveModule.Reports);
    [RelayCommand] private Task GoToSchedulingAsync()    => GoToTabAsync(13, ActiveModule.Scheduling);
    [RelayCommand] private Task GoToWorkTeamsAsync()     => GoToTabAsync(14, ActiveModule.WorkTeams);
    [RelayCommand] private Task GoToNotificationsAsync() => GoToTabAsync(15, ActiveModule.Notifications);
    [RelayCommand] private Task GoToActivityLogAsync()   => GoToTabAsync(16, ActiveModule.ActivityLog);
    [RelayCommand] private Task GoToSettingsAsync()      => GoToTabAsync(18, ActiveModule.Settings);
    [RelayCommand] private Task GoToPlatformAdminAsync()
        => GoToModuleAsync("PlatformDashboardPage", ActiveModule.PlatformConsole);

    [RelayCommand]
    private async Task GoToFinanceAsync()
    {
        if (!_features.IsFeatureEnabled(SaasFeatureCodes.ModuleFinance))
        {
            await Shell.Current.DisplayAlert("Upgrade required",
                "Finance is not included in your current plan.", "OK");
            return;
        }
        await GoToModuleAsync(ViewModels.Finance.FinanceRoutes.Dashboard, ActiveModule.Finance);
    }

    [RelayCommand]
    private async Task GoBackAsync() => await ShellNavigation.GoBackOrDashboardAsync();
}
