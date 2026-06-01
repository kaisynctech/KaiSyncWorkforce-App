namespace KaiFlow.Timesheets.Helpers;

/// <summary>SaaS feature codes — maps to saas_feature_flags.feature_code and plan features_json.</summary>
public static class SaasFeatureCodes
{
    // Module entitlements (prefix module.)
    public const string ModulePayroll = "module.payroll";
    public const string ModuleReports = "module.reports";
    public const string ModuleProperty = "module.property_management";
    public const string ModuleFinance = "module.finance";
    public const string ModuleScheduling = "feature.scheduling";
    public const string ModuleMyPa = "feature.my_pa";

    // Premium features
    public const string AdvancedReporting = "feature.advanced_reporting";
    public const string FinanceForecasting = "feature.finance_forecasting";
    public const string AccountingSync = "feature.accounting_sync";
    public const string PlatformApi = "feature.platform_api";

    /// <summary>Maps CompanyModules key → SaaS feature code for plan enforcement.</summary>
    public static string? ModuleToFeatureCode(string moduleKey) => moduleKey switch
    {
        CompanyModules.Payroll => ModulePayroll,
        CompanyModules.Reports => ModuleReports,
        CompanyModules.PropertyManagement => ModuleProperty,
        CompanyModules.Scheduling => ModuleScheduling,
        CompanyModules.MyPa => ModuleMyPa,
        // Finance is a separate module area — gated when navigating to finance pages
        _ => null,
    };

    public static readonly string[] OnboardingSteps =
    [
        "company_profile",
        "logo",
        "departments",
        "branches",
        "payroll_settings",
        "vat_settings",
        "shift_templates",
        "leave_policies",
        "permissions_template",
        "employee_import",
    ];
}
