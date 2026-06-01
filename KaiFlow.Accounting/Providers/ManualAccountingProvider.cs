namespace KaiFlow.Accounting.Providers;

/// <summary>
/// Default no-op provider — marks items as skipped until Xero/Sage/QuickBooks is configured.
/// </summary>
public sealed class ManualAccountingProvider : IAccountingProvider
{
    public AccountingProviderKind Kind => AccountingProviderKind.Manual;
    public bool SupportsInbound => false;

    public Task<IReadOnlyList<AccountingSyncResult>> PushBatchAsync(
        IReadOnlyList<AccountingSyncItem> items,
        CancellationToken cancellationToken = default)
    {
        IReadOnlyList<AccountingSyncResult> results = items
            .Select(i => new AccountingSyncResult
            {
                SyncItemId = i.Id,
                Status = AccountingSyncStatus.Skipped,
                Error = "Manual provider — configure Xero, Sage, or QuickBooks to sync.",
            })
            .ToList();
        return Task.FromResult(results);
    }

    public Task<IReadOnlyList<AccountingSyncItem>> PullBatchAsync(
        Guid companyId,
        AccountingEntityType entityType,
        DateTime? sinceUtc = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<AccountingSyncItem>>([]);
}
