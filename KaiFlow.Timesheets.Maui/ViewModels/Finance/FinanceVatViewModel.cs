using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class FinanceVatViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private Guid _companyId;

    [ObservableProperty] private ObservableCollection<FinanceVatPeriod> _periods = [];

    // Current (suggested) period figures
    [ObservableProperty] private DateTime _periodStart = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] private DateTime _periodEnd = DateTime.Today;
    [ObservableProperty] private decimal _outputVat;
    [ObservableProperty] private decimal _inputVat;
    [ObservableProperty] private decimal _vatDue;
    [ObservableProperty] private bool _isRefund;

    public FinanceVatViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "VAT";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;
            Periods = new ObservableCollection<FinanceVatPeriod>(await _storage.GetVatPeriodsAsync(_companyId));
            await ComputeCurrentAsync();
        });
    }

    partial void OnPeriodStartChanged(DateTime value) => _ = ComputeCurrentAsync();
    partial void OnPeriodEndChanged(DateTime value) => _ = ComputeCurrentAsync();

    private async Task ComputeCurrentAsync()
    {
        if (_companyId == Guid.Empty) return;
        var start = DateOnly.FromDateTime(PeriodStart);
        var end = DateOnly.FromDateTime(PeriodEnd);

        var invoices = await _storage.GetFinanceInvoicesAsync(_companyId);
        var supplierInvoices = await _storage.GetSupplierInvoicesAsync(_companyId);

        var output = invoices
            .Where(i => i.StatusRaw is not ("draft" or "cancelled") && i.IssueDate >= start && i.IssueDate <= end)
            .Select(i => i.VatAmount);
        var input = supplierInvoices
            .Where(s => s.StatusRaw != "cancelled" && s.DueDate.HasValue && s.DueDate.Value >= start && s.DueDate.Value <= end)
            .Select(s => s.VatAmount);

        var summary = FinanceCalculationHelper.SummariseVatPeriod(output, input);
        OutputVat = summary.OutputVat;
        InputVat = summary.InputVat;
        VatDue = summary.VatDue;
        IsRefund = summary.VatDue < 0;
    }

    [RelayCommand]
    private async Task SavePeriodAsync()
    {
        await RunAsync(async () =>
        {
            await _storage.UpsertVatPeriodAsync(new FinanceVatPeriod
            {
                CompanyId = _companyId,
                StartDate = DateOnly.FromDateTime(PeriodStart),
                EndDate = DateOnly.FromDateTime(PeriodEnd),
                OutputVat = OutputVat,
                InputVat = InputVat,
                VatDue = VatDue
            });
            await LoadAsync();
        });
    }

    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();
}
