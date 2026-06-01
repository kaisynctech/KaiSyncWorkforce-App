using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

/// <summary>A payable awaiting an approval decision or payment (unified across types).</summary>
public class FinanceApprovalItem
{
    public string EntityType { get; set; } = "";   // supplier_invoice | contractor_payout
    public Guid Id { get; set; }
    public string Title { get; set; } = "";
    public string Subtitle { get; set; } = "";
    public decimal Amount { get; set; }

    public string AmountDisplay => $"R{Amount:N2}";
    public string TypeLabel => EntityType == "supplier_invoice" ? "Supplier invoice" : "Contractor payout";
    public string TypeColor => EntityType == "supplier_invoice" ? "#F59E0B" : "#8B5CF6";
}

public partial class FinanceApprovalsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private Guid _companyId;

    [ObservableProperty] private ObservableCollection<FinanceApprovalItem> _awaitingApproval = new();
    [ObservableProperty] private ObservableCollection<FinanceApprovalItem> _awaitingPayment = new();
    [ObservableProperty] private ObservableCollection<FinanceAuditEntry> _auditEntries = new();
    [ObservableProperty] private decimal _pendingApprovalTotal;
    [ObservableProperty] private decimal _pendingPaymentTotal;

    public FinanceApprovalsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Finance Approvals";
    }

    private Guid? ActorId => _state.CurrentEmployee?.Id;
    private string? ActorName => _state.CurrentEmployee?.FullName;

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;

            var contractors = await _storage.GetContractorsAsync(_companyId);
            var nameById = contractors.ToDictionary(c => c.Id, c => c.Name);

            var supplierInvoices = await _storage.GetSupplierInvoicesAsync(_companyId);
            var payouts = await _storage.GetContractorPayoutsAsync(_companyId);

            string SupplierName(Guid? id) => id.HasValue && nameById.TryGetValue(id.Value, out var n) ? n : "Supplier";

            var approval = new List<FinanceApprovalItem>();
            var payment = new List<FinanceApprovalItem>();

            foreach (var s in supplierInvoices)
            {
                if (s.ApprovalStatusRaw == "pending")
                    approval.Add(new FinanceApprovalItem
                    {
                        EntityType = "supplier_invoice",
                        Id = s.Id,
                        Title = $"{SupplierName(s.SupplierId)} · {s.InvoiceNumber ?? "(no number)"}",
                        Subtitle = $"Due {s.DueDateDisplay}",
                        Amount = s.TotalAmount
                    });
                else if (s.ApprovalStatusRaw == "approved" && s.StatusRaw is not ("paid" or "cancelled") && s.BalanceDue > 0)
                    payment.Add(new FinanceApprovalItem
                    {
                        EntityType = "supplier_invoice",
                        Id = s.Id,
                        Title = $"{SupplierName(s.SupplierId)} · {s.InvoiceNumber ?? "(no number)"}",
                        Subtitle = $"Balance {s.BalanceDisplay}",
                        Amount = s.BalanceDue
                    });
            }

            foreach (var p in payouts)
            {
                if (p.ApprovalStatusRaw == "pending")
                    approval.Add(new FinanceApprovalItem
                    {
                        EntityType = "contractor_payout",
                        Id = p.Id,
                        Title = SupplierName(p.ContractorId),
                        Subtitle = $"Net {p.NetDisplay}",
                        Amount = p.NetPayable
                    });
                else if (p.PayoutStatusRaw == "approved")
                    payment.Add(new FinanceApprovalItem
                    {
                        EntityType = "contractor_payout",
                        Id = p.Id,
                        Title = SupplierName(p.ContractorId),
                        Subtitle = $"Net {p.NetDisplay}",
                        Amount = p.NetPayable
                    });
            }

            AwaitingApproval = new ObservableCollection<FinanceApprovalItem>(approval);
            AwaitingPayment = new ObservableCollection<FinanceApprovalItem>(payment);
            PendingApprovalTotal = approval.Sum(i => i.Amount);
            PendingPaymentTotal = payment.Sum(i => i.Amount);

            AuditEntries = new ObservableCollection<FinanceAuditEntry>(await _storage.GetFinanceAuditAsync(_companyId, 50));
        });
    }

    [RelayCommand]
    private async Task ApproveAsync(FinanceApprovalItem? item)
    {
        if (item is null) return;
        await RunAsync(async () =>
        {
            if (item.EntityType == "supplier_invoice")
                await _storage.ApproveSupplierInvoiceAsync(item.Id, ActorId, ActorName);
            else
                await _storage.ApproveContractorPayoutAsync(item.Id, ActorId, ActorName);
        });
        if (ErrorMessage == null) await LoadAsync();
    }

    [RelayCommand]
    private async Task RejectAsync(FinanceApprovalItem? item)
    {
        if (item is null) return;
        var page = Application.Current?.Windows.FirstOrDefault()?.Page;
        string? note = page != null ? await page.DisplayPromptAsync("Reject", "Reason (optional):") : null;

        await RunAsync(async () =>
        {
            if (item.EntityType == "supplier_invoice")
                await _storage.RejectSupplierInvoiceAsync(item.Id, ActorId, ActorName, note);
            else
                await _storage.RejectContractorPayoutAsync(item.Id, ActorId, ActorName, note);
        });
        if (ErrorMessage == null) await LoadAsync();
    }

    [RelayCommand]
    private async Task MarkPaidAsync(FinanceApprovalItem? item)
    {
        if (item is null) return;
        await RunAsync(async () =>
        {
            if (item.EntityType == "supplier_invoice")
                await _storage.MarkSupplierInvoicePaidAsync(item.Id, item.Amount, "EFT", ActorId, ActorName);
            else
                await _storage.MarkContractorPayoutPaidAsync(item.Id, "EFT", ActorId, ActorName);
        });
        if (ErrorMessage == null) await LoadAsync();
    }

    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();
}
