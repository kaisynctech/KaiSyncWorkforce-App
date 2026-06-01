namespace KaiFlow.Timesheets.Helpers;

/// <summary>Responsive HR jobs table — only Title flexes; other columns have balanced fixed widths.</summary>
public static class HrJobsTableLayout
{
    /// <summary>Code | Title(*) | Status | Client | Linked project | Assignee | Scheduled | Priority</summary>
    public const string ColumnDefinitions = "72,*,88,96,88,120,100,88,72";

    public const double ColumnSpacing = 8;
}
