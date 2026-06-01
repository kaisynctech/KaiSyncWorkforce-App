using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models.Platform;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Platform;

public partial class PlatformDashboardViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IFeatureAccessService _features;
    private readonly IPlatformSupportService _support;
    private readonly IBillingCalculationService _billing;
    private readonly IFeedbackService _feedback;
    private readonly IPlatformReportingService _reporting;
    private readonly IExportService _export;
    private readonly IPlatformObservabilityService _observability;
    private readonly AppTelemetry _telemetry;

    [ObservableProperty] private string _activeTab = "overview";
    [ObservableProperty] private PlatformAdminDashboard _dashboard = new();
    [ObservableProperty] private PlatformKpiSnapshot _kpis = new();
    [ObservableProperty] private ObservableCollection<PlatformCompanySummary> _companies = [];
    [ObservableProperty] private ObservableCollection<SaasPlatformAuditEntry> _auditLog = [];
    [ObservableProperty] private ObservableCollection<PlatformFeedback> _feedbackItems = [];
    [ObservableProperty] private PlatformFeedbackStats _feedbackStats = new();
    [ObservableProperty] private PlatformCompanySummary? _selectedCompany;
    [ObservableProperty] private TenantHealthScore? _selectedHealth;
    [ObservableProperty] private CompanySubscriptionBilling? _selectedBilling;
    [ObservableProperty] private string _companySearch = "";
    [ObservableProperty] private string _supportNoteText = "";

    public bool IsOverviewTab => ActiveTab == "overview";
    public bool IsCompaniesTab => ActiveTab == "companies";
    public bool IsSubscriptionsTab => ActiveTab == "subscriptions";
    public bool IsFeedbackTab => ActiveTab == "feedback";
    public bool IsHealthTab => ActiveTab == "health";
    public bool IsReportsTab => ActiveTab == "reports";
    public bool IsSupportTab => ActiveTab == "support";
    public bool IsAuditTab => ActiveTab == "audit";

    public PlatformAdminKpis AdminKpis => Dashboard.Kpis;

    public PlatformDashboardViewModel(
        IStorageService storage,
        IFeatureAccessService features,
        IPlatformSupportService support,
        IBillingCalculationService billing,
        IFeedbackService feedback,
        IPlatformReportingService reporting,
        IExportService export,
        IPlatformObservabilityService observability,
        AppTelemetry telemetry)
    {
        _storage = storage;
        _features = features;
        _support = support;
        _billing = billing;
        _feedback = feedback;
        _reporting = reporting;
        _export = export;
        _observability = observability;
        _telemetry = telemetry;
        Title = "Platform Administration";
    }

    partial void OnActiveTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsOverviewTab));
        OnPropertyChanged(nameof(IsCompaniesTab));
        OnPropertyChanged(nameof(IsSubscriptionsTab));
        OnPropertyChanged(nameof(IsFeedbackTab));
        OnPropertyChanged(nameof(IsHealthTab));
        OnPropertyChanged(nameof(IsReportsTab));
        OnPropertyChanged(nameof(IsSupportTab));
        OnPropertyChanged(nameof(IsAuditTab));
    }

    partial void OnCompanySearchChanged(string value) => _ = SearchCompaniesAsync();

    [RelayCommand]
    private void SelectTab(string tab) => ActiveTab = tab;

    public async Task LoadAsync()
    {
        if (!await _features.IsPlatformAdminAsync())
        {
            ErrorMessage = "Platform admin access required.";
            return;
        }

        await RunAsync(async () =>
        {
            Dashboard = await _storage.GetPlatformAdminDashboardAsync();
            Kpis = await _storage.GetPlatformKpiSnapshotAsync();
            Companies = new ObservableCollection<PlatformCompanySummary>(
                await _storage.PlatformSearchCompaniesAsync(CompanySearch, 200, 0));
            AuditLog = new ObservableCollection<SaasPlatformAuditEntry>(
                await _storage.GetPlatformAuditLogAsync(50));
            FeedbackItems = new ObservableCollection<PlatformFeedback>(
                await _feedback.GetPlatformFeedbackAsync());
            FeedbackStats = await _feedback.GetFeedbackStatsAsync();
            _observability.TrackPlatformAction("platform_admin_dashboard_loaded");
        });
    }

    private async Task SearchCompaniesAsync()
    {
        if (!await _features.IsPlatformAdminAsync()) return;
        try
        {
            var list = await _storage.PlatformSearchCompaniesAsync(CompanySearch, 200, 0);
            Companies = new ObservableCollection<PlatformCompanySummary>(list);
        }
        catch { /* non-critical */ }
    }

    partial void OnSelectedCompanyChanged(PlatformCompanySummary? value)
    {
        if (value is null)
        {
            SelectedHealth = null;
            SelectedBilling = null;
            return;
        }
        _ = LoadCompanyDetailAsync(value.Id);
    }

    private async Task LoadCompanyDetailAsync(Guid companyId)
    {
        try
        {
            SelectedHealth = await _support.ComputeHealthScoreAsync(companyId);
            SelectedBilling = await _billing.RefreshCompanySubscriptionAsync(companyId);
        }
        catch
        {
            SelectedHealth = null;
            SelectedBilling = null;
        }
    }

    [RelayCommand]
    private async Task SuspendCompanyAsync(PlatformCompanySummary? company)
    {
        if (company is null) return;
        await RunAsync(async () =>
        {
            await _storage.PlatformSetSubscriptionStatusAsync(company.Id, "suspended", "Suspended from platform console");
            _telemetry.LogEvent("company_suspended", new() { ["company_id"] = company.Id.ToString() });
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ActivateCompanyAsync(PlatformCompanySummary? company)
    {
        if (company is null) return;
        await RunAsync(async () =>
        {
            await _storage.PlatformSetSubscriptionStatusAsync(company.Id, "active", "Activated from platform console");
            _telemetry.LogEvent("company_reactivated", new() { ["company_id"] = company.Id.ToString() });
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task RefreshBillingAsync(PlatformCompanySummary? company)
    {
        if (company is null) return;
        await RunAsync(async () =>
        {
            await _billing.RefreshCompanySubscriptionAsync(company.Id);
            await LoadAsync();
            if (SelectedCompany?.Id == company.Id)
                await LoadCompanyDetailAsync(company.Id);
        });
    }

    [RelayCommand]
    private async Task MarkFeedbackPlannedAsync(PlatformFeedback? item)
    {
        if (item is null) return;
        await RunAsync(async () =>
        {
            await _feedback.UpdateFeedbackStatusAsync(item.Id, "Planned");
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task MarkFeedbackCompletedAsync(PlatformFeedback? item)
    {
        if (item is null) return;
        var version = await Shell.Current.DisplayPromptAsync("Release link", "App version (optional):", "Save", "Skip", AppInfo.Current.VersionString);
        await RunAsync(async () =>
        {
            await _feedback.UpdateFeedbackStatusAsync(item.Id, "Completed", releaseVersion: version);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task AddSupportNoteAsync()
    {
        if (SelectedCompany is null || string.IsNullOrWhiteSpace(SupportNoteText)) return;
        await RunAsync(async () =>
        {
            await _support.AddSupportNoteAsync(SelectedCompany.Id, SupportNoteText.Trim());
            SupportNoteText = "";
        });
    }

    [RelayCommand]
    private async Task ExportReportExcelAsync()
    {
        await RunAsync(async () =>
        {
            var snap = await _reporting.BuildSnapshotAsync();
            await _reporting.ExportExcelAsync(_export, snap);
        });
    }

    [RelayCommand]
    private async Task ExportReportPdfAsync()
    {
        await RunAsync(async () =>
        {
            var snap = await _reporting.BuildSnapshotAsync();
            await _reporting.ExportPdfAsync(_export, snap);
        });
    }

    [RelayCommand]
    private async Task EnableAdvancedReportingAsync(PlatformCompanySummary? company)
    {
        if (company is null) return;
        await RunAsync(async () =>
        {
            await _storage.PlatformSetCompanyFeatureAsync(
                company.Id, SaasFeatureCodes.AdvancedReporting, true,
                DateTime.UtcNow.AddMonths(1), "Platform admin grant");
            _telemetry.LogEvent("platform_feature_grant", new()
            {
                ["company_id"] = company.Id.ToString(),
                ["feature"] = SaasFeatureCodes.AdvancedReporting,
            });
        });
    }

    [RelayCommand]
    private async Task ExitToHrAsync() => await ShellNavigation.GoToAsync("//HrDashboard");
}
