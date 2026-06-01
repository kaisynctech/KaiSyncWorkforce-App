using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models.Platform;

namespace KaiFlow.Timesheets.Services.Platform;

public interface IUsageMeteringService
{
    Task RecordEventAsync(Guid companyId, string metricKey, double increment = 1, CancellationToken ct = default);
    Task FlushMonthlySnapshotAsync(Guid companyId, CancellationToken ct = default);
    Task<SaasUsageSnapshot?> GetCurrentMonthSnapshotAsync(Guid companyId, CancellationToken ct = default);
    Task<Dictionary<string, double>> GetCurrentMetricsAsync(Guid companyId, CancellationToken ct = default);
}

/// <summary>Tracks platform usage metrics and persists monthly snapshots.</summary>
public sealed class UsageMeteringService : IUsageMeteringService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;
    private readonly object _lock = new();
    private readonly Dictionary<(Guid CompanyId, string Key), double> _buffer = [];

    public UsageMeteringService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public Task RecordEventAsync(Guid companyId, string metricKey, double increment = 1, CancellationToken ct = default)
    {
        lock (_lock)
        {
            var key = (companyId, metricKey);
            _buffer[key] = _buffer.GetValueOrDefault(key) + increment;
        }
        _telemetry.LogEvent("usage_metric", new() { ["metric"] = metricKey, ["company_id"] = companyId.ToString() });
        return Task.CompletedTask;
    }

    public async Task FlushMonthlySnapshotAsync(Guid companyId, CancellationToken ct = default)
    {
        Dictionary<string, double> metrics;
        lock (_lock)
        {
            metrics = _buffer
                .Where(kv => kv.Key.CompanyId == companyId)
                .ToDictionary(kv => kv.Key.Key, kv => kv.Value);
            foreach (var k in _buffer.Keys.Where(k => k.CompanyId == companyId).ToList())
                _buffer.Remove(k);
        }

        if (metrics.Count == 0)
        {
            // Still capture point-in-time counts
            metrics = await BuildPointInTimeMetricsAsync(companyId);
        }
        else
        {
            var point = await BuildPointInTimeMetricsAsync(companyId);
            foreach (var (k, v) in point)
                metrics[k] = metrics.GetValueOrDefault(k) + v;
        }

        var period = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        await _storage.UpsertSaasUsageSnapshotAsync(companyId, period, metrics);
    }

    public Task<SaasUsageSnapshot?> GetCurrentMonthSnapshotAsync(Guid companyId, CancellationToken ct = default)
    {
        var period = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        return _storage.GetSaasUsageSnapshotAsync(companyId, period);
    }

    public async Task<Dictionary<string, double>> GetCurrentMetricsAsync(Guid companyId, CancellationToken ct = default)
    {
        var snap = await GetCurrentMonthSnapshotAsync(companyId, ct);
        if (snap?.MetricsJson is null) return await BuildPointInTimeMetricsAsync(companyId);

        return snap.MetricsJson.ToDictionary(
            kv => kv.Key,
            kv => kv.Value switch
            {
                double d => d,
                long l => l,
                int i => i,
                System.Text.Json.JsonElement je when je.TryGetDouble(out var d) => d,
                _ => double.TryParse(kv.Value?.ToString(), out var p) ? p : 0,
            });
    }

    private async Task<Dictionary<string, double>> BuildPointInTimeMetricsAsync(Guid companyId)
    {
        var employees = await _storage.GetEmployeesAsync(companyId);
        var active = employees.Count(e => e.IsActive);
        return new Dictionary<string, double>
        {
            ["active_employees"] = active,
        };
    }
}

public interface IOnboardingService
{
    Task<IReadOnlyList<SaasOnboardingProgress>> GetProgressAsync(Guid companyId, CancellationToken ct = default);
    Task MarkStepCompleteAsync(Guid companyId, string stepKey, CancellationToken ct = default);
    Task<double> GetCompletionPercentAsync(Guid companyId, CancellationToken ct = default);
    Task<bool> IsOnboardingCompleteAsync(Guid companyId, CancellationToken ct = default);
}

public sealed class OnboardingService : IOnboardingService
{
    private readonly IStorageService _storage;

    public OnboardingService(IStorageService storage) => _storage = storage;

    public async Task<IReadOnlyList<SaasOnboardingProgress>> GetProgressAsync(Guid companyId, CancellationToken ct = default) =>
        await _storage.GetSaasOnboardingProgressAsync(companyId);

    public Task MarkStepCompleteAsync(Guid companyId, string stepKey, CancellationToken ct = default) =>
        _storage.UpsertSaasOnboardingStepAsync(companyId, stepKey, true);

    public async Task<double> GetCompletionPercentAsync(Guid companyId, CancellationToken ct = default)
    {
        var progress = await GetProgressAsync(companyId, ct);
        var total = SaasFeatureCodes.OnboardingSteps.Length;
        var done = progress.Count(p => p.IsCompleted);
        return total > 0 ? (double)done / total * 100 : 0;
    }

