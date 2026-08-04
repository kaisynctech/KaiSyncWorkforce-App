using KaiFlow.Timesheets.Models.Platform;

namespace KaiFlow.Timesheets.Services.Platform;

public interface IBillingCalculationService
{
    const decimal DefaultBasePrice = 2500m;
    const int DefaultIncludedEmployees = 25;
    const decimal DefaultAdditionalEmployeePrice = 99m;
    const int DefaultIncludedContractors = 50;
    const decimal DefaultAdditionalContractorPrice = 49m;
    const int DefaultIncludedProperties = 20;
    const decimal DefaultAdditionalPropertyPrice = 49m;

    decimal CalculateMonthlyCharge(
        int employeeCount,
        int contractorCount = 0,
        int propertyCount = 0,
        decimal? basePrice = null,
        int? includedEmployees = null,
        decimal? additionalEmployeePrice = null,
        int? includedContractors = null,
        decimal? additionalContractorPrice = null,
        int? includedProperties = null,
        decimal? additionalPropertyPrice = null);

    int CalculateEmployeeOverage(int employeeCount, int? includedEmployees = null);
    int CalculateContractorOverage(int contractorCount, int? includedContractors = null);
    int CalculatePropertyOverage(int propertyCount, int? includedProperties = null);
    MonthlyBillingInvoice GenerateMonthlyInvoice(
        Guid companyId,
        string companyName,
        int employeeCount,
        int contractorCount = 0,
        int propertyCount = 0,
        DateOnly? periodMonth = null);
    Task<CompanySubscriptionBilling?> RefreshCompanySubscriptionAsync(Guid companyId, CancellationToken ct = default);
}

