namespace KaiFlow.Accounting;

public sealed class AccountingSyncItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CompanyId { get; set; }
    public AccountingEntityType EntityType { get; set; }
    public Guid SourceEntityId { get; set; }
    public AccountingSyncDirection Direction { get; set; } = AccountingSyncDirection.Outbound;
    public AccountingSyncStatus Status { get; set; } = AccountingSyncStatus.Pending;
    public AccountingProviderKind Provider { get; set; } = AccountingProviderKind.Manual;
    public string? ExternalId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
    public string? IdempotencyKey { get; set; }
}

public sealed class AccountingSyncAuditEntry
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CompanyId { get; set; }
    public Guid SyncItemId { get; set; }
    public AccountingEntityType EntityType { get; set; }
    public AccountingProviderKind Provider { get; set; }
    public AccountingSyncDirection Direction { get; set; }
    public AccountingSyncStatus Status { get; set; }
    public string Action { get; set; } = "";
    public string? Detail { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

public sealed class AccountingSyncResult
{
    public Guid SyncItemId { get; set; }
    public AccountingSyncStatus Status { get; set; }
    public string? ExternalId { get; set; }
    public string? Error { get; set; }
}

public sealed class AccountingReconciliationSummary
{
    public int Matched { get; set; }
    public int Unmatched { get; set; }
    public int Conflicts { get; set; }
}
