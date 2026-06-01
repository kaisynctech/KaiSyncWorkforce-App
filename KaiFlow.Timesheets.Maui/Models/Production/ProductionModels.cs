using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models.Production;

[Table("app_versions")]
public class AppVersionRecord : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("version")]
    public string Version { get; set; } = "";

    [Column("build_number")]
    public int BuildNumber { get; set; }

    [Column("release_date")]
    public DateTime ReleaseDate { get; set; }

    [Column("release_notes")]
    public string? ReleaseNotes { get; set; }

    [Column("minimum_required_version")]
    public string? MinimumRequiredVersion { get; set; }

    [Column("download_url")]
    public string? DownloadUrl { get; set; }

    [Column("download_url_android")]
    public string? DownloadUrlAndroid { get; set; }

    [Column("download_url_ios")]
    public string? DownloadUrlIos { get; set; }

    [Column("download_url_windows")]
    public string? DownloadUrlWindows { get; set; }

    [Column("is_mandatory")]
    public bool IsMandatory { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

/// <summary>DTO from get_latest_app_version RPC.</summary>
public class AppVersionInfo
{
    public Guid Id { get; set; }
    public string Version { get; set; } = "";
    public int BuildNumber { get; set; }
    public DateTime? ReleaseDate { get; set; }
    public string? ReleaseNotes { get; set; }
    public string? MinimumRequiredVersion { get; set; }
    public string? DownloadUrl { get; set; }
    public bool IsMandatory { get; set; }
}

public class UpdateCheckResult
{
    public bool UpdateAvailable { get; set; }
    public bool IsMandatory { get; set; }
    public AppVersionInfo? Latest { get; set; }
    public string InstalledVersion { get; set; } = "";
    public int InstalledBuild { get; set; }
    public string? StoreUrl { get; set; }
    public string Summary => UpdateAvailable
        ? IsMandatory
            ? $"Required update to v{Latest?.Version}"
            : $"Version {Latest?.Version} is available"
        : "You are on the latest version";
}

[Table("feature_flags")]
public class FeatureFlagRecord : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("feature_name")]
    public string FeatureName { get; set; } = "";

    [Column("enabled")]
    public bool Enabled { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }
}

[Table("company_settings")]
public class CompanySettingsRecord : BaseModel
{
    [PrimaryKey("company_id")]
    public Guid CompanyId { get; set; }

    [Column("timezone")]
    public string Timezone { get; set; } = "Africa/Johannesburg";

    [Column("currency")]
    public string Currency { get; set; } = "ZAR";

    [Column("vat_rate")]
    public decimal VatRate { get; set; } = 15m;

    [Column("branding")]
    public Dictionary<string, object> Branding { get; set; } = [];

    [Column("logo_url")]
    public string? LogoUrl { get; set; }

    [Column("primary_color")]
    public string? PrimaryColor { get; set; }

    [Column("secondary_color")]
    public string? SecondaryColor { get; set; }

    [Column("payroll_preferences")]
    public Dictionary<string, object> PayrollPreferences { get; set; } = [];

    [Column("leave_settings")]
    public Dictionary<string, object> LeaveSettings { get; set; } = [];

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }
}

public class CompanySettingsDto
{
    public Guid CompanyId { get; set; }
    public string Timezone { get; set; } = "Africa/Johannesburg";
    public string Currency { get; set; } = "ZAR";
    public decimal VatRate { get; set; } = 15m;
    public Dictionary<string, object> Branding { get; set; } = [];
    public string? LogoUrl { get; set; }
    public string? PrimaryColor { get; set; }
    public string? SecondaryColor { get; set; }
    public Dictionary<string, object> PayrollPreferences { get; set; } = [];
    public Dictionary<string, object> LeaveSettings { get; set; } = [];

    public int AnnualLeaveDays =>
        LeaveSettings.TryGetValue("annual_leave_days", out var v) && int.TryParse(v?.ToString(), out var d) ? d : 15;

    public int SickLeaveDays =>
        LeaveSettings.TryGetValue("sick_leave_days", out var v) && int.TryParse(v?.ToString(), out var d) ? d : 10;
}

[Table("backup_jobs")]
public class BackupJobRecord : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("job_type")]
    public string JobType { get; set; } = "manual";

    [Column("status")]
    public string Status { get; set; } = "pending";

    [Column("requested_by")]
    public Guid? RequestedBy { get; set; }

    [Column("schedule_cron")]
    public string? ScheduleCron { get; set; }

    [Column("started_at")]
    public DateTime? StartedAt { get; set; }

    [Column("completed_at")]
    public DateTime? CompletedAt { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

[Table("company_backups")]
public class CompanyBackupRecord : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("backup_job_id")]
    public Guid? BackupJobId { get; set; }

    [Column("label")]
    public string Label { get; set; } = "";

    [Column("storage_path")]
    public string? StoragePath { get; set; }

    [Column("size_bytes")]
    public long? SizeBytes { get; set; }

    [Column("record_counts")]
    public Dictionary<string, object> RecordCounts { get; set; } = [];

    [Column("metadata")]
    public Dictionary<string, object> Metadata { get; set; } = [];

    [Column("is_restorable")]
    public bool IsRestorable { get; set; } = true;

    [Column("created_by")]
    public Guid? CreatedBy { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

[Table("application_errors")]
public class ApplicationErrorRecord : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("module")]
    public string? Module { get; set; }

    [Column("page")]
    public string? Page { get; set; }

    [Column("exception_type")]
    public string? ExceptionType { get; set; }

    [Column("message")]
    public string? Message { get; set; }

    [Column("stack_trace")]
    public string? StackTrace { get; set; }

    [Column("company_id")]
    public Guid? CompanyId { get; set; }

    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("employee_id")]
    public Guid? EmployeeId { get; set; }

    [Column("app_version")]
    public string? AppVersion { get; set; }

    [Column("platform")]
    public string? Platform { get; set; }

    [Column("metadata")]
    public Dictionary<string, object> Metadata { get; set; } = [];

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}
