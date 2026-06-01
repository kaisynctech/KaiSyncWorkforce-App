namespace KaiFlow.Accounting;

public enum AccountingProviderKind
{
    Manual = 0,
    Xero = 1,
    Sage = 2,
    QuickBooks = 3,
}

public enum AccountingSyncDirection
{
    Outbound = 0,
    Inbound = 1,
}

public enum AccountingSyncStatus
{
    Pending = 0,
    InProgress = 1,
    Succeeded = 2,
    Failed = 3,
    Conflict = 4,
    Skipped = 5,
}

public enum AccountingEntityType
{
    Invoice = 0,
    Payment = 1,
    VatReturn = 2,
    Supplier = 3,
    Contractor = 4,
    PayrollJournal = 5,
    Expense = 6,
    LedgerTransaction = 7,
}
