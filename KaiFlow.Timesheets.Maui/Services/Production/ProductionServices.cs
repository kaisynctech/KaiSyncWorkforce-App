using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Production;

namespace KaiFlow.Timesheets.Services.Production;

public interface IVersionService
{
    (string Version, int BuildNumber) GetInstalledVersion();
    int CompareVersions(string left, string right);
    bool IsBelowMinimum(string installed, string? minimumRequired);
    Task<AppVersionInfo?> GetLatestVersionAsync(CancellationToken ct = default);
    Task<UpdateCheckResult> CheckForUpdateAsync(CancellationToken ct = default);
}

public sealed class VersionService : IVersionService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;

    public VersionService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public (string Version, int BuildNumber) GetInstalledVersion()
        => (AppInfo.Current.VersionString, int.TryParse(AppInfo.Current.BuildString, out var b) ? b : 0);

    public int CompareVersions(string left, string right)
    {
        try
        {
            return Version.Parse(Normalize(left)).CompareTo(Version.Parse(Normalize(right)));
        }
        catch
        {
            return string.Compare(left, right, StringComparison.OrdinalIgnoreCase);
        }
    }

    public bool IsBelowMinimum(string installed, string? minimumRequired)
    {
        if (string.IsNullOrWhiteSpace(minimumRequired)) return false;
        return CompareVersions(installed, minimumRequired) < 0;
    }

    public Task<AppVersionInfo?> GetLatestVersionAsync(CancellationToken ct = default)
        => _storage.GetLatestAppVersionAsync(DeviceInfo.Current.Platform.ToString(), ct);

    public async Task<UpdateCheckResult> CheckForUpdateAsync(CancellationToken ct = default)
    {
        var (installed, build) = GetInstalledVersion();
        var result = new UpdateCheckResult
        {
            InstalledVersion = installed,
            InstalledBuild = build,
        };

        try
        {
            var latest = await GetLatestVersionAsync(ct);
            result.Latest = latest;
            if (latest is null || string.IsNullOrWhiteSpace(latest.Version))
                return result;

            var belowMin = IsBelowMinimum(installed, latest.MinimumRequiredVersion);
            var newerAvailable = CompareVersions(installed, latest.Version) < 0
                || (installed == latest.Version && build < latest.BuildNumber);

            result.UpdateAvailable = belowMin || newerAvailable;
            result.IsMandatory = belowMin || (latest.IsMandatory && result.UpdateAvailable);
            result.StoreUrl = latest.DownloadUrl;

            _telemetry.LogEvent("update_check", new()
            {
                ["installed"] = installed,
                ["latest"] = latest.Version,
                ["mandatory"] = result.IsMandatory.ToString(),
                ["available"] = result.UpdateAvailable.ToString(),
            });
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning("update_check_failed", nameof(VersionService),
                new() { ["error"] = ex.Message });
        }

        return result;
    }

    private static string Normalize(string v)
    {
        var parts = v.Split('.');
        return parts.Length switch
        {
            1 => $"{v}.0.0",
            2 => $"{v}.0",
            _ => v,
        };
    }
}

public interface IFeatureFlagService
{
    Task RefreshAsync(Guid companyId, CancellationToken ct = default);
    bool IsEnabled(string featureName, bool defaultValue = false);
    Task SetFlagAsync(Guid companyId, string featureName, bool enabled, CancellationToken ct = default);
    IReadOnlyDictionary<string, bool> GetAllFlags();
}

