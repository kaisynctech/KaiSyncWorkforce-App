namespace KaiFlow.Accounting;

/// <summary>
/// Provider contract for outbound push and future inbound pull. Implementations
/// (Xero, Sage, QuickBooks) live outside Finance — registered at app startup.
/// </summary>
public interface IAccountingProvider
{
    AccountingProviderKind Kind { get; }
    bool SupportsInbound { get; }

    Task<IReadOnlyList<AccountingSyncResult>> PushBatchAsync(
        IReadOnlyList<AccountingSyncItem> items,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AccountingSyncItem>> PullBatchAsync(
        Guid companyId,
        AccountingEntityType entityType,
        DateTime? sinceUtc = null,
        CancellationToken cancellationToken = default);
}
