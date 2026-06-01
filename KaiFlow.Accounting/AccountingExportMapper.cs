using System.Text.Json;

namespace KaiFlow.Accounting;

public sealed class AccountingExportMapper : IAccountingExportMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public AccountingSyncItem MapInvoice(AccountingInvoiceDto invoice, AccountingProviderKind provider) =>
        Create(invoice.CompanyId, AccountingEntityType.Invoice, invoice.Id, provider, invoice,
            $"invoice:{invoice.Id}");

    public AccountingSyncItem MapPayment(AccountingPaymentDto payment, AccountingProviderKind provider) =>
        Create(payment.CompanyId, AccountingEntityType.Payment, payment.Id, provider, payment,
            $"payment:{payment.Id}");

    public AccountingSyncItem MapVatReturn(AccountingVatReturnDto vat, AccountingProviderKind provider) =>
        Create(vat.CompanyId, AccountingEntityType.VatReturn, Guid.NewGuid(), provider, vat,
            $"vat:{vat.PeriodStart:yyyyMM}:{vat.PeriodEnd:yyyyMM}");

    public AccountingSyncItem MapSupplier(AccountingPartyDto supplier, AccountingProviderKind provider) =>
        Create(supplier.CompanyId, AccountingEntityType.Supplier, supplier.Id, provider, supplier,
            $"supplier:{supplier.Id}");

    public AccountingSyncItem MapContractor(AccountingPartyDto contractor, AccountingProviderKind provider) =>
        Create(contractor.CompanyId, AccountingEntityType.Contractor, contractor.Id, provider, contractor,
            $"contractor:{contractor.Id}");

    public AccountingSyncItem MapPayrollJournal(AccountingPayrollJournalDto journal, AccountingProviderKind provider) =>
        Create(journal.CompanyId, AccountingEntityType.PayrollJournal, journal.PaymentId, provider, journal,
            $"payroll:{journal.PaymentId}");

    public AccountingSyncItem MapExpense(AccountingExpenseDto expense, AccountingProviderKind provider) =>
        Create(expense.CompanyId, AccountingEntityType.Expense, expense.Id, provider, expense,
            $"expense:{expense.Id}");

    public AccountingSyncItem MapLedgerTransaction(AccountingLedgerTransactionDto transaction, AccountingProviderKind provider) =>
        Create(transaction.CompanyId, AccountingEntityType.LedgerTransaction, transaction.Id, provider, transaction,
            $"ledger:{transaction.Id}");

    private static AccountingSyncItem Create<T>(
        Guid companyId,
        AccountingEntityType entityType,
        Guid sourceId,
        AccountingProviderKind provider,
        T payload,
        string idempotencyKey) => new()
    {
        CompanyId = companyId,
        EntityType = entityType,
        SourceEntityId = sourceId,
        Provider = provider,
        Direction = AccountingSyncDirection.Outbound,
        PayloadJson = JsonSerializer.Serialize(payload, JsonOptions),
        IdempotencyKey = idempotencyKey,
    };
}
