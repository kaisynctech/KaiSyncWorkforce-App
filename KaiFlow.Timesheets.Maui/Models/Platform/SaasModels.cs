using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models.Platform;

[Table("saas_plans")]
public class SaasPlan : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("name")] public string Name { get; set; } = "";
    [Column("code")] public string Code { get; set; } = "";
    [Column("description")] public string? Description { get; set; }
    [Column("monthly_price")] public decimal MonthlyPrice { get; set; }
    [Column("included_employees")] public int IncludedEmployees { get; set; }
    [Column("per_employee_price")] public decimal PerEmployeePrice { get; set; }
    [Column("is_active")] public bool IsActive { get; set; } = true;
    [Column("features_json")] public Dictionary<string, object> FeaturesJson { get; set; } = [];
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

[Table("saas_company_subscriptions")]
public class SaasCompanySubscription : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("plan_id")] public Guid PlanId { get; set; }
    [Column("billing_status")] public string BillingStatus { get; set; } = "trial";
    [Column("employee_limit")] public int EmployeeLimit { get; set; }
    [Column("current_employee_count")] public int CurrentEmployeeCount { get; set; }
    [Column("next_billing_date")] public DateOnly? NextBillingDate { get; set; }
    [Column("renewal_date")] public DateOnly? RenewalDate { get; set; }
    [Column("trial_ends_at")] public DateTime? TrialEndsAt { get; set; }
    [Column("subscription_status")] public string SubscriptionStatus { get; set; } = "trialing";
    [Column("amount_due")] public decimal AmountDue { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public bool IsActive => SubscriptionStatus is "active" or "trialing";
    public bool IsTrialing => SubscriptionStatus == "trialing";
    public bool IsSuspended => SubscriptionStatus is "suspended" or "cancelled" or "past_due";
    public int RemainingCapacity => Math.Max(0, EmployeeLimit - CurrentEmployeeCount);
}

[Table("saas_billing_transactions")]
public class SaasBillingTransaction : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("subscription_id")] public Guid? SubscriptionId { get; set; }
    [Column("amount")] public decimal Amount { get; set; }
    [Column("currency")] public string Currency { get; set; } = "ZAR";
    [Column("billing_period_start")] public DateOnly? BillingPeriodStart { get; set; }
    [Column("billing_period_end")] public DateOnly? BillingPeriodEnd { get; set; }
    [Column("payment_status")] public string PaymentStatus { get; set; } = "pending";
    [Column("payment_provider")] public string? PaymentProvider { get; set; }
    [Column("provider_reference")] public string? ProviderReference { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

[Table("saas_feature_flags")]
public class SaasFeatureFlag : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("feature_code")] public string FeatureCode { get; set; } = "";
    [Column("display_name")] public string DisplayName { get; set; } = "";
    [Column("description")] public string? Description { get; set; }
    [Column("module")] public string? Module { get; set; }
    [Column("is_enabled_by_default")] public bool IsEnabledByDefault { get; set; }
}

[Table("saas_company_features")]
public class SaasCompanyFeature : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("feature_code")] public string FeatureCode { get; set; } = "";
    [Column("is_enabled")] public bool IsEnabled { get; set; } = true;
    [Column("enabled_at")] public DateTime EnabledAt { get; set; }
    [Column("expires_at")] public DateTime? ExpiresAt { get; set; }
    [Column("override_reason")] public string? OverrideReason { get; set; }
}

[Table("saas_usage_snapshots")]
public class SaasUsageSnapshot : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("period_month")] public DateOnly PeriodMonth { get; set; }
    [Column("metrics_json")] public Dictionary<string, object> MetricsJson { get; set; } = [];
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

[Table("saas_onboarding_progress")]
public class SaasOnboardingProgress : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("step_key")] public string StepKey { get; set; } = "";
    [Column("is_completed")] public bool IsCompleted { get; set; }
    [Column("completed_at")] public DateTime? CompletedAt { get; set; }
    [Column("metadata_json")] public Dictionary<string, object> MetadataJson { get; set; } = [];
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }
}

[Table("platform_admins")]
public class PlatformAdmin : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("auth_user_id")] public Guid AuthUserId { get; set; }
    [Column("email")] public string? Email { get; set; }
    [Column("role")] public string Role { get; set; } = "admin";
    [Column("is_active")] public bool IsActive { get; set; } = true;
}

