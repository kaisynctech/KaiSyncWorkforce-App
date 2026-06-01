using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("companies")]
public class Company : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("code")]
    public string Code { get; set; } = "";

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("plan_code")]
    public string PlanCode { get; set; } = "starter";

    [Column("subscription_active")]
    public bool SubscriptionActive { get; set; }

    [Column("trial_started_at")]
    public DateTime? TrialStartedAt { get; set; }

    [Column("enabled_modules")]
    public Dictionary<string, bool> EnabledModules { get; set; } = [];

    [Column("custom_settings")]
    public Dictionary<string, object> CustomSettings { get; set; } = [];

    [Column("dispatch_settings")]
    public Dictionary<string, object> DispatchSettings { get; set; } = [];

    public bool EnforceBranchSignInRadius =>
        GetDispatchFlag("enforce_branch_sign_in_radius", defaultValue: false);

    public double BranchSignInRadiusMeters =>
        NormalizeBranchRadius(GetDispatchNumber("branch_sign_in_radius_m", 500));

    public static double NormalizeBranchRadius(double raw) =>
        raw <= 350 ? 200 : raw <= 750 ? 500 : 1000;

    public bool GetDispatchFlag(string key, bool defaultValue = false)
    {
        if (!DispatchSettings.TryGetValue(key, out var value) || value == null)
            return defaultValue;
        if (value is bool b) return b;
        if (bool.TryParse(value.ToString(), out var parsed)) return parsed;
        return defaultValue;
    }

    public double GetDispatchNumber(string key, double defaultValue)
    {
        if (!DispatchSettings.TryGetValue(key, out var value) || value == null)
            return defaultValue;
        if (value is double d) return d;
        if (value is long l) return l;
        if (value is int i) return i;
        if (double.TryParse(value.ToString(), out var parsed)) return parsed;
        return defaultValue;
    }

    public void SetDispatchFlag(string key, bool value) => DispatchSettings[key] = value;

    public void SetDispatchNumber(string key, double value) => DispatchSettings[key] = value;

    [Column("owner_user_id")]
    public Guid? OwnerUserId { get; set; }

    [Column("contact_email")]
    public string? ContactEmail { get; set; }

    [Column("contact_phone")]
    public string? ContactPhone { get; set; }

    [Column("address")]
    public string? Address { get; set; }

    [Column("logo_url")]
    public string? LogoUrl { get; set; }

    // ─── Finance / VAT configuration (Phase 3) ───────────────────────────────
    [Column("is_vat_registered")]
    public bool IsVatRegistered { get; set; } = true;

    [Column("vat_number")]
    public string? VatNumber { get; set; }

    [Column("default_vat_rate")]
    public decimal DefaultVatRate { get; set; } = 0.15m;

    [Column("finance_vat_inclusive_default")]
    public bool FinanceVatInclusiveDefault { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public bool IsModuleEnabled(string moduleKey, bool defaultIfMissing = true) =>
        CompanyModules.IsEnabled(this, moduleKey, defaultIfMissing);

    public bool HasTicketing => IsModuleEnabled(CompanyModules.Ticketing);
    public bool HasClients => IsModuleEnabled(CompanyModules.Clients);
    public bool HasInventory => IsModuleEnabled(CompanyModules.Inventory);
    public bool HasAttendance => IsModuleEnabled(CompanyModules.Attendance);
    public bool HasReports => IsModuleEnabled(CompanyModules.Reports);
    public bool HasScheduling => IsModuleEnabled(CompanyModules.Scheduling);
    public bool HasPayroll => IsModuleEnabled(CompanyModules.Payroll);
    public bool HasPaperless => IsModuleEnabled(CompanyModules.Paperless, defaultIfMissing: false);
    public bool HasEmployees => IsModuleEnabled(CompanyModules.Employees);
    public bool HasContractors => IsModuleEnabled(CompanyModules.Contractors);
    public bool HasPropertyManagement => IsModuleEnabled(CompanyModules.PropertyManagement);
    public bool HasAssetCompliance => IsModuleEnabled(CompanyModules.AssetCompliance);
    public bool HasMyPa => IsModuleEnabled(CompanyModules.MyPa);
    public bool HasLeave => IsModuleEnabled(CompanyModules.Leave);
    public bool HasMessaging => IsModuleEnabled(CompanyModules.Messaging);
    public bool HasSettingsModule => IsModuleEnabled(CompanyModules.Settings);

    /// <summary>Alias for property management (includes legacy <c>properties</c> key).</summary>
    public bool HasProperties => HasPropertyManagement;
}
