using CommunityToolkit.Maui.Storage;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;
using System.Text;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class ContractorPayoutsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly TaxCalculationService _tax;
    private readonly IFileSaver _fileSaver;
    private readonly IExportService _export;
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

    // ── Phase N: payment run ──────────────────────────────────────────────────
    [ObservableProperty] private bool _paymentRunActive;
    [ObservableProperty] private ObservableCollection<ContractorPayout> _paymentRunPayouts = [];
    [ObservableProperty] private string _paymentRunSummary = "";

    public bool IsNotPaymentRunActive => !PaymentRunActive;
    partial void OnPaymentRunActiveChanged(bool _) => OnPropertyChanged(nameof(IsNotPaymentRunActive));

    public ContractorPayoutsViewModel(IStorageService storage, TimesheetStateService state, TaxCalculationService tax, IFileSaver fileSaver, IExportService export)
    {
        _storage = storage;
        _state = state;
        _tax = tax;
        _fileSaver = fileSaver;
        _export = export;
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

            // Enrich payouts with contractor display names for payment run rows
            var contractorMap = contractors.ToDictionary(c => c.Id);
            foreach (var p in list)
                if (p.ContractorId.HasValue && contractorMap.TryGetValue(p.ContractorId.Value, out var c))
                    p.PayRunContractorName = c.Name;

            Payouts = new ObservableCollection<ContractorPayout>(list);
            PayableTotal = list.Where(p => p.PayoutStatusRaw is "pending" or "approved").Sum(p => p.NetPayable);
            RecomputePreview();
        });
    }

    partial void OnQuickAmountChanged(decimal _)    => RecomputePreview();
    partial void OnQuickVatRateChanged(decimal _)   => RecomputePreview();
    partial void OnQuickIsInclusiveChanged(bool _)  => RecomputePreview();
    partial void OnQuickRetentionChanged(decimal _) => RecomputePreview();

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

    // ── Phase N: payment run commands ─────────────────────────────────────────

    [RelayCommand]
    private void StartPaymentRun()
    {
        var approved = Payouts.Where(p => p.PayoutStatusRaw == "approved").ToList();
        if (approved.Count == 0)
        {
            ErrorMessage = "No approved payouts to process. Approve payouts in Finance Approvals first.";
            return;
        }
        PaymentRunPayouts = new ObservableCollection<ContractorPayout>(approved);
        var total = approved.Sum(p => p.NetPayable);
        PaymentRunSummary = $"{approved.Count} approved payout{(approved.Count == 1 ? "" : "s")} · R{total:N2} net payable";
        PaymentRunActive = true;
    }

    [RelayCommand]
    private void CancelPaymentRun()
    {
        PaymentRunActive = false;
        PaymentRunPayouts = [];
        PaymentRunSummary = "";
    }

    [RelayCommand]
    private async Task ExportEftCsvAsync()
    {
        if (PaymentRunPayouts.Count == 0) return;

        var contractorMap = Contractors.ToDictionary(c => c.Id);
        var sb = new StringBuilder();
        sb.AppendLine("ContractorName,BankName,BranchCode,AccountNumber,NetAmount,Reference,PayoutId");

        foreach (var p in PaymentRunPayouts)
        {
            contractorMap.TryGetValue(p.ContractorId ?? Guid.Empty, out var contractor);
            var name      = CsvEscape(string.IsNullOrWhiteSpace(p.PayRunContractorName) ? contractor?.Name : p.PayRunContractorName);
            var bank      = CsvEscape(contractor?.BankName ?? "");
            var branch    = CsvEscape(contractor?.BankBranchCode ?? "");
            var account   = CsvEscape(contractor?.BankAccount ?? "");
            var amount    = p.NetPayable.ToString("F2");
            var reference = CsvEscape(p.InvoiceReferenceDisplay != "—" ? p.InvoiceReferenceDisplay : p.Id.ToString());
            sb.AppendLine($"{name},{bank},{branch},{account},{amount},{reference},{p.Id}");
        }

        var bytes  = Encoding.UTF8.GetBytes(sb.ToString());
        var stream = new MemoryStream(bytes);
        var result = await _fileSaver.SaveAsync("EFT_Batch.csv", stream, CancellationToken.None);
        if (result.IsSuccessful)
            await Shell.Current.DisplayAlert("Export Successful", $"EFT batch saved to:\n{result.FilePath}", "OK");
    }

    [RelayCommand]
    private async Task MarkAllPaidAsync()
    {
        if (PaymentRunPayouts.Count == 0) return;

        var confirm = await Shell.Current.DisplayAlert(
            "Confirm Payment Run",
            $"Mark {PaymentRunPayouts.Count} payout(s) as paid?\n\n{PaymentRunSummary}\n\nThis cannot be undone.",
            "Mark Paid", "Cancel");
        if (!confirm) return;

        // Capture snapshots before clearing the run
        var snapshot = PaymentRunPayouts.ToList();

        await RunAsync(async () =>
        {
            var actorId   = _state.CurrentEmployee?.Id;
            var actorName = _state.CurrentEmployee?.FullName;
            foreach (var p in snapshot)
                await _storage.MarkContractorPayoutPaidAsync(p.Id, "eft", actorId, actorName);
        });
        if (ErrorMessage != null) return;

        CancelPaymentRun();
        await LoadAsync();

        await Shell.Current.DisplayAlert("Payment Run Complete",
            $"All {snapshot.Count} payout(s) marked as paid.", "OK");

        // ── Phase O: offer remittance advice PDFs ────────────────────────────
        var generateRemittances = await Shell.Current.DisplayAlert(
            "Remittance Advice",
            $"Generate remittance advice PDF{(snapshot.Count > 1 ? "s" : "")} for {snapshot.Count} payout{(snapshot.Count > 1 ? "s" : "")}?",
            "Generate PDFs", "Skip");
        if (!generateRemittances) return;

        var delivery = await _export.AskExportDeliveryAsync("Remittance Advice PDFs");
        if (delivery == null) return;

        var companyName = _state.CurrentCompany?.Name ?? "KaiSync Workforce";
        foreach (var p in snapshot)
            await _export.ExportContractorRemittancePdfAsync(p, p.PayRunContractorName, companyName, delivery.Value);
    }

    private static string CsvEscape(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }
}
