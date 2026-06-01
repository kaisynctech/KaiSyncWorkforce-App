namespace KaiFlow.Timesheets.Helpers;

/// <summary>Client-facing quotation lines: hide HR summary rows and use agreed offer as total.</summary>
public static class ProjectQuotationDisplay
{
    public const string SummaryLineDescription = "Total agreed amount";

    public static bool IsSummaryLine(string? description) =>
        !string.IsNullOrWhiteSpace(description) &&
        description.Trim().Equals(SummaryLineDescription, StringComparison.OrdinalIgnoreCase);

    public static IReadOnlyList<(string Description, double LineTotal, int LineNo)> LineItemsForClient(
        IEnumerable<(string Description, double LineTotal, int LineNo)> lines) =>
        lines.Where(l => !IsSummaryLine(l.Description)).OrderBy(l => l.LineNo).ToList();

    /// <summary>Authoritative total for client portal: agreed offer, not sum of duplicate summary lines.</summary>
    public static double ClientTotalAmount(
        double offerAmount,
        IEnumerable<(string Description, double LineTotal, int LineNo)> lines)
    {
        if (offerAmount > 0)
            return offerAmount;

        return LineItemsForClient(lines).Sum(l => l.LineTotal);
    }

    public static string ClientTotalDisplay(
        double offerAmount,
        IEnumerable<(string Description, double LineTotal, int LineNo)> lines) =>
        $"R{ClientTotalAmount(offerAmount, lines):N2}";
}
