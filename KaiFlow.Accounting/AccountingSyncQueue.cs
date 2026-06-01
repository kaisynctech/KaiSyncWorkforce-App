namespace KaiFlow.Accounting;

/// <summary>In-memory retry queue — replace with durable store when server sync lands.</summary>
public sealed class AccountingSyncQueue
{
    private readonly object _lock = new();
    private readonly List<AccountingSyncItem> _items = [];

    public void Enqueue(AccountingSyncItem item)
    {
        lock (_lock)
        {
            if (!string.IsNullOrEmpty(item.IdempotencyKey)
                && _items.Any(i => i.IdempotencyKey == item.IdempotencyKey
                    && i.Status is AccountingSyncStatus.Pending or AccountingSyncStatus.InProgress))
                return;
            _items.Add(item);
        }
    }

    public void EnqueueRange(IEnumerable<AccountingSyncItem> items)
    {
        foreach (var item in items)
            Enqueue(item);
    }

    public IReadOnlyList<AccountingSyncItem> PeekPending(Guid companyId, AccountingProviderKind provider, int max = 25)
    {
        lock (_lock)
        {
            return _items
                .Where(i => i.CompanyId == companyId
                    && i.Provider == provider
                    && i.Status == AccountingSyncStatus.Pending)
                .OrderBy(i => i.CreatedAt)
                .Take(max)
                .ToList();
        }
    }

    public IReadOnlyList<AccountingSyncItem> GetByCompany(Guid companyId, int limit = 100)
    {
        lock (_lock)
        {
            return _items
                .Where(i => i.CompanyId == companyId)
                .OrderByDescending(i => i.CreatedAt)
                .Take(limit)
                .ToList();
        }
    }

    public void Update(AccountingSyncResult result)
    {
        lock (_lock)
        {
            var item = _items.FirstOrDefault(i => i.Id == result.SyncItemId);
            if (item is null) return;
            item.Status = result.Status;
            item.ExternalId = result.ExternalId ?? item.ExternalId;
            item.LastError = result.Error;
            if (result.Status is AccountingSyncStatus.Succeeded or AccountingSyncStatus.Skipped)
                item.CompletedAt = DateTime.UtcNow;
            else if (result.Status == AccountingSyncStatus.Failed)
                item.AttemptCount++;
        }
    }

    public int PendingCount(Guid companyId) =>
        GetByCompany(companyId, int.MaxValue).Count(i => i.Status == AccountingSyncStatus.Pending);
}
