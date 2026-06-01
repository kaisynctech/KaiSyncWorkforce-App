using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using Op = Supabase.Postgrest.Constants.Operator;
using Ord = Supabase.Postgrest.Constants.Ordering;

namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Finance approvals &amp; audit trail (Phase 8). Approve / reject / mark-paid for
/// payables, refunds, and an append-only finance_audit_log. Every state change
/// writes a durable audit row AND emits an AppTelemetry event.
/// </summary>
public partial class SupabaseStorageService
{
    // ════════════════════════════════════════════════════════════════════════
    // Audit trail
    // ════════════════════════════════════════════════════════════════════════
    public async Task<List<FinanceAuditEntry>> GetFinanceAuditAsync(Guid companyId, int limit = 100)
    {
        var result = await _supabase.From<FinanceAuditEntry>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get();
        return result.Models;
    }

    private async Task LogFinanceAuditAsync(
        Guid companyId, string entityType, Guid? entityId, string action,
        decimal amount, Guid? actorId, string? actorName, string? note)
    {
        try
        {
            await _supabase.From<FinanceAuditEntry>().Insert(new FinanceAuditEntry
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                EntityType = entityType,
                EntityId = entityId,
                Action = action,
                ActorId = actorId,
                ActorName = actorName,
                Amount = amount,
                Note = note,
                CreatedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[FINANCE AUDIT] persist failed: {ex.Message}");
        }

        _telemetry.LogEvent($"finance_{entityType}_{action}", new Dictionary<string, string>
        {
            ["entity_id"] = entityId?.ToString() ?? "",
            ["amount"] = amount.ToString("F2"),
            ["actor"] = actorName ?? ""
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    // Supplier invoice approvals
    // ════════════════════════════════════════════════════════════════════════
    public async Task<SupplierInvoice> ApproveSupplierInvoiceAsync(Guid invoiceId, Guid? actorId, string? actorName)
    {
        var invoice = await GetSupplierInvoiceByIdAsync(invoiceId)
            ?? throw new InvalidOperationException("Supplier invoice not found.");
        invoice.ApprovalStatusRaw = "approved";
        invoice.ApprovedBy = actorId;
        invoice.ApprovedAt = DateTime.UtcNow;
        if (invoice.StatusRaw == "received") invoice.StatusRaw = "approved";
        var saved = await UpdateSupplierInvoiceAsync(invoice);
        await LogFinanceAuditAsync(invoice.CompanyId, "supplier_invoice", invoiceId, "approved",
            invoice.TotalAmount, actorId, actorName, null);
        return saved;
    }

    public async Task<SupplierInvoice> RejectSupplierInvoiceAsync(Guid invoiceId, Guid? actorId, string? actorName, string? note)
    {
        var invoice = await GetSupplierInvoiceByIdAsync(invoiceId)
            ?? throw new InvalidOperationException("Supplier invoice not found.");
        invoice.ApprovalStatusRaw = "rejected";
        invoice.ApprovedBy = actorId;
        invoice.ApprovedAt = DateTime.UtcNow;
        var saved = await UpdateSupplierInvoiceAsync(invoice);
        await LogFinanceAuditAsync(invoice.CompanyId, "supplier_invoice", invoiceId, "rejected",
            invoice.TotalAmount, actorId, actorName, note);
        return saved;
    }

    public async Task<SupplierInvoice> MarkSupplierInvoicePaidAsync(Guid invoiceId, decimal amount, string? method, Guid? actorId, string? actorName)
    {
        var invoice = await GetSupplierInvoiceByIdAsync(invoiceId)
            ?? throw new InvalidOperationException("Supplier invoice not found.");

        invoice.AmountPaid = VatCalculator.RoundFinancialValues(invoice.AmountPaid + amount);
        invoice.BalanceDue = FinanceCalculationHelper.BalanceDue(invoice.TotalAmount, invoice.AmountPaid);
        var state = FinanceCalculationHelper.ResolvePaymentState(invoice.TotalAmount, invoice.AmountPaid, invoice.DueDate);
        invoice.StatusRaw = state switch
        {
            PaymentState.Paid => "paid",
            PaymentState.PartiallyPaid => "partially_paid",
            _ => invoice.StatusRaw
        };
        if (invoice.StatusRaw == "paid") invoice.PaidAt = DateTime.UtcNow;

        await UpdateSupplierInvoiceAsync(invoice);

        await AddFinanceTransactionAsync(new FinanceTransaction
        {
            CompanyId = invoice.CompanyId,
            TransactionTypeRaw = "supplier_payment",
            DirectionRaw = "outgoing",
            SourceTable = "supplier_invoices",
            SourceId = invoice.Id,
            ReferenceNumber = invoice.InvoiceNumber,
            Amount = amount,
            TotalAmount = amount,
            TransactionDate = DateOnly.FromDateTime(DateTime.UtcNow),
            PaymentMethod = method,
            CreatedBy = actorId
        });

        await LogFinanceAuditAsync(invoice.CompanyId, "supplier_invoice", invoiceId, "paid",
            amount, actorId, actorName, method);
        return invoice;
    }

    private async Task<SupplierInvoice?> GetSupplierInvoiceByIdAsync(Guid invoiceId)
    {
        var result = await _supabase.From<SupplierInvoice>()
            .Filter("id", Op.Equals, invoiceId.ToString()).Get();
        return result.Models.FirstOrDefault();
    }

    // ════════════════════════════════════════════════════════════════════════
    // Contractor payout approvals
    // ════════════════════════════════════════════════════════════════════════
    public async Task<ContractorPayout> ApproveContractorPayoutAsync(Guid payoutId, Guid? actorId, string? actorName)
    {
        var payout = await GetContractorPayoutByIdAsync(payoutId)
            ?? throw new InvalidOperationException("Contractor payout not found.");
        payout.ApprovalStatusRaw = "approved";
        payout.PayoutStatusRaw = "approved";
        payout.ApprovedBy = actorId;
        payout.ApprovedAt = DateTime.UtcNow;
        var saved = await UpdateContractorPayoutAsync(payout);
        await LogFinanceAuditAsync(payout.CompanyId, "contractor_payout", payoutId, "approved",
            payout.NetPayable, actorId, actorName, null);
        return saved;
    }

    public async Task<ContractorPayout> RejectContractorPayoutAsync(Guid payoutId, Guid? actorId, string? actorName, string? note)
    {
        var payout = await GetContractorPayoutByIdAsync(payoutId)
            ?? throw new InvalidOperationException("Contractor payout not found.");
        payout.ApprovalStatusRaw = "rejected";
        payout.PayoutStatusRaw = "cancelled";
        payout.ApprovedBy = actorId;
        payout.ApprovedAt = DateTime.UtcNow;
        var saved = await UpdateContractorPayoutAsync(payout);
        await LogFinanceAuditAsync(payout.CompanyId, "contractor_payout", payoutId, "rejected",
            payout.NetPayable, actorId, actorName, note);
        return saved;
    }

    public async Task<ContractorPayout> MarkContractorPayoutPaidAsync(Guid payoutId, string? method, Guid? actorId, string? actorName)
    {
        var payout = await GetContractorPayoutByIdAsync(payoutId)
            ?? throw new InvalidOperationException("Contractor payout not found.");
        payout.PayoutStatusRaw = "paid";
        payout.PaidAt = DateTime.UtcNow;
        payout.PayoutDate = DateOnly.FromDateTime(DateTime.UtcNow);
        await UpdateContractorPayoutAsync(payout);

        await AddFinanceTransactionAsync(new FinanceTransaction
        {
            CompanyId = payout.CompanyId,
            TransactionTypeRaw = "contractor_payment",
            DirectionRaw = "outgoing",
            SourceTable = "contractor_payouts",
            SourceId = payout.Id,
            Amount = payout.NetPayable,
            TotalAmount = payout.NetPayable,
            TransactionDate = DateOnly.FromDateTime(DateTime.UtcNow),
            PaymentMethod = method,
            CreatedBy = actorId
        });

        await LogFinanceAuditAsync(payout.CompanyId, "contractor_payout", payoutId, "paid",
            payout.NetPayable, actorId, actorName, method);
        return payout;
    }

    private async Task<ContractorPayout?> GetContractorPayoutByIdAsync(Guid payoutId)
    {
        var result = await _supabase.From<ContractorPayout>()
            .Filter("id", Op.Equals, payoutId.ToString()).Get();
        return result.Models.FirstOrDefault();
    }

    // ════════════════════════════════════════════════════════════════════════
    // Refunds
    // ════════════════════════════════════════════════════════════════════════
    public async Task IssueRefundAsync(Guid companyId, Guid? sourceInvoiceId, decimal amount, string? reference, string? note, Guid? actorId, string? actorName)
    {
        await AddFinanceTransactionAsync(new FinanceTransaction
        {
            CompanyId = companyId,
            TransactionTypeRaw = "refund",
            DirectionRaw = "outgoing",
            SourceTable = sourceInvoiceId.HasValue ? "finance_invoices" : null,
            SourceId = sourceInvoiceId,
            ReferenceNumber = reference,
            Amount = amount,
            TotalAmount = amount,
            TransactionDate = DateOnly.FromDateTime(DateTime.UtcNow),
            Notes = note,
            CreatedBy = actorId
        });
        await LogFinanceAuditAsync(companyId, "refund", sourceInvoiceId, "refunded", amount, actorId, actorName, note);
    }
}
