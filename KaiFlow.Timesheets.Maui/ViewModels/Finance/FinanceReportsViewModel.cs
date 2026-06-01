using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class FinanceReportsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;
    private readonly AppTelemetry _telemetry;
    private Guid _companyId;

    public ObservableCollection<FinanceReportType> ReportTypes { get; } = new(FinanceReportType.All);

    [ObservableProperty] private FinanceReportType _selectedType = FinanceReportType.All[0];
    [ObservableProperty] private DateTime _fromDate = new(DateTime.Today.Year, 1, 1);
    [ObservableProperty] private DateTime _toDate = DateTime.Today;

    [ObservableProperty] private FinanceReport? _report;
    [ObservableProperty] private ObservableCollection<FinanceReportLine> _lines = new();
    [ObservableProperty] private bool _hasReport;

    public FinanceReportsViewModel(IStorageService storage, IExportService export, TimesheetStateService state, AppTelemetry telemetry)
    {
        _storage = storage;
        _export = export;
        _state = state;
        _telemetry = telemetry;
        Title = "Financial Reports";
    }

    public async Task LoadAsync()
    {
        _companyId = _state.CurrentEmployee!.CompanyId;
        await GenerateAsync();
    }

    partial void OnSelectedTypeChanged(FinanceReportType value) => _ = GenerateAsync();
    partial void OnFromDateChanged(DateTime value) => _ = GenerateAsync();
    partial void OnToDateChanged(DateTime value) => _ = GenerateAsync();

    [RelayCommand]
    private async Task GenerateAsync()
    {
        if (_companyId == Guid.Empty) return;
        await RunAsync(async () =>
        {
            var report = await _storage.BuildFinanceReportAsync(
                _companyId, SelectedType.Key,
                DateOnly.FromDateTime(FromDate), DateOnly.FromDateTime(ToDate));
            Report = report;
            Lines = new ObservableCollection<FinanceReportLine>(report.Lines);
            HasReport = report.HasRows;
        });
    }

    [RelayCommand]
    private async Task ExportPdfAsync()
    {
        if (Report is null) return;
        var deliver = await _export.AskExportDeliveryAsync(Report.Title);
        if (deliver is null) return;
        await RunAsync(async () =>
        {
            await _export.ExportToPdfAsync(
                $"{Report.FileBaseName}-{DateTime.Now:yyyyMMdd}.pdf",
                $"{Report.Title}  ({Report.PeriodLabel})",
                Report.Headers, Report.ExportRows, deliver.Value);
            _telemetry.LogEvent("finance_report_exported", new() { ["report"] = SelectedType.Key, ["format"] = "pdf" });
        });
    }

    [RelayCommand]
    private async Task ExportExcelAsync()
    {
        if (Report is null) return;
        var deliver = await _export.AskExportDeliveryAsync(Report.Title);
        if (deliver is null) return;
        await RunAsync(async () =>
        {
            await _export.ExportToExcelAsync(
                $"{Report.FileBaseName}-{DateTime.Now:yyyyMMdd}.xlsx",
                Report.Title, Report.Headers, Report.ExportRows, deliver.Value);
            _telemetry.LogEvent("finance_report_exported", new() { ["report"] = SelectedType.Key, ["format"] = "excel" });
        });
    }
}
