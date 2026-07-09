using System.Text.Json;
using KaiFlow.Timesheets.Models.Production;
using Op = Supabase.Postgrest.Constants.Operator;
using Ord = Supabase.Postgrest.Constants.Ordering;

namespace KaiFlow.Timesheets.Services;

/// <summary>Production ops: versioning, feature flags, settings, backups, errors.</summary>
public partial class SupabaseStorageService
{
    public async Task<AppVersionInfo?> GetLatestAppVersionAsync(string platform, CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("get_latest_app_version", new Dictionary<string, object>
            {
                ["p_platform"] = platform,
            });
            if (string.IsNullOrWhiteSpace(result.Content) || result.Content is "null" or "{}")
                return null;
            return ParseAppVersionInfo(JsonSerializer.Deserialize<JsonElement>(result.Content));
        }
        catch
        {
            return null;
        }
    }

    public async Task<List<FeatureFlagRecord>> GetFeatureFlagsAsync(Guid companyId, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<FeatureFlagRecord>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Get();
        return result.Models ?? [];
    }

    public async Task UpsertFeatureFlagAsync(Guid companyId, string featureName, bool enabled, CancellationToken ct = default)
    {
        var existing = await _supabase
            .From<FeatureFlagRecord>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Filter("feature_name", Op.Equals, featureName)
            .Get();

        var row = existing.Models?.FirstOrDefault();
        if (row is null)
        {
            await _supabase.From<FeatureFlagRecord>().Insert(new FeatureFlagRecord
            {
                CompanyId = companyId,
                FeatureName = featureName,
                Enabled = enabled,
                UpdatedAt = DateTime.UtcNow,
            });
            return;
        }

        row.Enabled = enabled;
        row.UpdatedAt = DateTime.UtcNow;
        await _supabase.From<FeatureFlagRecord>().Update(row);
    }

    public async Task<CompanySettingsDto> GetCompanySettingsAsync(Guid companyId, CancellationToken ct = default)
    {
        try
        {
            var result = await _supabase.Rpc("get_company_settings", new Dictionary<string, object>
            {
                ["p_company_id"] = companyId.ToString(),
            });
        if (string.IsNullOrWhiteSpace(result.Content) || result.Content is "null")
            return new CompanySettingsDto { CompanyId = companyId };

        return ParseCompanySettings(JsonSerializer.Deserialize<JsonElement>(result.Content!));
        }
        catch
        {
            return new CompanySettingsDto { CompanyId = companyId };
        }
    }

    public async Task<CompanySettingsDto> UpsertCompanySettingsAsync(Guid companyId, CompanySettingsDto settings, CancellationToken ct = default)
    {
        var payload = new Dictionary<string, object?>
        {
            ["timezone"] = settings.Timezone,
            ["currency"] = settings.Currency,
            ["vat_rate"] = settings.VatRate,
            ["branding"] = settings.Branding,
            ["logo_url"] = settings.LogoUrl,
            ["primary_color"] = settings.PrimaryColor,
            ["secondary_color"] = settings.SecondaryColor,
            ["payroll_preferences"] = settings.PayrollPreferences,
            ["leave_settings"] = settings.LeaveSettings,
        };

        var result = await _supabase.Rpc("upsert_company_settings", new Dictionary<string, object>
        {
            ["p_company_id"] = companyId.ToString(),
            ["p_payload"] = JsonSerializer.Serialize(payload),
        });

        return ParseCompanySettings(JsonSerializer.Deserialize<JsonElement>(result.Content!));
    }

    public async Task<CompanyBackupRecord> CreateCompanyBackupAsync(Guid companyId, string? label, CancellationToken ct = default)
    {
        var job = new BackupJobRecord
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JobType = "manual",
            Status = "running",
            StartedAt = DateTime.UtcNow,
        };
        await _supabase.From<BackupJobRecord>().Insert(job);

        try
        {
            var employees = await GetEmployeesAsync(companyId);
            var branches = await GetBranchesAsync(companyId);
            var recordCounts = new Dictionary<string, object>
            {
                ["employees"] = employees.Count,
                ["branches"] = branches.Count,
                ["exported_at"] = DateTime.UtcNow.ToString("O"),
            };

            var backup = new CompanyBackupRecord
            {
                Id = Guid.NewGuid(),
                CompanyId = companyId,
                BackupJobId = job.Id,
                Label = string.IsNullOrWhiteSpace(label)
                    ? $"Data snapshot {DateTime.UtcNow:yyyy-MM-dd HH:mm}"
                    : label.Trim(),
                StoragePath = null,
                SizeBytes = null,
                RecordCounts = recordCounts,
                Metadata = new Dictionary<string, object>
                {
                    ["type"] = "metadata_only",
                    ["exported_at"] = DateTime.UtcNow.ToString("O"),
                },
                IsRestorable = false,
                CreatedAt = DateTime.UtcNow,
            };

            await _supabase.From<CompanyBackupRecord>().Insert(backup);

            job.Status = "completed";
            job.CompletedAt = DateTime.UtcNow;
            await _supabase.From<BackupJobRecord>().Update(job);

            return backup;
        }
        catch (Exception ex)
        {
            job.Status = "failed";
            job.CompletedAt = DateTime.UtcNow;
            job.ErrorMessage = ex.Message;
            await _supabase.From<BackupJobRecord>().Update(job);
            throw;
        }
    }

    public async Task<List<CompanyBackupRecord>> GetCompanyBackupsAsync(Guid companyId, int limit = 20, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<CompanyBackupRecord>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get();
        return result.Models ?? [];
    }

    public async Task<List<BackupJobRecord>> GetBackupJobsAsync(Guid companyId, int limit = 20, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<BackupJobRecord>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get();
        return result.Models ?? [];
    }

    public async Task<BackupJobRecord> CreateScheduledBackupJobAsync(Guid companyId, string cronExpression, CancellationToken ct = default)
    {
        var job = new BackupJobRecord
        {
            Id = Guid.NewGuid(),
            CompanyId = companyId,
            JobType = "scheduled",
            Status = "pending",
            ScheduleCron = cronExpression,
        };
        await _supabase.From<BackupJobRecord>().Insert(job);
        return job;
    }

    public async Task<CompanyExportJobResult> InvokeGenerateCompanyExportAsync(Guid companyId, CancellationToken ct = default)
    {
        var responseJson = await _supabase.Functions.Invoke(
            "generate-company-export",
            System.Text.Json.JsonSerializer.Serialize(new { company_id = companyId.ToString() }));
        if (string.IsNullOrWhiteSpace(responseJson))
            throw new InvalidOperationException("Export function returned no response.");
        using var doc = System.Text.Json.JsonDocument.Parse(responseJson);
        var root = doc.RootElement;
        if (!root.TryGetProperty("download_url", out var urlEl) || !root.TryGetProperty("job_id", out var jobEl))
            throw new InvalidOperationException("Export function response missing required fields.");
        var jobId = Guid.Parse(jobEl.GetString()!);
        var downloadUrl = urlEl.GetString()!;
        var expiresAt = root.TryGetProperty("expires_at", out var expEl)
            ? DateTime.Parse(expEl.GetString()!, null, System.Globalization.DateTimeStyles.RoundtripKind)
            : DateTime.UtcNow.AddHours(24);
        return new CompanyExportJobResult(jobId, downloadUrl, expiresAt);
    }

    public async Task<List<CompanyExportJobRecord>> GetExportJobsAsync(Guid companyId, int limit = 5, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<CompanyExportJobRecord>()
            .Filter("company_id", Supabase.Postgrest.Constants.Operator.Equals, companyId.ToString())
            .Order("created_at", Supabase.Postgrest.Constants.Ordering.Descending)
            .Limit(limit)
            .Get();
        return result.Models ?? [];
    }

    public async Task LogApplicationErrorAsync(
        string? module,
        string? page,
        Exception ex,
        Guid? companyId = null,
        Guid? employeeId = null,
        Dictionary<string, string>? metadata = null,
        CancellationToken ct = default)
    {
        try
        {
            var metaObj = metadata?.ToDictionary(kv => kv.Key, kv => (object)kv.Value)
                ?? new Dictionary<string, object>();

            await _supabase.Rpc("log_application_error", new Dictionary<string, object>
            {
                ["p_module"] = module ?? "",
                ["p_page"] = page ?? "",
                ["p_exception_type"] = ex.GetType().Name,
                ["p_message"] = ex.Message,
                ["p_stack_trace"] = ex.StackTrace ?? "",
                ["p_company_id"] = companyId?.ToString() ?? null!,
                ["p_employee_id"] = employeeId?.ToString() ?? null!,
                ["p_app_version"] = AppInfo.Current.VersionString,
                ["p_platform"] = DeviceInfo.Current.Platform.ToString(),
                ["p_metadata"] = JsonSerializer.Serialize(metaObj),
            });
        }
        catch (Exception logEx)
        {
            System.Diagnostics.Debug.WriteLine($"[ERROR] log_application_error failed: {logEx.Message}");
        }
    }

    public async Task<List<ApplicationErrorRecord>> GetApplicationErrorsAsync(Guid companyId, int limit = 50, CancellationToken ct = default)
    {
        var result = await _supabase
            .From<ApplicationErrorRecord>()
            .Filter("company_id", Op.Equals, companyId.ToString())
            .Order("created_at", Ord.Descending)
            .Limit(limit)
            .Get();
        return result.Models ?? [];
    }

    private static AppVersionInfo ParseAppVersionInfo(JsonElement json)
    {
        return new AppVersionInfo
        {
            Id = json.TryGetProperty("id", out var id) && Guid.TryParse(id.GetString(), out var gid) ? gid : Guid.Empty,
            Version = json.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "",
            BuildNumber = json.TryGetProperty("build_number", out var b) ? b.GetInt32() : 0,
            ReleaseDate = json.TryGetProperty("release_date", out var rd) && DateTime.TryParse(rd.GetString(), out var dt) ? dt : null,
            ReleaseNotes = json.TryGetProperty("release_notes", out var rn) ? rn.GetString() : null,
            MinimumRequiredVersion = json.TryGetProperty("minimum_required_version", out var min) ? min.GetString() : null,
            DownloadUrl = json.TryGetProperty("download_url", out var url) ? url.GetString() : null,
            IsMandatory = json.TryGetProperty("is_mandatory", out var m) && m.ValueKind == JsonValueKind.True,
        };
    }

    private static CompanySettingsDto ParseCompanySettings(JsonElement json)
    {
        var dto = new CompanySettingsDto
        {
            CompanyId = json.TryGetProperty("company_id", out var cid) && Guid.TryParse(cid.GetString(), out var g)
                ? g : Guid.Empty,
            Timezone = json.TryGetProperty("timezone", out var tz) ? tz.GetString() ?? "Africa/Johannesburg" : "Africa/Johannesburg",
            Currency = json.TryGetProperty("currency", out var cur) ? cur.GetString() ?? "ZAR" : "ZAR",
            VatRate = json.TryGetProperty("vat_rate", out var vr) && vr.TryGetDecimal(out var dec) ? dec : 15m,
            LogoUrl = json.TryGetProperty("logo_url", out var logo) ? logo.GetString() : null,
            PrimaryColor = json.TryGetProperty("primary_color", out var pc) ? pc.GetString() : null,
            SecondaryColor = json.TryGetProperty("secondary_color", out var sc) ? sc.GetString() : null,
        };

        if (json.TryGetProperty("branding", out var branding) && branding.ValueKind == JsonValueKind.Object)
            dto.Branding = JsonSerializer.Deserialize<Dictionary<string, object>>(branding.GetRawText()) ?? [];
        if (json.TryGetProperty("payroll_preferences", out var pp) && pp.ValueKind == JsonValueKind.Object)
            dto.PayrollPreferences = JsonSerializer.Deserialize<Dictionary<string, object>>(pp.GetRawText()) ?? [];
        if (json.TryGetProperty("leave_settings", out var ls) && ls.ValueKind == JsonValueKind.Object)
            dto.LeaveSettings = JsonSerializer.Deserialize<Dictionary<string, object>>(ls.GetRawText()) ?? [];

        return dto;
    }
}
