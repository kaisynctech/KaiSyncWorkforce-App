namespace KaiFlow.Timesheets.Helpers;

/// <summary>Responsive HR projects table — only Project flexes; other columns have balanced fixed widths.</summary>
public static class HrProjectsTableLayout
{
    /// <summary>Code | Project(*) | Client | Manager | Status | Offer | Paid | Progress | Jobs | Pay</summary>
    public const string ColumnDefinitions = "72,*,88,108,128,92,84,56,80,72";

    public const double ColumnSpacing = 8;
}
