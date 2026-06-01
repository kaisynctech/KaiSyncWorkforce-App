using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

[QueryProperty(nameof(InvoiceIdParam), "InvoiceId")]
public partial class FinanceInvoiceDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly TaxCalculationService _tax;

    private Guid _companyId;
    private Guid? _invoiceId;
    private bool _loaded;

    [ObservableProperty] private string _invoiceIdParam = "";

    // Header
    [ObservableProperty] private string _invoiceNumber = "";
    [ObservableProperty] private string _statusRaw = "draft";
    [ObservableProperty] private DateTime _issueDate = DateTime.Today;
    [ObservableProperty] private DateTime _dueDate = DateTime.Today.AddDays(30);
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private decimal _discountAmount;
    [ObservableProperty] private bool _isVatInclusive;

    // Pickers
    [ObservableProperty] private ObservableCollection<Client> _clients = [];
    [ObservableProperty] private Client? _selectedClient;
    [ObservableProperty] private ObservableCollection<ClientDeal> _projects = [];
    [ObservableProperty] private ClientDeal? _selectedProject;

    // Lines + totals
    public ObservableCollection<InvoiceLineEditor> Lines { get; } = [];
    [ObservableProperty] private decimal _subtotal;
    [ObservableProperty] private decimal _vatAmount;
    [ObservableProperty] private decimal _totalAmount;
    [ObservableProperty] private decimal _amountPaid;
    [ObservableProperty] private decimal _balanceDue;

    // Payment entry
    [ObservableProperty] private decimal _paymentAmount;
    [ObservableProperty] private string _paymentMethod = "EFT";

    public bool IsNew => _invoiceId is null;
    public bool IsExisting => _invoiceId is not null;

    public FinanceInvoiceDetailViewModel(IStorageService storage, TimesheetStateService state, TaxCalculationService tax)
    {
        _storage = storage;
        _state = state;
        _tax = tax;
        Title = "Invoice";
    }

    partial void OnInvoiceIdParamChanged(string value) => _ = InitializeAsync();
    partial void OnDiscountAmountChanged(decimal value) => RecomputeTotals();

    partial void OnIsVatInclusiveChanged(bool value)
    {
        foreach (var line in Lines) line.IsVatInclusive = value;
        RecomputeTotals();
    }

    private async Task InitializeAsync()
    {
        if (_loaded) return;
        _loaded = true;

        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;

            var company = await _storage.GetCurrentCompanyAsync(_companyId);
            if (company != null)
            {
                _tax.CompanyDefaultVatRate = company.DefaultVatRate <= 0 ? VatConstants.DefaultSouthAfricaVatRate : company.DefaultVatRate;
                IsVatInclusive = company.FinanceVatInclusiveDefault;
            }

            Clients = new ObservableCollection<Client>(await _storage.GetClientsAsync(_companyId));
            Projects = new ObservableCollection<ClientDeal>(await _storage.GetClientDealsAsync(_companyId));

            if (string.Equals(InvoiceIdParam, "new", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(InvoiceIdParam))
            {
                _invoiceId = null;
                InvoiceNumber = await _storage.GenerateNextInvoiceNumberAsync(_companyId);
                AddLine();
            }
            else if (Guid.TryParse(InvoiceIdParam, out var id))
            {
                await LoadExistingAsync(id);
            }

            OnPropertyChanged(nameof(IsNew));
            OnPropertyChanged(nameof(IsExisting));
        });
    }

    private async Task LoadExistingAsync(Guid id)
    {
        var invoice = await _storage.GetFinanceInvoiceAsync(id);
        if (invoice == null) return;

        _invoiceId = invoice.Id;
        InvoiceNumber = invoice.InvoiceNumber ?? "";
        StatusRaw = invoice.StatusRaw;
        IssueDate = invoice.IssueDate.ToDateTime(TimeOnly.MinValue);
        DueDate = (invoice.DueDate ?? invoice.IssueDate.AddDays(30)).ToDateTime(TimeOnly.MinValue);
        Notes = invoice.Notes ?? "";
        DiscountAmount = invoice.DiscountAmount;
        IsVatInclusive = invoice.IsVatInclusive;
        AmountPaid = invoice.AmountPaid;
        SelectedClient = Clients.FirstOrDefault(c => c.Id == invoice.ClientId);
        SelectedProject = Projects.FirstOrDefault(p => p.Id == invoice.ProjectId);

        var lines = await _storage.GetFinanceInvoiceLinesAsync(id);
        Lines.Clear();
        foreach (var l in lines.OrderBy(x => x.LineNo))
            AttachLine(InvoiceLineEditor.FromModel(l));
        RecomputeTotals();
    }

    private void AttachLine(InvoiceLineEditor editor)
    {
        editor.Recalculated += OnLineRecalculated;
        Lines.Add(editor);
    }

    private void OnLineRecalculated(object? sender, EventArgs e) => RecomputeTotals();

    [RelayCommand]
    private void AddLine()
    {
        var editor = new InvoiceLineEditor
        {
            LineNo = Lines.Count + 1,
            VatRate = _tax.CompanyDefaultVatRate,
            IsVatInclusive = IsVatInclusive
        };
        AttachLine(editor);
        RecomputeTotals();
    }

    [RelayCommand]
    private void RemoveLine(InvoiceLineEditor line)
    {
        if (line == null) return;
        line.Recalculated -= OnLineRecalculated;
        Lines.Remove(line);
        var n = 1;
        foreach (var l in Lines) l.LineNo = n++;
        RecomputeTotals();
    }

    private void RecomputeTotals()
    {
        var linesSubtotal = Lines.Sum(l => l.Subtotal);
        var vat = VatCalculator.RoundFinancialValues(Lines.Sum(l => l.VatAmount));
        var subtotal = VatCalculator.RoundFinancialValues(linesSubtotal - DiscountAmount);
        if (subtotal < 0) subtotal = 0;
        Subtotal = subtotal;
        VatAmount = vat;
        TotalAmount = VatCalculator.RoundFinancialValues(subtotal + vat);
        BalanceDue = FinanceCalculationHelper.BalanceDue(TotalAmount, AmountPaid);
    }

    [RelayCommand]
    private async Task SaveAsync() => await PersistAsync(StatusRaw);

    [RelayCommand]
    private async Task MarkSentAsync() => await PersistAsync(StatusRaw == "draft" ? "sent" : StatusRaw);

    private async Task PersistAsync(string status)
    {
        if (Lines.Count == 0)
        {
            ErrorMessage = "Add at least one line item.";
            return;
        }

        await RunAsync(async () =>
        {
            var invoice = new FinanceInvoice
            {
                Id = _invoiceId ?? Guid.NewGuid(),
                CompanyId = _companyId,
                ClientId = SelectedClient?.Id,
                ProjectId = SelectedProject?.Id,
                InvoiceNumber = string.IsNullOrWhiteSpace(InvoiceNumber) ? null : InvoiceNumber.Trim(),
                StatusRaw = status,
                IsVatInclusive = IsVatInclusive,
                DiscountAmount = DiscountAmount,
                IssueDate = DateOnly.FromDateTime(IssueDate),
                DueDate = DateOnly.FromDateTime(DueDate),
                Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim(),
                AmountPaid = AmountPaid,
                CreatedBy = _state.CurrentEmployee?.Id
            };

            if (_invoiceId is null)
            {
                var created = await _storage.CreateFinanceInvoiceAsync(invoice);
                _invoiceId = created.Id;
            }
            else
            {
                await _storage.UpdateFinanceInvoiceAsync(invoice);
                // Replace lines wholesale for a clean rebuild.
                var existing = await _storage.GetFinanceInvoiceLinesAsync(_invoiceId.Value);
                foreach (var l in existing) await _storage.DeleteFinanceInvoiceLineAsync(l.Id);
            }

            var lineNo = 1;
            foreach (var editor in Lines)
            {
                editor.LineNo = lineNo++;
                await _storage.AddFinanceInvoiceLineAsync(editor.ToModel(_invoiceId!.Value, _companyId));
            }

            var synced = await _storage.SyncFinanceInvoiceTotalsAsync(_invoiceId!.Value);
            StatusRaw = synced.StatusRaw;
            AmountPaid = synced.AmountPaid;
            RecomputeTotals();
            OnPropertyChanged(nameof(IsNew));
            OnPropertyChanged(nameof(IsExisting));
        });

        if (ErrorMessage == null)
            await ShellNavigation.GoBackOrDashboardAsync();
    }

    [RelayCommand]
    private async Task RecordPaymentAsync()
    {
        if (_invoiceId is null) { ErrorMessage = "Save the invoice before recording a payment."; return; }
        if (PaymentAmount <= 0) { ErrorMessage = "Enter a payment amount."; return; }

        await RunAsync(async () =>
        {
            var updated = await _storage.RecordInvoicePaymentAsync(_invoiceId.Value, PaymentAmount, PaymentMethod);
            StatusRaw = updated.StatusRaw;
            AmountPaid = updated.AmountPaid;
            PaymentAmount = 0;
            RecomputeTotals();
        });
    }

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (_invoiceId is null) { await ShellNavigation.GoBackOrDashboardAsync(); return; }
        await RunAsync(async () => await _storage.DeleteFinanceInvoiceAsync(_invoiceId.Value));
        if (ErrorMessage == null) await ShellNavigation.GoBackOrDashboardAsync();
    }
}
