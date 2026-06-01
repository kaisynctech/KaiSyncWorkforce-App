namespace KaiFlow.Accounting;

/// <summary>
/// Maps KaiFlow domain records to provider-neutral sync payloads.
/// Finance pages must not reference provider SDKs — only this mapper.
/// </summary>
public interface IAccountingExportMapper
{
    AccountingSyncItem MapInvoice(AccountingInvoiceDto invoice, AccountingProviderKind provider);
    AccountingSyncItem MapPayment(AccountingPaymentDto payment, AccountingProviderKind provider);
    AccountingSyncItem MapVatReturn(AccountingVatReturnDto vat, AccountingProviderKind provider);
    AccountingSyncItem MapSupplier(AccountingPartyDto supplier, AccountingProviderKind provider);
    AccountingSyncItem MapContractor(AccountingPartyDto contractor, AccountingProviderKind provider);
    AccountingSyncItem MapPayrollJournal(AccountingPayrollJournalDto journal, AccountingProviderKind provider);
    AccountingSyncItem MapExpense(AccountingExpenseDto expense, AccountingProviderKind provider);
    AccountingSyncItem MapLedgerTransaction(AccountingLedgerTransactionDto transaction, AccountingProviderKind provider);
}

public sealed class AccountingInvoiceDto
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Number { get; set; } = "";
    public DateOnly IssueDate { get; set; }
    public DateOnly? DueDate { get; set; }
    public decimal Subtotal { get; set; }
    public decimal VatAmount { get; set; }
    public decimal Total { get; set; }
    public string Status { get; set; } = "";
    public string? ClientName { get; set; }
    public string Currency { get; set; } = "ZAR";
}

public sealed class AccountingPaymentDto
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public Guid? InvoiceId { get; set; }
    public decimal Amount { get; set; }
    public DateOnly PaymentDate { get; set; }
    public string? Method { get; set; }
    public string? Reference { get; set; }
}

public sealed class AccountingVatReturnDto
{
    public Guid CompanyId { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public decimal OutputVat { get; set; }
    public decimal InputVat { get; set; }
    public decimal NetVat { get; set; }
}

public sealed class AccountingPartyDto
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Name { get; set; } = "";
    public string? TaxNumber { get; set; }
    public string? Email { get; set; }
}

public sealed class AccountingPayrollJournalDto
{
    public Guid CompanyId { get; set; }
    public Guid PaymentId { get; set; }
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public decimal GrossPay { get; set; }
    public decimal NetPay { get; set; }
    public decimal EmployerContributions { get; set; }
}

public sealed class AccountingExpenseDto
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public DateOnly ExpenseDate { get; set; }
    public string Category { get; set; } = "";
}

public sealed class AccountingLedgerTransactionDto
{
    public Guid Id { get; set; }
    public Guid CompanyId { get; set; }
    public DateOnly TransactionDate { get; set; }
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    public bool IsIncoming { get; set; }
    public string? Category { get; set; }
}
