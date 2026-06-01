using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Timesheets.Controls;

namespace KaiFlow.Timesheets.Models.Platform;

[Table("company_subscriptions")]
public class CompanySubscriptionBilling : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("plan_name")] public string PlanName { get; set; } = "KaiFlow Standard";
    [Column("base_price")] public decimal BasePrice { get; set; } = 2500m;
    [Column("included_employees")] public int IncludedEmployees { get; set; } = 25;
    [Column("additional_employee_price")] public decimal AdditionalEmployeePrice { get; set; } = 99m;
    [Column("employee_count")] public int EmployeeCount { get; set; }
    [Column("monthly_charge")] public decimal MonthlyCharge { get; set; }
    [Column("status")] public string Status { get; set; } = "active";
    [Column("start_date")] public DateOnly? StartDate { get; set; }
    [Column("renewal_date")] public DateOnly? RenewalDate { get; set; }
}

[Table("platform_feedback")]
public class PlatformFeedback : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("user_id")] public Guid? UserId { get; set; }
    [Column("employee_id")] public Guid? EmployeeId { get; set; }
    [Column("category")] public string Category { get; set; } = "Suggestion";
    [Column("priority")] public string Priority { get; set; } = "normal";
    [Column("status")] public string Status { get; set; } = "New";
    [Column("message")] public string Message { get; set; } = "";
    [Column("release_version")] public string? ReleaseVersion { get; set; }
    [Column("admin_notes")] public string? AdminNotes { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }
    [Column("updated_at")] public DateTime UpdatedAt { get; set; }

    public string CompanyName { get; set; } = "";
}

public class PlatformAdminDashboard
{
    public PlatformAdminKpis Kpis { get; set; } = new();
    public PlatformAdminTrends Trends { get; set; } = new();
}

public class PlatformAdminKpis
{
    public int TotalCompanies { get; set; }
    public int TotalEmployees { get; set; }
    public int ActiveUsersToday { get; set; }
    public int MonthlyActiveUsers { get; set; }
    public decimal MonthlyRevenue { get; set; }
    public int NewCompaniesThisMonth { get; set; }
    public int TotalPayrollProcessed { get; set; }
    public int TotalInvoicesGenerated { get; set; }
    public int ErrorCount { get; set; }
    public int PendingFeedback { get; set; }
}

public class PlatformAdminTrends
{
    public List<ChartValue> CompanyGrowth { get; set; } = [];
    public List<ChartValue> RevenueGrowth { get; set; } = [];
    public List<ChartValue> ActiveUsersTrend { get; set; } = [];
    public List<ChartValue> ErrorTrend { get; set; } = [];
}

public class BillingInvoiceLine
{
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
}

public class MonthlyBillingInvoice
{
    public Guid CompanyId { get; set; }
    public string CompanyName { get; set; } = "";
    public int EmployeeCount { get; set; }
    public decimal BasePrice { get; set; }
    public int IncludedEmployees { get; set; }
    public int OverageEmployees { get; set; }
    public decimal OverageCharge { get; set; }
    public decimal TotalCharge { get; set; }
    public List<BillingInvoiceLine> Lines { get; set; } = [];
    public DateOnly PeriodMonth { get; set; }
}

public class PlatformFeedbackStats
{
    public int Total { get; set; }
    public Dictionary<string, int> ByStatus { get; set; } = [];
    public List<FeatureRequestSummary> TopFeatureRequests { get; set; } = [];
}

public class FeatureRequestSummary
{
    public string Message { get; set; } = "";
    public int Count { get; set; }
}

public class PlatformReportSnapshot
{
    public PlatformAdminKpis Kpis { get; set; } = new();
    public List<PlatformCompanySummary> Companies { get; set; } = [];
    public List<PlatformFeedback> Feedback { get; set; } = [];
    public PlatformFeedbackStats FeedbackStats { get; set; } = new();
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
}