    public async Task<bool> IsOnboardingCompleteAsync(Guid companyId, CancellationToken ct = default) =>
        await GetCompletionPercentAsync(companyId, ct) >= 100;
}

public interface IPlatformSupportService
{
    Task<TenantHealthScore> ComputeHealthScoreAsync(Guid companyId, CancellationToken ct = default);
    Task<List<SaasSupportNote>> GetSupportNotesAsync(Guid companyId, CancellationToken ct = default);
    Task AddSupportNoteAsync(Guid companyId, string note, string severity = "info", CancellationToken ct = default);
}

public sealed class PlatformSupportService : IPlatformSupportService
{
    private readonly IStorageService _storage;
    private readonly IFeatureAccessService _features;

    public PlatformSupportService(IStorageService storage, IFeatureAccessService features)
    {
        _storage = storage;
        _features = features;
    }

    public async Task<TenantHealthScore> ComputeHealthScoreAsync(Guid companyId, CancellationToken ct = default)
    {
        try
        {
            var rpc = await _storage.GetPlatformCustomerHealthAsync(companyId, ct);
            if (rpc is not null) return rpc;
        }
        catch { /* fallback below */ }

        var score = 100;
        var issues = new List<string>();

        await _features.RefreshAsync(companyId, ct);
        var sub = _features.CurrentSubscription;
        if (sub is { IsActive: false })
        {
            score -= 30;
            issues.Add($"Subscription {sub.SubscriptionStatus}");
        }

        if (sub is not null && sub.RemainingCapacity <= 0)
        {
            score -= 15;
            issues.Add("Employee limit reached");
        }

        var employees = await _storage.GetEmployeesAsync(companyId);
        if (employees.Count == 0)
        {
            score -= 10;
            issues.Add("No employees configured");
        }

        score = Math.Clamp(score, 0, 100);
        return new TenantHealthScore
        {
            CompanyId = companyId,
            Score = score,
            Grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : "D",
            Issues = issues,
        };
    }

    public Task<List<SaasSupportNote>> GetSupportNotesAsync(Guid companyId, CancellationToken ct = default) =>
        _storage.GetSaasSupportNotesAsync(companyId);

    public Task AddSupportNoteAsync(Guid companyId, string note, string severity = "info", CancellationToken ct = default) =>
        _storage.AddSaasSupportNoteAsync(companyId, note, severity);
}

public interface IReleaseManagementService
{
    Task<bool> IsFeatureRolledOutAsync(Guid companyId, string featureCode, string appVersion, CancellationToken ct = default);
    Task RecordAppVersionAsync(Guid companyId, string appVersion, string? platform = null, CancellationToken ct = default);
}

public sealed class ReleaseManagementService : IReleaseManagementService
{
    private readonly IStorageService _storage;

    public ReleaseManagementService(IStorageService storage) => _storage = storage;

    public async Task<bool> IsFeatureRolledOutAsync(Guid companyId, string featureCode, string appVersion, CancellationToken ct = default)
    {
        var rollouts = await _storage.GetSaasReleaseRolloutsAsync();
        var active = rollouts.Where(r => r.IsActive && r.FeatureCode == featureCode).ToList();
        if (active.Count == 0) return true;

        foreach (var r in active)
        {
            // Simplified: if company in target list or stage is ga, allow
            if (r.RolloutStage == "ga") return true;
        }
        return false;
    }

    public Task RecordAppVersionAsync(Guid companyId, string appVersion, string? platform = null, CancellationToken ct = default) =>
        _storage.UpsertCompanyAppVersionAsync(companyId, appVersion, platform);
}

public interface IPlatformObservabilityService
{
    void TrackDuration(string operation, TimeSpan duration, Dictionary<string, string>? props = null);
    void TrackRpcLatency(string rpcName, TimeSpan duration, bool success);
    void TrackPlatformAction(string action, Dictionary<string, string>? props = null);
}

public sealed class PlatformObservabilityService : IPlatformObservabilityService
{
    private readonly AppTelemetry _telemetry;

    public PlatformObservabilityService(AppTelemetry telemetry) => _telemetry = telemetry;

    public void TrackDuration(string operation, TimeSpan duration, Dictionary<string, string>? props = null)
    {
        var p = props ?? new Dictionary<string, string>();
        p["duration_ms"] = duration.TotalMilliseconds.ToString("F0");
        _telemetry.LogEvent($"perf.{operation}", p);
    }

    public void TrackRpcLatency(string rpcName, TimeSpan duration, bool success) =>
        _telemetry.LogEvent("rpc_latency", new()
        {
            ["rpc"] = rpcName,
            ["duration_ms"] = duration.TotalMilliseconds.ToString("F0"),
            ["success"] = success.ToString(),
        });

    public void TrackPlatformAction(string action, Dictionary<string, string>? props = null) =>
        _telemetry.LogEvent($"platform.{action}", props);
}