public sealed class FeatureFlagService : IFeatureFlagService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;
    private readonly object _lock = new();
    private Guid _companyId;
    private Dictionary<string, bool> _flags = [];

    public FeatureFlagService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public async Task RefreshAsync(Guid companyId, CancellationToken ct = default)
    {
        var rows = await _storage.GetFeatureFlagsAsync(companyId, ct);
        lock (_lock)
        {
            _companyId = companyId;
            _flags = rows.ToDictionary(r => r.FeatureName, r => r.Enabled, StringComparer.OrdinalIgnoreCase);
        }
        _telemetry.LogEvent("feature_flags_loaded", new()
        {
            ["company_id"] = companyId.ToString(),
            ["count"] = rows.Count.ToString(),
        });
    }

    public bool IsEnabled(string featureName, bool defaultValue = false)
    {
        lock (_lock)
            return _flags.GetValueOrDefault(featureName, defaultValue);
    }

    public IReadOnlyDictionary<string, bool> GetAllFlags()
    {
        lock (_lock)
            return new Dictionary<string, bool>(_flags, StringComparer.OrdinalIgnoreCase);
    }

    public async Task SetFlagAsync(Guid companyId, string featureName, bool enabled, CancellationToken ct = default)
    {
        await _storage.UpsertFeatureFlagAsync(companyId, featureName, enabled, ct);
        lock (_lock)
            _flags[featureName] = enabled;
        _telemetry.LogEvent("feature_flag_set", new()
        {
            ["company_id"] = companyId.ToString(),
            ["feature"] = featureName,
            ["enabled"] = enabled.ToString(),
        });
    }
}

public interface ICompanySettingsService
{
    Task<CompanySettingsDto> GetAsync(Guid companyId, CancellationToken ct = default);
    Task<CompanySettingsDto> SaveAsync(Guid companyId, CompanySettingsDto settings, CancellationToken ct = default);
    Task SyncLegacyCompanyFieldsAsync(Company company, CancellationToken ct = default);
}

public sealed class CompanySettingsService : ICompanySettingsService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;

    public CompanySettingsService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public Task<CompanySettingsDto> GetAsync(Guid companyId, CancellationToken ct = default)
        => _storage.GetCompanySettingsAsync(companyId, ct);

    public async Task<CompanySettingsDto> SaveAsync(Guid companyId, CompanySettingsDto settings, CancellationToken ct = default)
    {
        var saved = await _storage.UpsertCompanySettingsAsync(companyId, settings, ct);
        _telemetry.LogEvent("company_settings_saved", new() { ["company_id"] = companyId.ToString() });
        return saved;
    }

    public async Task SyncLegacyCompanyFieldsAsync(Company company, CancellationToken ct = default)
    {
        var dto = await GetAsync(company.Id, ct);
        company.CustomSettings["annual_leave_days"] = dto.AnnualLeaveDays;
        company.CustomSettings["sick_leave_days"] = dto.SickLeaveDays;
        foreach (var (k, v) in dto.PayrollPreferences)
            company.CustomSettings[k] = v;
    }
}

public interface IBackupService
{
    Task<CompanyBackupRecord> CreateManualBackupAsync(Guid companyId, string? label = null, CancellationToken ct = default);
    Task<List<CompanyBackupRecord>> ListBackupsAsync(Guid companyId, int limit = 20, CancellationToken ct = default);
    Task<List<BackupJobRecord>> ListJobsAsync(Guid companyId, int limit = 20, CancellationToken ct = default);
    Task<BackupJobRecord> ScheduleBackupAsync(Guid companyId, string cronExpression, CancellationToken ct = default);
}

public sealed class BackupService : IBackupService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;

    public BackupService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public async Task<CompanyBackupRecord> CreateManualBackupAsync(Guid companyId, string? label = null, CancellationToken ct = default)
    {
        var backup = await _storage.CreateCompanyBackupAsync(companyId, label, ct);
        _telemetry.LogEvent("backup_created", new()
        {
            ["company_id"] = companyId.ToString(),
            ["backup_id"] = backup.Id.ToString(),
        });
        return backup;
    }

    public Task<List<CompanyBackupRecord>> ListBackupsAsync(Guid companyId, int limit = 20, CancellationToken ct = default)
        => _storage.GetCompanyBackupsAsync(companyId, limit, ct);

    public Task<List<BackupJobRecord>> ListJobsAsync(Guid companyId, int limit = 20, CancellationToken ct = default)
        => _storage.GetBackupJobsAsync(companyId, limit, ct);

    public async Task<BackupJobRecord> ScheduleBackupAsync(Guid companyId, string cronExpression, CancellationToken ct = default)
    {
        var job = await _storage.CreateScheduledBackupJobAsync(companyId, cronExpression, ct);
        _telemetry.LogEvent("backup_scheduled", new()
        {
            ["company_id"] = companyId.ToString(),
            ["job_id"] = job.Id.ToString(),
        });
        return job;
    }
}