[Table("saas_platform_audit_log")]
public class SaasPlatformAuditEntry : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("actor_user_id")] public Guid? ActorUserId { get; set; }
    [Column("actor_email")] public string? ActorEmail { get; set; }
    [Column("action")] public string Action { get; set; } = "";
    [Column("target_type")] public string? TargetType { get; set; }
    [Column("target_id")] public Guid? TargetId { get; set; }
    [Column("company_id")] public Guid? CompanyId { get; set; }
    [Column("detail_json")] public Dictionary<string, object> DetailJson { get; set; } = [];
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

[Table("saas_support_notes")]
public class SaasSupportNote : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("author_user_id")] public Guid? AuthorUserId { get; set; }
    [Column("author_email")] public string? AuthorEmail { get; set; }
    [Column("note")] public string Note { get; set; } = "";
    [Column("severity")] public string Severity { get; set; } = "info";
    [Column("is_resolved")] public bool IsResolved { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
}

/// <summary>DTO returned by saas_get_company_subscription RPC.</summary>
public class SaasSubscriptionSummary
{
    public Guid SubscriptionId { get; set; }
    public Guid CompanyId { get; set; }
    public string PlanCode { get; set; } = "";
    public string PlanName { get; set; } = "";
    public string SubscriptionStatus { get; set; } = "";
    public string BillingStatus { get; set; } = "";
    public int EmployeeLimit { get; set; }
    public int CurrentEmployeeCount { get; set; }
    public DateTime? TrialEndsAt { get; set; }
    public DateOnly? NextBillingDate { get; set; }
    public decimal AmountDue { get; set; }
    public Dictionary<string, object>? FeaturesJson { get; set; }

    public bool IsActive => SubscriptionStatus is "active" or "trialing";
    public int RemainingCapacity => Math.Max(0, EmployeeLimit - CurrentEmployeeCount);
    public string StatusLabel => SubscriptionStatus switch
    {
        "active" => "Active",
        "trialing" => "Trial",
        "past_due" => "Past Due",
        "suspended" => "Suspended",
        "cancelled" => "Cancelled",
        _ => SubscriptionStatus,
    };
}

/// <summary>Platform admin company list item from platform_list_companies RPC.</summary>
public class PlatformCompanySummary
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public string PlanCode { get; set; } = "";
    public string SubscriptionStatus { get; set; } = "";
    public int EmployeeCount { get; set; }
    public int EmployeeLimit { get; set; }
    public decimal MonthlyCharge { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool SubscriptionActive { get; set; }

    public string StatusChip => SubscriptionStatus switch
    {
        "active" => "success",
        "trialing" => "info",
        "past_due" => "warning",
        "suspended" => "error",
        _ => "neutral",
    };
}

public class TenantHealthScore
{
    public Guid CompanyId { get; set; }
    public int Score { get; set; }
    public string Grade { get; set; } = "B";
    public string Status { get; set; } = "Healthy";
    public DateTime? LastLogin { get; set; }
    public int ActiveUsers30d { get; set; }
    public int ErrorCount30d { get; set; }
    public int OpenFeedback { get; set; }
    public List<string> Issues { get; set; } = [];
}

public class PlatformKpiSnapshot
{
    public int TotalCompanies { get; set; }
    public int ActiveSubscriptions { get; set; }
    public int TrialingCompanies { get; set; }
    public int PastDueCompanies { get; set; }
    public int TotalEmployees { get; set; }
    public decimal MrrEstimate { get; set; }
}

[Table("saas_release_rollouts")]
public class SaasReleaseRollout : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("feature_code")] public string FeatureCode { get; set; } = "";
    [Column("rollout_stage")] public string RolloutStage { get; set; } = "beta";
    [Column("target_plan_codes")] public List<string> TargetPlanCodes { get; set; } = [];
    [Column("target_company_ids")] public List<Guid> TargetCompanyIds { get; set; } = [];
    [Column("min_app_version")] public string? MinAppVersion { get; set; }
    [Column("is_active")] public bool IsActive { get; set; } = true;
}

[Table("saas_company_app_versions")]
public class SaasCompanyAppVersion : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("app_version")] public string AppVersion { get; set; } = "";
    [Column("platform")] public string? Platform { get; set; }
    [Column("last_seen_at")] public DateTime LastSeenAt { get; set; }
}
