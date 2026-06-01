using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Reporting;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Reporting;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrReportsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly IExportHistoryService _exportHistory;
    private readonly IExportQueueService _exportQueue;
    private readonly IReportFilterService _filters;
    private readonly IExecutiveAnalyticsService _executiveAnalytics;
    private readonly IFinancialAnalyticsService _financial;
    private readonly IWorkforceAnalyticsService _workforce;
    private readonly IOperationalAnalyticsService _operational;
    private readonly ITelemetryAnalyticsService _telemetry;
    private readonly IDomainAnalyticsService _domain;
    private readonly IOfflineQueueService _offline;
    private readonly RealtimeService _realtime;
    private readonly TimesheetStateService _state;
    private readonly AppTelemetry _appTelemetry;

    // ─── Filter ────────────────────────────────────────────────────────────────
    [ObservableProperty] private DateTime _fromDate = DateTime.Today.AddDays(-30);
    [ObservableProperty] private DateTime _toDate = DateTime.Today;
    [ObservableProperty] private ObservableCollection<Employee> _employees = [];
    [ObservableProperty] private Employee? _selectedEmployee;
    [ObservableProperty] private ReportFilterPreset? _selectedPreset;

    // ─── Snapshots ─────────────────────────────────────────────────────────────
    [ObservableProperty] private ExecutiveSnapshot _executive = new();
    [ObservableProperty] private FinancialAnalyticsSnapshot _financialSnapshot = new();
    [ObservableProperty] private WorkforceAnalyticsSnapshot _workforceSnapshot = new();
    [ObservableProperty] private OperationalAnalyticsSnapshot _operationalSnapshot = new();
    [ObservableProperty] private TelemetryAnalyticsSnapshot _telemetrySnapshot = new();
    [ObservableProperty] private PayrollAnalyticsSnapshot _payrollSnapshot = new();
    [ObservableProperty] private IncidentsAnalyticsSnapshot _incidentsSnapshot = new();
    [ObservableProperty] private InventoryAnalyticsSnapshot _inventorySnapshot = new();
    [ObservableProperty] private ContractorsAnalyticsSnapshot _contractorsSnapshot = new();
    [ObservableProperty] private PropertyAnalyticsSnapshot _propertySnapshot = new();

    [ObservableProperty] private int _chartRevision;

    // ─── Export centre ─────────────────────────────────────────────────────────
    [ObservableProperty] private ObservableCollection<ExportRecord> _recentExports = [];
    [ObservableProperty] private ObservableCollection<ExportQueueItem> _exportQueueItems = [];

    // ─── Tab navigation ────────────────────────────────────────────────────────
    [ObservableProperty] private string _activeTab = "executive";

    public IReadOnlyList<ReportFilterPreset> FilterPresets => _filters.Presets;
    public IReadOnlyList<ReportFilterPreset> SavedFilterPresets => _filters.SavedPresets;
    public List<string> ReportTypes { get; } = ["attendance", "jobs", "payments", "incidents", "inventory"];
    [ObservableProperty] private string _reportType = "attendance";

    public bool IsExecutiveTab => ActiveTab == "executive";
    public bool IsFinancialTab => ActiveTab == "financial";
    public bool IsPayrollTab => ActiveTab == "payroll";
    public bool IsWorkforceTab => ActiveTab == "workforce";
    public bool IsOperationalTab => ActiveTab == "operational";
    public bool IsIncidentsTab => ActiveTab == "incidents";
    public bool IsInventoryTab => ActiveTab == "inventory";
    public bool IsContractorsTab => ActiveTab == "contractors";
    public bool IsPropertyTab => ActiveTab == "property";
    public bool IsTelemetryTab => ActiveTab == "telemetry";
    public bool IsExportsTab => ActiveTab == "exports";

    public string FilterPeriodLabel => _filters.Current.PeriodLabel;

    public HrReportsViewModel(
        IStorageService storage,
        IExportService export,
        IExportHistoryService exportHistory,
        IExportQueueService exportQueue,
        IReportFilterService filters,
        IExecutiveAnalyticsService executive,
        IFinancialAnalyticsService financial,
        IWorkforceAnalyticsService workforce,
        IOperationalAnalyticsService operational,
        ITelemetryAnalyticsService telemetry,
        IDomainAnalyticsService domain,
        IOfflineQueueService offline,
        RealtimeService realtime,
        TimesheetStateService state,
        AppTelemetry appTelemetry)
    {
        _storage = storage;
        _export = export;
        _exportHistory = exportHistory;
        _exportQueue = exportQueue;
        _filters = filters;
        _executiveAnalytics = executive;
        _financial = financial;
        _workforce = workforce;
        _operational = operational;
        _telemetry = telemetry;
        _domain = domain;
        _offline = offline;
        _realtime = realtime;
        _state = state;
        _appTelemetry = appTelemetry;
        Title = "Reports";
        _filters.FilterChanged += (_, _) => SyncFilterFromService();
    }

    partial void OnActiveTabChanged(string value)
    {
        NotifyTabFlags();
        _ = LoadActiveTabAsync();
    }

    partial void OnFromDateChanged(DateTime value) => SyncFilterToService();
    partial void OnToDateChanged(DateTime value) => SyncFilterToService();
    partial void OnSelectedEmployeeChanged(Employee? value) => SyncFilterToService();

    private void NotifyTabFlags()
    {
        OnPropertyChanged(nameof(IsExecutiveTab));
        OnPropertyChanged(nameof(IsFinancialTab));
        OnPropertyChanged(nameof(IsPayrollTab));
        OnPropertyChanged(nameof(IsWorkforceTab));
        OnPropertyChanged(nameof(IsOperationalTab));
        OnPropertyChanged(nameof(IsIncidentsTab));
        OnPropertyChanged(nameof(IsInventoryTab));
        OnPropertyChanged(nameof(IsContractorsTab));
        OnPropertyChanged(nameof(IsPropertyTab));
        OnPropertyChanged(nameof(IsTelemetryTab));
        OnPropertyChanged(nameof(IsExportsTab));
    }

    private ReportFilterCriteria BuildFilter()
    {
        var f = _filters.Current.Clone();
        f.From = DateOnly.FromDateTime(FromDate);
        f.To = DateOnly.FromDateTime(ToDate);
        f.EmployeeId = SelectedEmployee?.Id;
        return f;
    }

    private void SyncFilterFromService()
    {
        FromDate = _filters.Current.From.ToDateTime(TimeOnly.MinValue);
        ToDate = _filters.Current.To.ToDateTime(TimeOnly.MinValue);
        OnPropertyChanged(nameof(FilterPeriodLabel));
    }

    private void SyncFilterToService()
    {
        _filters.UpdateCriteria(c =>
        {
            c.From = DateOnly.FromDateTime(FromDate);
            c.To = DateOnly.FromDateTime(ToDate);
            c.EmployeeId = SelectedEmployee?.Id;
        });
        OnPropertyChanged(nameof(FilterPeriodLabel));
    }

    [RelayCommand]
    private void SelectTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private void ApplyDatePreset(string presetId)
    {
        var preset = FilterPresets.FirstOrDefault(p => p.Id == presetId)
            ?? SavedFilterPresets.FirstOrDefault(p => p.Id == presetId);
        if (preset is null) return;
        SelectedPreset = preset;
        _filters.ApplyPreset(preset);
        FromDate = preset.Criteria.From.ToDateTime(TimeOnly.MinValue);
        ToDate = preset.Criteria.To.ToDateTime(TimeOnly.MinValue);
        _ = LoadActiveTabAsync();
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadActiveTabAsync();

    public async Task LoadAsync()
    {
        await _filters.LoadAsync();
        await _exportQueue.LoadAsync();
        SyncFilterFromService();
        FromDate = _filters.Current.From.ToDateTime(TimeOnly.MinValue);
        ToDate = _filters.Current.To.ToDateTime(TimeOnly.MinValue);

        await RunAsync(async () =>
        {
            var emps = await _storage.GetEmployeesAsync(_state.CurrentEmployee!.CompanyId);
            Employees = new ObservableCollection<Employee>(emps.OrderBy(e => e.FullName));
        });

        await _exportHistory.LoadAsync();
        RefreshExportHistory();
        RefreshExportQueue();
        await LoadActiveTabAsync();
    }

    private async Task LoadActiveTabAsync()
    {
        var companyId = _state.CurrentEmployee?.CompanyId;
        if (companyId is null) return;

        var filter = BuildFilter();
        var offlineCount = _offline.QueuedCount + _offline.QueuedIncidentCount;
        var realtimeStatus = _realtime.StatusLabel;

        try
        {
            switch (ActiveTab)
            {
                case "executive":
                    Executive = await _executiveAnalytics.BuildAsync(companyId.Value, filter, offlineCount, realtimeStatus);
                    break;
                case "financial":
                    FinancialSnapshot = await _financial.BuildAsync(companyId.Value, filter);
                    break;
                case "payroll":
                    PayrollSnapshot = await _domain.BuildPayrollAsync(companyId.Value, filter);
                    break;
                case "workforce":
                    WorkforceSnapshot = await _workforce.BuildAsync(companyId.Value, filter);
                    break;
                case "operational":
                    OperationalSnapshot = await _operational.BuildAsync(companyId.Value, filter);
                    break;
                case "incidents":
                    IncidentsSnapshot = await _domain.BuildIncidentsAsync(companyId.Value, filter);
                    break;
                case "inventory":
                    InventorySnapshot = await _domain.BuildInventoryAsync(companyId.Value, filter);
                    break;
                case "contractors":
                    ContractorsSnapshot = await _domain.BuildContractorsAsync(companyId.Value, filter);
                    break;
                case "property":
                    PropertySnapshot = await _domain.BuildPropertyAsync(companyId.Value, filter);
                    break;
                case "telemetry":
                    TelemetrySnapshot = await _telemetry.BuildAsync(companyId.Value, filter);
                    break;
            }
        }
        catch (Exception ex)
        {
            _appTelemetry.LogWarning("reports_tab_load_failed", ActiveTab,
                new Dictionary<string, string> { ["error"] = ex.Message });
        }

        ChartRevision++;
    }

    private void RefreshExportHistory() =>
        RecentExports = new ObservableCollection<ExportRecord>(_exportHistory.Recent.Take(20));

    private void RefreshExportQueue() =>
        ExportQueueItems = new ObservableCollection<ExportQueueItem>(_exportQueue.Items.Take(15));

    [RelayCommand]
    private async Task ClearExportHistoryAsync()
    {
        var ok = await Shell.Current.DisplayAlert("Clear export history", "Remove all entries from this device?", "Clear", "Cancel");
        if (!ok) return;
        await _exportHistory.ClearAsync();
        RefreshExportHistory();
    }

    [RelayCommand]
    private async Task ExportAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var from = DateOnly.FromDateTime(FromDate);
            var to = DateOnly.FromDateTime(ToDate);
            var employeeId = SelectedEmployee?.Id;
            var fileName = $"{ReportType}_report.csv";
            _exportQueue.Enqueue(fileName, "csv", $"reports:{ReportType}");

            switch (ReportType)
            {
                case "attendance":
                    var employees = await _storage.GetEmployeesAsync(companyId);
                    var nameMap = employees.ToDictionary(e => e.Id, e => e.FullName);
                    var punches = await _storage.GetPunchesAsync(companyId, from, to, employeeId);
                    await _export.ExportToCsvAsync(fileName,
                        ["Employee", "Type", "Date/Time", "Address", "Latitude", "Longitude"],
                        punches.Select(p => new[]
                        {
                            nameMap.GetValueOrDefault(p.EmployeeId, p.EmployeeId.ToString()),
                            p.TypeRaw,
                            p.DateTime.ToString("yyyy-MM-dd HH:mm"),
                            p.Address ?? "",
                            p.Latitude?.ToString("F6") ?? "",
                            p.Longitude?.ToString("F6") ?? ""
                        }),
                        $"reports:{ReportType}");
                    break;

                case "jobs":
                    var clients = await _storage.GetClientsAsync(companyId);
                    var clientMap = clients.ToDictionary(c => c.Id, c => c.Name);
                    var jobs = await _storage.GetJobsAsync(companyId);
                    await _export.ExportToCsvAsync("jobs_report.csv",
                        ["Title", "Status", "Priority", "Client", "Estimated Cost", "Actual Cost", "Created"],
                        jobs.Select(j => new[]
                        {
                            j.Title, j.StatusRaw, j.PriorityRaw,
                            j.ClientId.HasValue ? clientMap.GetValueOrDefault(j.ClientId.Value, "") : "",
                            j.EstimatedCost.ToString("F2"), j.ActualCost.ToString("F2"),
                            j.CreatedAt.ToString("yyyy-MM-dd")
                        }),
                        $"reports:{ReportType}");
                    break;

                case "payments":
                    var payEmployees = await _storage.GetEmployeesAsync(companyId);
                    var payNameMap = payEmployees.ToDictionary(e => e.Id, e => e.FullName);
                    var payments = await _storage.GetPaymentsAsync(companyId);
                    if (employeeId.HasValue)
                        payments = payments.Where(p => p.EmployeeId == employeeId.Value).ToList();
                    await _export.ExportToCsvAsync("payments_report.csv",
                        ["Employee", "Period Start", "Period End", "Regular Hrs", "OT Hrs", "Gross Pay", "Net Pay", "Status"],
                        payments.Select(p => new[]
                        {
                            payNameMap.GetValueOrDefault(p.EmployeeId, p.EmployeeId.ToString()),
                            p.PeriodStart.ToString(), p.PeriodEnd.ToString(),
                            p.RegularHours.ToString("F2"), p.OvertimeHours.ToString("F2"),
                            p.GrossPay.ToString("F2"), p.NetPay.ToString("F2"), p.StatusRaw
                        }),
                        $"reports:{ReportType}");
                    break;

                case "incidents":
                    var incEmployees = await _storage.GetEmployeesAsync(companyId);
                    var incNameMap = incEmployees.ToDictionary(e => e.Id, e => e.FullName);
                    var incidents = await _storage.GetIncidentsAsync(companyId);
                    if (employeeId.HasValue)
                        incidents = incidents.Where(i => i.EmployeeId == employeeId.Value).ToList();
                    await _export.ExportToCsvAsync("incidents_report.csv",
                        ["Employee", "Severity", "Description", "Status", "Date"],
                        incidents.Select(i => new[]
                        {
                            i.EmployeeId.HasValue
                                ? incNameMap.GetValueOrDefault(i.EmployeeId.Value, i.EmployeeId.Value.ToString())
                                : (i.ReportedByName ?? "Contractor"),
                            i.SeverityRaw, i.Description,
                            i.IsClosed ? "Closed" : "Open",
                            i.CreatedAt.ToString("yyyy-MM-dd")
                        }),
                        $"reports:{ReportType}");
                    break;

                case "inventory":
                    var items = await _storage.GetInventoryItemsAsync(companyId);
                    await _export.ExportToCsvAsync("inventory_report.csv",
                        ["Name", "SKU", "Quantity", "Unit Cost", "Total Value"],
                        items.Select(i => new[]
                        {
                            i.Name, i.Sku ?? "",
                            i.QuantityOnHand.ToString("F2"),
                            i.UnitCost.ToString("F2"),
                            (i.QuantityOnHand * i.UnitCost).ToString("F2")
                        }),
                        $"reports:{ReportType}");
                    break;
            }

            _appTelemetry.LogEvent("report_csv_exported", new() { ["type"] = ReportType });
            RefreshExportHistory();
            RefreshExportQueue();
        });
    }

    [RelayCommand]
    private async Task ExportFinancePdfAsync()
    {
        var report = FinancialSnapshot.ProfitAndLoss;
        if (report is null || !report.HasRows) return;
        var deliver = await _export.AskExportDeliveryAsync(report.Title);
        if (deliver is null) return;
        await RunAsync(async () =>
        {
            _exportQueue.Enqueue($"{report.FileBaseName}.pdf", "pdf", "reports:financial");
            await _export.ExportToPdfAsync(
                $"{report.FileBaseName}-{DateTime.Now:yyyyMMdd}.pdf",
                $"{report.Title} ({report.PeriodLabel})",
                report.Headers, report.ExportRows, deliver.Value);
            RefreshExportHistory();
            RefreshExportQueue();
        });
    }
}
