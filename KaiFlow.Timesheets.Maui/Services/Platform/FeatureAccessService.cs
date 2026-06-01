using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Platform;

namespace KaiFlow.Timesheets.Services.Platform;

public interface IFeatureAccessService
{
    Task RefreshAsync(Guid companyId, CancellationToken ct = default);
    SaasSubscriptionSummary? CurrentSubscription { get; }
    bool IsFeatureEnabled(string featureCode);
    bool CanAccessModule(Company? company, string moduleKey);
    bool IsModuleEntitledByPlan(string moduleKey);
    int GetRemainingEmployeeCapacity();
    bool CanAddEmployee();
    Task<bool> IsPlatformAdminAsync(CancellationToken ct = default);
}

/// <summary>
/// Fourth gating layer: plan/subscription entitlements.
/// Composes with CompanyModules (tenant toggle) and PermissionsService (role).
/// Never elevates privileges — only restricts.
/// </summary>
public sealed class FeatureAccessService : IFeatureAccessService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;
    private readonly object _lock = new();

    private SaasSubscriptionSummary? _subscription;
    private List<SaasCompanyFeature> _overrides = [];
    private Guid _loadedCompanyId;
    private bool? _isPlatformAdmin;

    public SaasSubscriptionSummary? CurrentSubscription
    {
        get { lock (_lock) return _subscription; }
    }

    public FeatureAccessService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public async Task RefreshAsync(Guid companyId, CancellationToken ct = default)
    {
        try
        {
            var sub = await _storage.GetSaasSubscriptionAsync(companyId);
            var overrides = await _storage.GetSaasCompanyFeaturesAsync(companyId);
            lock (_lock)
            {
                _subscription = sub;
                _overrides = overrides;
                _loadedCompanyId = companyId;
            }
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning("feature_access_refresh_failed", nameof(FeatureAccessService),
                new Dictionary<string, string> { ["company_id"] = companyId.ToString(), ["error"] = ex.Message });
            // Anti-lockout: keep cached subscription if refresh fails
        }
    }

    public bool IsFeatureEnabled(string featureCode)
    {
        lock (_lock)
        {
            var ov = _overrides.FirstOrDefault(o => o.FeatureCode == featureCode);
            if (ov is not null)
            {
                if (ov.ExpiresAt.HasValue && ov.ExpiresAt.Value < DateTime.UtcNow)
                { /* expired — fall through */ }
                else return ov.IsEnabled;
            }

            if (_subscription is null) return true; // legacy / offline permissive

            if (!_subscription.IsActive) return false;

            return ResolveFromPlanFeatures(_subscription.FeaturesJson, featureCode);
        }
    }

    public bool CanAccessModule(Company? company, string moduleKey)
    {
        if (company is null) return false;

        // Tenant admin toggle must still be on
        if (!CompanyModules.IsEnabled(company, moduleKey)) return false;

        // Finance module special case
        if (moduleKey == "finance")
            return IsFeatureEnabled(SaasFeatureCodes.ModuleFinance);

        var featureCode = SaasFeatureCodes.ModuleToFeatureCode(moduleKey);
        if (featureCode is null) return true; // no plan gate for this module

        return IsFeatureEnabled(featureCode);
    }

    public bool IsModuleEntitledByPlan(string moduleKey)
    {
        lock (_lock)
        {
            if (_subscription is null) return true;
            if (!_subscription.IsActive) return false;

            var features = _subscription.FeaturesJson;
            if (features is null || features.Count == 0) return true;

            if (TryGetNestedBool(features, "modules", moduleKey, out var modVal))
                return modVal;

            if (moduleKey == CompanyModules.PropertyManagement
                && TryGetNestedBool(features, "modules", CompanyModules.LegacyProperties, out var legacyVal))
                return legacyVal;

            var featureCode = SaasFeatureCodes.ModuleToFeatureCode(moduleKey);
            if (featureCode is not null)
                return ResolveFromPlanFeatures(features, featureCode);

            return true;
        }
    }

    public int GetRemainingEmployeeCapacity()
    {
        lock (_lock)
            return _subscription?.RemainingCapacity ?? int.MaxValue;
    }

    public bool CanAddEmployee() => GetRemainingEmployeeCapacity() > 0;

    public async Task<bool> IsPlatformAdminAsync(CancellationToken ct = default)
    {
        if (_isPlatformAdmin.HasValue) return _isPlatformAdmin.Value;
        try
        {
            _isPlatformAdmin = await _storage.IsPlatformAdminAsync();
            return _isPlatformAdmin.Value;
        }
        catch
        {
            return false;
        }
    }

    private static bool ResolveFromPlanFeatures(Dictionary<string, object>? featuresJson, string featureCode)
    {
        if (featuresJson is null || featuresJson.Count == 0) return true;

        if (featureCode.StartsWith("module.", StringComparison.Ordinal))
        {
            var modKey = featureCode["module.".Length..];
            if (TryGetNestedBool(featuresJson, "modules", modKey, out var modVal))
                return modVal;
        }

        if (TryGetNestedBool(featuresJson, "features", featureCode, out var featVal))
            return featVal;

        return true;
    }

    private static bool TryGetNestedBool(Dictionary<string, object> root, string section, string key, out bool value)
    {
        value = false;
        if (!root.TryGetValue(section, out var sectionObj) || sectionObj is null) return false;

        if (sectionObj is Dictionary<string, object> dict)
        {
            if (dict.TryGetValue(key, out var v))
            {
                value = v switch
                {
                    bool b => b,
                    System.Text.Json.JsonElement el when el.ValueKind == System.Text.Json.JsonValueKind.True => true,
                    System.Text.Json.JsonElement el when el.ValueKind == System.Text.Json.JsonValueKind.False => false,
                    _ => bool.TryParse(v?.ToString(), out var p) && p,
                };
                return true;
            }
        }

        if (sectionObj is System.Text.Json.JsonElement je && je.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            if (je.TryGetProperty(key, out var prop))
            {
                value = prop.ValueKind == System.Text.Json.JsonValueKind.True;
                return true;
            }
        }

        return false;
    }
}
