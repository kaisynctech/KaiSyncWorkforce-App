using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class ContractorPayoutsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly TaxCalculationService _tax;
    private Guid _companyId;

    [ObservableProperty] private ObservableCollection<ContractorPayout> _payouts = [];
    [ObservableProperty] private decimal _payableTotal;

    // Quick-add form
    [ObservableProperty] private ObservableCollection<Contractor> _contractors = [];
    [ObservableProperty] private Contractor? _selectedContractor;
    [ObservableProperty] private decimal _quickAmount;
    [ObservableProperty] private decimal _quickVatRate;
    [ObservableProperty] private bool _quickIsInclusive;
    [ObservableProperty] private decimal _quickRetention;
    [ObservableProperty] private decimal _previewVat;
    [ObservableProperty] private decimal _previewTotal;
    [ObservableProperty] private decimal _previewNet;

    public ContractorPayoutsViewModel(IStorageService storage, TimesheetStateService state, TaxCalculationService tax)
    {
        _storage = storage;
        _state = state;
        _tax = tax;
        Title = "Contractor Payouts";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;
            var company = await _storage.GetCurrentCompanyAsync(_companyId);
            if (company != null && company.DefaultVatRate > 0 && QuickVatRate == 0) QuickVatRate = company.DefaultVatRate;
            var contractors = await _storage.GetContractorsAsync(_companyId);
            Contractors = new ObservableCollection<Contractor>(
                contractors.Where(c => c.PartnerKindRaw is "contractor" or "both").OrderBy(c => c.Name));

            var list = await _storage.GetContractorPayoutsAsync(_companyId);
            Payouts = new ObservableCollection<ContractorPayout>(list);
            PayableTotal = list.Where(p => p.PayoutStatusRaw is "pending" or "approved").Sum(p => p.NetPayable);
            RecomputePreview();
        });
    }

    partial void OnQuickAmountChanged(decimal value) => RecomputePreview();
    partial void OnQuickVatRateChanged(decimal value) => RecomputePreview();
    partial void OnQuickIsInclusiveChanged(bool value) => RecomputePreview();
    partial void OnQuickRetentionChanged(decimal value) => RecomputePreview();

    private void RecomputePreview()
    {
        var calc = _tax.Calculate(QuickAmount, QuickIsInclusive, QuickVatRate, TaxType.Standard);
        PreviewVat = calc.VatAmount;
        PreviewTotal = calc.TotalAmount;
        PreviewNet = VatCalculator.RoundFinancialValues(calc.TotalAmount - QuickRetention);
    }

    [RelayCommand]
    private async Task AddPayoutAsync()
    {
        if (QuickAmount <= 0) { ErrorMessage = "Enter an amount."; return; }
        var calc = _tax.Calculate(QuickAmount, QuickIsInclusive, QuickVatRate, TaxType.Standard);

        await RunAsync(async () =>
        {
            await _storage.CreateContractorPayoutAsync(new ContractorPayout
            {
                CompanyId = _companyId,
                ContractorId = SelectedContractor?.Id,
                Subtotal = calc.Subtotal,
                VatRate = calc.VatRate,
                VatAmount = calc.VatAmount,
                TotalAmount = calc.TotalAmount,
                RetentionAmount = QuickRetention,
                IsVatInclusive = QuickIsInclusive,
                PayoutStatusRaw = "pending",
                CreatedBy = _state.CurrentEmployee?.Id
            });
            QuickAmount = 0;
            QuickRetention = 0;
            await LoadAsync();
        });
    }

    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();
}
