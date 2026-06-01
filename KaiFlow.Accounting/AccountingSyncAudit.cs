namespace KaiFlow.Accounting;

public sealed class AccountingSyncAudit
{
    private readonly object _lock = new();
    private readonly List<AccountingSyncAuditEntry> _entries = [];

    public void Record(
        Guid companyId,
        Guid syncItemId,
        AccountingEntityType entityType,
        AccountingProviderKind provider,
        AccountingSyncDirection direction,
        AccountingSyncStatus status,
        string action,
        string? detail = null)
    {
        lock (_lock)
        {
            _entries.Insert(0, new AccountingSyncAuditEntry
            {
                CompanyId = companyId,
                SyncItemId = syncItemId,
                EntityType = entityType,
                Provider = provider,
                Direction = direction,
                Status = status,
                Action = action,
                Detail = detail,
            });
            if (_entries.Count > 500)
                _entries.RemoveRange(500, _entries.Count - 500);
        }
    }

    public IReadOnlyList<AccountingSyncAuditEntry> GetRecent(Guid companyId, int limit = 50)
    {
        lock (_lock)
        {
            return _entries
                .Where(e => e.CompanyId == companyId)
                .Take(limit)
                .ToList();
        }
    }
}
