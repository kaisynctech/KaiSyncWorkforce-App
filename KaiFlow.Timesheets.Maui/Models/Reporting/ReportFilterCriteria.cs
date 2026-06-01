namespace KaiFlow.Timesheets.Models.Reporting;

/// <summary>Reusable enterprise report filter — drives all analytics tabs.</summary>
public sealed class ReportFilterCriteria
{
    public DateOnly From { get; set; } = DateOnly.FromDateTime(DateTime.Today.AddDays(-30));
    public DateOnly To { get; set; } = DateOnly.FromDateTime(DateTime.Today);
    public Guid? BranchId { get; set; }
    public Guid? DepartmentId { get; set; }
    public Guid? EmployeeId { get; set; }
    public Guid? ProjectId { get; set; }
    public Guid? ContractorId { get; set; }
    public string? Status { get; set; }
    public string? FinanceCategory { get; set; }
    public Guid? SiteId { get; set; }

    public string PeriodLabel => $"{From:dd MMM yyyy} – {To:dd MMM yyyy}";

    public ReportFilterCriteria Clone() => new()
    {
        From = From,
        To = To,
        BranchId = BranchId,
        DepartmentId = DepartmentId,
        EmployeeId = EmployeeId,
        ProjectId = ProjectId,
        ContractorId = ContractorId,
        Status = Status,
        FinanceCategory = FinanceCategory,
        SiteId = SiteId,
    };
}

public sealed class ReportFilterPreset
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public ReportFilterCriteria Criteria { get; set; } = new();
    public bool IsBuiltIn { get; set; }
}

public static class ReportFilterPresets
{
    public static IReadOnlyList<ReportFilterPreset> BuiltIn { get; } =
    [
        new() { Id = "7d", Name = "Last 7 days", IsBuiltIn = true,
            Criteria = new() { From = DateOnly.FromDateTime(DateTime.Today.AddDays(-7)), To = DateOnly.FromDateTime(DateTime.Today) } },
        new() { Id = "30d", Name = "Last 30 days", IsBuiltIn = true,
            Criteria = new() { From = DateOnly.FromDateTime(DateTime.Today.AddDays(-30)), To = DateOnly.FromDateTime(DateTime.Today) } },
        new() { Id = "month", Name = "This month", IsBuiltIn = true,
            Criteria = new() { From = new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1), To = DateOnly.FromDateTime(DateTime.Today) } },
        new() { Id = "year", Name = "This year", IsBuiltIn = true,
            Criteria = new() { From = new DateOnly(DateTime.Today.Year, 1, 1), To = DateOnly.FromDateTime(DateTime.Today) } },
    ];
}
