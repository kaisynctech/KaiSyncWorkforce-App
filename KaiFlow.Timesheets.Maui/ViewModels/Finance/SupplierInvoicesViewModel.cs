using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class SupplierInvoicesViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly TaxCalculationService _tax;
    private Guid _companyId;

    [ObservableProperty] private ObservableCollection<SupplierInvoice> _invoices = [];
    [ObservableProperty] private decimal _payablesTotal;

    // Quick-add form (VAT auto-calc, inclusive/exclusive toggle)
    [ObservableProperty] private ObservableCollection<Contractor> _suppliers = [];
    [ObservableProperty] private Contractor? _selectedSupplier;
    [ObservableProperty] private string _quickInvoiceNumber = "";
    [ObservableProperty] private decimal _quickAmount;
    [ObservableProperty] private decimal _quickVatRate = VatConstants.DefaultSouthAfricaVatRate;
    [ObservableProperty] private bool _quickIsInclusive;
    [ObservableProperty] private DateTime _quickDueDate = DateTime.Today.AddDays(30);
    [ObservableProperty] private decimal _previewVat;
    [ObservableProperty] private decimal _previewTotal;
    [ObservableProperty] private decimal _previewSubtotal;

    public SupplierInvoicesViewModel(IStorageService storage, TimesheetStateService state, TaxCalculationService tax)
    {
        _storage = storage;
        _state = state;
        _tax = tax;
        Title = "Supplier Invoices";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;
            var company = await _storage.GetCurrentCompanyAsync(_companyId);
            if (company != null && company.DefaultVatRate > 0) QuickVatRate = company.DefaultVatRate;

            var contractors = await _storage.GetContractorsAsync(_companyId);
            Suppliers = new ObservableCollection<Contractor>(
                contractors.Where(c => c.PartnerKindRaw is "supplier" or "both").OrderBy(c => c.Name));

            var list = await _storage.GetSupplierInvoicesAsync(_companyId);
            Invoices = new ObservableCollection<SupplierInvoice>(list);
            PayablesTotal = list.Where(i => i.IsOutstanding).Sum(i => i.BalanceDue);
            RecomputePreview();
        });
    }

    partial void OnQuickAmountChanged(decimal value) => RecomputePreview();
    partial void OnQuickVatRateChanged(decimal value) => RecomputePreview();
    partial void OnQuickIsInclusiveChanged(bool value) => RecomputePreview();

    private void RecomputePreview()
    {
        var calc = _tax.Calculate(QuickAmount, QuickIsInclusive, QuickVatRate);
        PreviewSubtotal = calc.Subtotal;
        PreviewVat = calc.VatAmount;
        PreviewTotal = calc.TotalAmount;
    }

    [RelayCommand]
    private async Task AddInvoiceAsync()
    {
        if (QuickAmount <= 0) { ErrorMessage = "Enter an amount."; return; }
        var calc = _tax.Calculate(QuickAmount, QuickIsInclusive, QuickVatRate);

        await RunAsync(async () =>
        {
            await _storage.CreateSupplierInvoiceAsync(new SupplierInvoice
            {
                CompanyId = _companyId,
                SupplierId = SelectedSupplier?.Id,
                InvoiceNumber = string.IsNullOrWhiteSpace(QuickInvoiceNumber) ? null : QuickInvoiceNumber.Trim(),
                Subtotal = calc.Subtotal,
                VatRate = calc.VatRate,
                VatAmount = calc.VatAmount,
                TotalAmount = calc.TotalAmount,
                IsVatInclusive = QuickIsInclusive,
                DueDate = DateOnly.FromDateTime(QuickDueDate),
                StatusRaw = "received",
                CreatedBy = _state.CurrentEmployee?.Id
            });
            QuickInvoiceNumber = "";
            QuickAmount = 0;
            await LoadAsync();
        });
    }

    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();
}