public sealed class BillingCalculationService : IBillingCalculationService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;

    public BillingCalculationService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public decimal CalculateMonthlyCharge(
        int employeeCount,
        int contractorCount = 0,
        int propertyCount = 0,
        decimal? basePrice = null,
        int? includedEmployees = null,
        decimal? additionalEmployeePrice = null,
        int? includedContractors = null,
        decimal? additionalContractorPrice = null,
        int? includedProperties = null,
        decimal? additionalPropertyPrice = null)
    {
        var baseP = basePrice ?? IBillingCalculationService.DefaultBasePrice;
        var empOver = CalculateEmployeeOverage(employeeCount, includedEmployees);
        var ctOver = CalculateContractorOverage(contractorCount, includedContractors);
        var propOver = CalculatePropertyOverage(propertyCount, includedProperties);
        return baseP
            + (empOver * (additionalEmployeePrice ?? IBillingCalculationService.DefaultAdditionalEmployeePrice))
            + (ctOver * (additionalContractorPrice ?? IBillingCalculationService.DefaultAdditionalContractorPrice))
            + (propOver * (additionalPropertyPrice ?? IBillingCalculationService.DefaultAdditionalPropertyPrice));
    }

    public int CalculateEmployeeOverage(int employeeCount, int? includedEmployees = null)
    {
        var included = includedEmployees ?? IBillingCalculationService.DefaultIncludedEmployees;
        return Math.Max(0, employeeCount - included);
    }

    public int CalculateContractorOverage(int contractorCount, int? includedContractors = null)
    {
        var included = includedContractors ?? IBillingCalculationService.DefaultIncludedContractors;
        return Math.Max(0, contractorCount - included);
    }

    public int CalculatePropertyOverage(int propertyCount, int? includedProperties = null)
    {
        var included = includedProperties ?? IBillingCalculationService.DefaultIncludedProperties;
        return Math.Max(0, propertyCount - included);
    }

    public MonthlyBillingInvoice GenerateMonthlyInvoice(
        Guid companyId,
        string companyName,
        int employeeCount,
        int contractorCount = 0,
        int propertyCount = 0,
        DateOnly? periodMonth = null)
    {
        var empOver = CalculateEmployeeOverage(employeeCount);
        var ctOver = CalculateContractorOverage(contractorCount);
        var propOver = CalculatePropertyOverage(propertyCount);
        var empCharge = empOver * IBillingCalculationService.DefaultAdditionalEmployeePrice;
        var ctCharge = ctOver * IBillingCalculationService.DefaultAdditionalContractorPrice;
        var propCharge = propOver * IBillingCalculationService.DefaultAdditionalPropertyPrice;
        var total = CalculateMonthlyCharge(employeeCount, contractorCount, propertyCount);
        var period = periodMonth ?? new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);

        var lines = new List<BillingInvoiceLine>
        {
            new()
            {
                Description =
                    $"KaiSync Business base ({IBillingCalculationService.DefaultIncludedEmployees} employees, " +
                    $"{IBillingCalculationService.DefaultIncludedContractors} portal contractors, " +
                    $"{IBillingCalculationService.DefaultIncludedProperties} properties)",
                Amount = IBillingCalculationService.DefaultBasePrice
            },
        };
        if (empOver > 0)
            lines.Add(new()
            {
                Description = $"Additional employees ({empOver} × R{IBillingCalculationService.DefaultAdditionalEmployeePrice:N0})",
                Amount = empCharge
            });
        if (ctOver > 0)
            lines.Add(new()
            {
                Description = $"Additional portal contractors ({ctOver} × R{IBillingCalculationService.DefaultAdditionalContractorPrice:N0})",
                Amount = ctCharge
            });
        if (propOver > 0)
            lines.Add(new()
            {
                Description = $"Additional properties ({propOver} × R{IBillingCalculationService.DefaultAdditionalPropertyPrice:N0})",
                Amount = propCharge
            });

        _telemetry.LogEvent("billing_calculated", new()
        {
            ["company_id"] = companyId.ToString(),
            ["employees"] = employeeCount.ToString(),
            ["contractors"] = contractorCount.ToString(),
            ["properties"] = propertyCount.ToString(),
            ["total"] = total.ToString("F2"),
        });

        return new MonthlyBillingInvoice
        {
            CompanyId = companyId,
            CompanyName = companyName,
            EmployeeCount = employeeCount,
            BasePrice = IBillingCalculationService.DefaultBasePrice,
            IncludedEmployees = IBillingCalculationService.DefaultIncludedEmployees,
            OverageEmployees = empOver,
            OverageCharge = empCharge + ctCharge + propCharge,
            TotalCharge = total,
            Lines = lines,
            PeriodMonth = period,
        };
    }

    public async Task<CompanySubscriptionBilling?> RefreshCompanySubscriptionAsync(Guid companyId, CancellationToken ct = default)
    {
        var existed = await _storage.GetCompanySubscriptionBillingAsync(companyId, ct);
        var result = await _storage.PlatformRefreshCompanySubscriptionAsync(companyId, ct);
        if (result is not null)
        {
            _telemetry.LogEvent(existed is null ? "subscription_created" : "subscription_updated", new()
            {
                ["company_id"] = companyId.ToString(),
                ["monthly_charge"] = result.MonthlyCharge.ToString("F2"),
            });
        }
        return result;
    }
}


public interface IFeedbackService
{
    Task SubmitFeedbackAsync(Guid companyId, string category, string message, string priority = "normal", CancellationToken ct = default);
    Task<List<PlatformFeedback>> GetCompanyFeedbackAsync(Guid companyId, CancellationToken ct = default);
    Task<List<PlatformFeedback>> GetPlatformFeedbackAsync(string? status = null, CancellationToken ct = default);
    Task UpdateFeedbackStatusAsync(Guid feedbackId, string status, string? releaseVersion = null, string? adminNotes = null, CancellationToken ct = default);
    Task<PlatformFeedbackStats> GetFeedbackStatsAsync(CancellationToken ct = default);
}

