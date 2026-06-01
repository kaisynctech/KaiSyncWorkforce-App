namespace KaiFlow.Accounting;

/// <summary>
/// Orchestrates outbound sync, future inbound pull, reconciliation, and audit.
/// Finance module enqueues via this service — never calls Xero/Sage directly.
/// </summary>
public sealed class AccountingSyncService
{
    private readonly AccountingSyncQueue _queue;
    private readonly AccountingSyncAudit _audit;
    private readonly IReadOnlyDictionary<AccountingProviderKind, IAccountingProvider> _providers;

    public AccountingSyncService(
        AccountingSyncQueue queue,
        AccountingSyncAudit audit,
        IEnumerable<IAccountingProvider> providers)
    {
        _queue = queue;
        _audit = audit;
        _providers = providers.ToDictionary(p => p.Kind);
    }

    public AccountingSyncQueue Queue => _queue;
    public AccountingSyncAudit Audit => _audit;

    public void EnqueueOutbound(AccountingSyncItem item)
    {
        item.Direction = AccountingSyncDirection.Outbound;
        if (item.Status == default)
            item.Status = AccountingSyncStatus.Pending;
        _queue.Enqueue(item);
        _audit.Record(item.CompanyId, item.Id, item.EntityType, item.Provider,
            item.Direction, item.Status, "enqueued");
    }

    public void EnqueueOutboundRange(IEnumerable<AccountingSyncItem> items)
    {
        foreach (var item in items)
            EnqueueOutbound(item);
    }

    public async Task<int> ProcessOutboundBatchAsync(
        Guid companyId,
        AccountingProviderKind provider,
        CancellationToken cancellationToken = default)
    {
        if (!_providers.TryGetValue(provider, out var accountingProvider))
            throw new InvalidOperationException($"No accounting provider registered for {provider}.");

        var batch = _queue.PeekPending(companyId, provider);
        if (batch.Count == 0) return 0;

        foreach (var item in batch)
        {
            item.Status = AccountingSyncStatus.InProgress;
            _audit.Record(companyId, item.Id, item.EntityType, provider,
                AccountingSyncDirection.Outbound, AccountingSyncStatus.InProgress, "processing");
        }

        var results = await accountingProvider.PushBatchAsync(batch, cancellationToken);
        foreach (var result in results)
        {
            _queue.Update(result);
            var item = batch.FirstOrDefault(b => b.Id == result.SyncItemId);
            _audit.Record(companyId, result.SyncItemId,
                item?.EntityType ?? AccountingEntityType.LedgerTransaction,
                provider, AccountingSyncDirection.Outbound, result.Status,
                result.Status == AccountingSyncStatus.Succeeded ? "pushed" : "push_failed",
                result.Error);
        }

        return results.Count(r => r.Status == AccountingSyncStatus.Succeeded);
    }

    public async Task<IReadOnlyList<AccountingSyncItem>> PullInboundBatchAsync(
        Guid companyId,
        AccountingProviderKind provider,
        AccountingEntityType entityType,
        DateTime? sinceUtc = null,
        CancellationToken cancellationToken = default)
    {
        if (!_providers.TryGetValue(provider, out var accountingProvider))
            throw new InvalidOperationException($"No accounting provider registered for {provider}.");
        if (!accountingProvider.SupportsInbound)
            return [];

        var pulled = await accountingProvider.PullBatchAsync(companyId, entityType, sinceUtc, cancellationToken);
        foreach (var item in pulled)
        {
            item.Direction = AccountingSyncDirection.Inbound;
            _queue.Enqueue(item);
            _audit.Record(companyId, item.Id, item.EntityType, provider,
                AccountingSyncDirection.Inbound, item.Status, "pulled");
        }
        return pulled;
    }

    public AccountingReconciliationSummary Reconcile(
        Guid companyId,
        IReadOnlyList<AccountingSyncItem> localItems,
        IReadOnlyList<AccountingSyncItem> remoteItems)
    {
        var summary = new AccountingReconciliationSummary();
        var remoteByKey = remoteItems
            .Where(r => !string.IsNullOrEmpty(r.ExternalId))
            .ToDictionary(r => r.ExternalId!);

        foreach (var local in localItems.Where(l => l.CompanyId == companyId))
        {
            if (local.ExternalId is null)
            {
                summary.Unmatched++;
                continue;
            }

            if (!remoteByKey.TryGetValue(local.ExternalId, out var remote))
            {
                summary.Unmatched++;
                continue;
            }

            if (local.PayloadJson != remote.PayloadJson)
            {
                summary.Conflicts++;
                _audit.Record(companyId, local.Id, local.EntityType, local.Provider,
                    AccountingSyncDirection.Outbound, AccountingSyncStatus.Conflict, "reconcile_conflict");
            }
            else
            {
                summary.Matched++;
            }
        }

        return summary;
    }

    public IAccountingProvider? GetProvider(AccountingProviderKind kind) =>
        _providers.TryGetValue(kind, out var p) ? p : null;
}
