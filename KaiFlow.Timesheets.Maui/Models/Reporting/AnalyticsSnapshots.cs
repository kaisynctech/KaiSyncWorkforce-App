using KaiFlow.Timesheets.Controls;

namespace KaiFlow.Timesheets.Models.Reporting;

/// <summary>Cross-module executive KPI snapshot for the Reports executive tab.</summary>
public sealed class ExecutiveSnapshot
{
    // Financial
    public string RevenueThisMonth { get; set; } = "—";
    public string OutstandingInvoices { get; set; } = "—";
    public string AccountsReceivable { get; set; } = "—";
    public string AccountsPayable { get; set; } = "—";
    public string PayrollCosts { get; set; } = "—";
    public string VatDue { get; set; } = "—";
    public string NetCashflow { get; set; } = "—";
    public string ProfitEstimate { get; set; } = "—";

    // Workforce
    public string EmployeesPresentToday { get; set; } = "—";
    public string LateArrivals { get; set; } = "—";
    public string LeaveToday { get; set; } = "—";
    public string OpenIncidents { get; set; } = "—";
    public string ActiveJobs { get; set; } = "—";
    public string OvertimeHours { get; set; } = "—";
    public string Headcount { get; set; } = "—";

    // Operations
    public string JobCompletionRate { get; set; } = "—";
    public string ProjectProfitability { get; set; } = "—";
    public string InventoryUsage { get; set; } = "—";
    public string ContractorPerformance { get; set; } = "—";
    public string SiteActivity { get; set; } = "—";
    public string InventoryValue { get; set; } = "—";

    // System health
    public string ActiveUsers { get; set; } = "—";
    public string OfflineQueueCount { get; set; } = "—";
    public string RealtimeStatus { get; set; } = "—";
    public string ErrorRate { get; set; } = "—";
    public string FeatureAdoption { get; set; } = "—";

    // Charts
    public List<ChartValue> AttendanceTrend { get; set; } = [];
    public List<ChartValue> JobsByStatus { get; set; } = [];
    public List<ChartValue> RevenueTrend { get; set; } = [];
    public List<ChartValue> CashflowTrend { get; set; } = [];
}

public sealed class FinancialAnalyticsSnapshot
{
    public FinanceReport? ProfitAndLoss { get; set; }
    public FinanceReport? Cashflow { get; set; }
    public FinanceReport? VatSummary { get; set; }
    public FinanceReport? ArAging { get; set; }
    public FinanceReport? ApAging { get; set; }
    public FinanceDashboardSnapshot Dashboard { get; set; } = new();
    public List<ChartValue> RevenueTrend { get; set; } = [];
    public List<ChartValue> ExpenseTrend { get; set; } = [];
    public List<ChartValue> SupplierSpend { get; set; } = [];
    public List<ChartValue> ContractorSpend { get; set; } = [];
}

public sealed class WorkforceAnalyticsSnapshot
{
    public string AttendanceRate { get; set; } = "—";
    public string LatenessCount { get; set; } = "—";
    public string OvertimeHours { get; set; } = "—";
    public string LeaveDays { get; set; } = "—";
    public string AbsenteeismRate { get; set; } = "—";
    public string ShiftUtilization { get; set; } = "—";
    public List<ChartValue> AttendanceTrend { get; set; } = [];
    public List<ChartValue> LeaveByType { get; set; } = [];
    public List<ChartValue> OvertimeTrend { get; set; } = [];
    public List<ChartValue> AbsenteeismTrend { get; set; } = [];
    public List<ChartValue> WorkloadByEmployee { get; set; } = [];
}

public sealed class OperationalAnalyticsSnapshot
{
    public string JobCompletionRate { get; set; } = "—";
    public string OpenIncidents { get; set; } = "—";
    public string SlaBreaches { get; set; } = "—";
    public string InventoryConsumption { get; set; } = "—";
    public string ActiveSites { get; set; } = "—";
    public string ProjectOnTrack { get; set; } = "—";
    public List<ChartValue> JobsByStatus { get; set; } = [];
    public List<ChartValue> IncidentSeverity { get; set; } = [];
    public List<ChartValue> ContractorRatings { get; set; } = [];
    public List<ChartValue> InventoryUsageTrend { get; set; } = [];
    public List<ChartValue> ProjectTimeline { get; set; } = [];
    public List<ChartValue> SiteActivityHeat { get; set; } = [];
}

public sealed class TelemetryAnalyticsSnapshot
{
    public string EventsTotal { get; set; } = "—";
    public string ErrorsTotal { get; set; } = "—";
    public string WarningsTotal { get; set; } = "—";
    public string LoginActivity { get; set; } = "—";
    public string ModuleUsage { get; set; } = "—";
    public string OfflineReplay { get; set; } = "—";
    public string ReconnectEvents { get; set; } = "—";
    public string ExportUsage { get; set; } = "—";
    public string FinanceActivity { get; set; } = "—";
    public string PortalUsage { get; set; } = "—";
    public List<ChartValue> TopEvents { get; set; } = [];
    public List<ChartValue> ErrorTrend { get; set; } = [];
    public List<ChartValue> ModuleAdoption { get; set; } = [];
    public List<ChartValue> LoginTrend { get; set; } = [];
}

public sealed class PayrollAnalyticsSnapshot
{
    public string TotalGross { get; set; } = "—";
    public string TotalNet { get; set; } = "—";
    public string OvertimeCost { get; set; } = "—";
    public string EmployeeCount { get; set; } = "—";
    public string AvgNetPay { get; set; } = "—";
    public List<ChartValue> PayrollTrend { get; set; } = [];
    public List<ChartStack> PayrollComponents { get; set; } = [];
}

public sealed class IncidentsAnalyticsSnapshot
{
    public string OpenCount { get; set; } = "—";
    public string ClosedCount { get; set; } = "—";
    public string AvgResolutionDays { get; set; } = "—";
    public List<ChartValue> BySeverity { get; set; } = [];
    public List<ChartValue> Trend { get; set; } = [];
}

public sealed class InventoryAnalyticsSnapshot
{
    public string TotalValue { get; set; } = "—";
    public string ItemsTracked { get; set; } = "—";
    public string UsageEvents { get; set; } = "—";
    public List<ChartValue> TopConsumed { get; set; } = [];
    public List<ChartValue> ValueByCategory { get; set; } = [];
}

public sealed class ContractorsAnalyticsSnapshot
{
    public string ActiveContractors { get; set; } = "—";
    public string PendingPayouts { get; set; } = "—";
    public string TotalPaid { get; set; } = "—";
    public List<ChartValue> PayoutTrend { get; set; } = [];
    public List<ChartValue> PerformanceScores { get; set; } = [];
}

public sealed class PropertyAnalyticsSnapshot
{
    public string SiteCount { get; set; } = "—";
    public string UnitCount { get; set; } = "—";
    public string ResidentCount { get; set; } = "—";
    public string AssetCount { get; set; } = "—";
    public List<ChartValue> SiteOccupancy { get; set; } = [];
}
