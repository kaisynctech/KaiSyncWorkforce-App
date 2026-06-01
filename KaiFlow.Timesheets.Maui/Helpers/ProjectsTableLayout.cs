namespace KaiFlow.Timesheets.Helpers;

/// <summary>Fixed-width CRM project table columns (no star — avoids huge gaps and column overlap).</summary>
public static class ProjectsTableLayout
{
    /// <summary>Code | Project | Status | Offer | Paid | Progress | Balance | Jobs | Pay | Docs</summary>
    public const string ColumnDefinitions =
        "84,1,176,1,132,1,92,1,84,1,72,1,104,1,100,1,72,1,48";

    public const double ScrollWidth = 1120;
}