public sealed class FeedbackService : IFeedbackService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;

    public FeedbackService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public async Task SubmitFeedbackAsync(Guid companyId, string category, string message, string priority = "normal", CancellationToken ct = default)
    {
        await _storage.SubmitPlatformFeedbackAsync(companyId, category, message, priority, ct);
        _telemetry.LogEvent("feedback_submitted", new()
        {
            ["company_id"] = companyId.ToString(),
            ["category"] = category,
        });
    }

    public Task<List<PlatformFeedback>> GetCompanyFeedbackAsync(Guid companyId, CancellationToken ct = default)
        => _storage.GetCompanyPlatformFeedbackAsync(companyId, ct);

    public Task<List<PlatformFeedback>> GetPlatformFeedbackAsync(string? status = null, CancellationToken ct = default)
        => _storage.GetPlatformFeedbackAsync(status, ct);

    public async Task UpdateFeedbackStatusAsync(Guid feedbackId, string status, string? releaseVersion = null, string? adminNotes = null, CancellationToken ct = default)
    {
        await _storage.UpdatePlatformFeedbackStatusAsync(feedbackId, status, releaseVersion, adminNotes, ct);
        _telemetry.LogEvent("feedback_status_updated", new() { ["feedback_id"] = feedbackId.ToString(), ["status"] = status });
    }

    public Task<PlatformFeedbackStats> GetFeedbackStatsAsync(CancellationToken ct = default)
        => _storage.GetPlatformFeedbackStatsAsync(ct);
}

public interface IPlatformReportingService
{
    Task<PlatformReportSnapshot> BuildSnapshotAsync(CancellationToken ct = default);
    Task ExportExcelAsync(IExportService export, PlatformReportSnapshot snapshot);
    Task ExportPdfAsync(IExportService export, PlatformReportSnapshot snapshot);
}

public sealed class PlatformReportingService : IPlatformReportingService
{
    private readonly IStorageService _storage;

    public PlatformReportingService(IStorageService storage) => _storage = storage;

    public async Task<PlatformReportSnapshot> BuildSnapshotAsync(CancellationToken ct = default)
    {
        var dashboard = await _storage.GetPlatformAdminDashboardAsync(ct);
        var companies = await _storage.PlatformSearchCompaniesAsync("", 500, 0, ct);
        var feedback = await _storage.GetPlatformFeedbackAsync(null, ct);
        var stats = await _storage.GetPlatformFeedbackStatsAsync(ct);

        return new PlatformReportSnapshot
        {
            Kpis = dashboard.Kpis,
            Companies = companies,
            Feedback = feedback,
            FeedbackStats = stats,
            GeneratedAt = DateTime.UtcNow,
        };
    }

    public Task ExportExcelAsync(IExportService export, PlatformReportSnapshot snapshot)
    {
        var headers = new[] { "Company", "Code", "Status", "Employees", "Monthly Charge (R)" };
        var rows = snapshot.Companies.Select(c => new[]
        {
            c.Name, c.Code, c.SubscriptionStatus,
            c.EmployeeCount.ToString(), c.MonthlyCharge.ToString("N2"),
        });
        return export.ExportToExcelAsync(
            $"platform-report-{DateTime.UtcNow:yyyyMMdd}.xlsx",
            "Platform Report", headers, rows, downloadToDevice: true);
    }

    public Task ExportPdfAsync(IExportService export, PlatformReportSnapshot snapshot)
    {
        var headers = new[] { "Metric", "Value" };
        var k = snapshot.Kpis;
        var rows = new List<IEnumerable<string>>
        {
            new[] { "Total Companies", k.TotalCompanies.ToString() },
            new[] { "Total Employees", k.TotalEmployees.ToString() },
            new[] { "Monthly Revenue (R)", k.MonthlyRevenue.ToString("N2") },
            new[] { "MAU", k.MonthlyActiveUsers.ToString() },
            new[] { "Errors (month)", k.ErrorCount.ToString() },
            new[] { "Pending Feedback", k.PendingFeedback.ToString() },
        };
        return export.ExportToPdfAsync(
            $"platform-report-{DateTime.UtcNow:yyyyMMdd}.pdf",
            "KaiFlow Platform Report",
            headers, rows, downloadToDevice: true);
    }
}

