using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class FinanceDashboardViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private FinanceDashboardSnapshot _snapshot = new();
    [ObservableProperty] private string _selectedPeriodKey = "6m";
    [ObservableProperty] private bool _hasData;

    public FinanceDashboardViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Finance";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var (start, end) = ResolveWindow(SelectedPeriodKey);
            Snapshot = await _storage.GetFinanceDashboardSnapshotAsync(companyId, start, end);
            HasData = Snapshot.RevenueThisPeriod != 0
                      || Snapshot.OutstandingInvoices != 0
                      || Snapshot.TotalPayables != 0
                      || Snapshot.MoneyIn != 0 || Snapshot.MoneyOut != 0;
        });
    }

    partial void OnSelectedPeriodKeyChanged(string value) => _ = LoadAsync();

    private static (DateOnly Start, DateOnly End) ResolveWindow(string key)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        return key switch
        {
            "month" => (monthStart, today),
            "3m" => (monthStart.AddMonths(-2), today),
            "year" => (new DateOnly(today.Year, 1, 1), today),
            _ => (monthStart.AddMonths(-5), today) // "6m"
        };
    }

    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();
    [RelayCommand] private void SelectPeriod(string key) => SelectedPeriodKey = key;

    [RelayCommand] private async Task OpenInvoicesAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.Invoices);
    [RelayCommand] private async Task OpenSupplierInvoicesAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.SupplierInvoices);
    [RelayCommand] private async Task OpenContractorPayoutsAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.ContractorPayouts);
    [RelayCommand] private async Task OpenVatAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.Vat);
    [RelayCommand] private async Task OpenCashflowAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.Cashflow);
    [RelayCommand] private async Task OpenReportsAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.Reports);
    [RelayCommand] private async Task OpenApprovalsAsync() => await ShellNavigation.GoToAsync(FinanceRoutes.Approvals);
    [RelayCommand] private async Task NewInvoiceAsync()
        => await ShellNavigation.GoToAsync($"{FinanceRoutes.InvoiceDetail}?InvoiceId=new");
}
