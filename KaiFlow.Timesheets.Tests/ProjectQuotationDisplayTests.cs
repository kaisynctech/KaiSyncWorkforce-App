using KaiFlow.Timesheets.Helpers;
using Xunit;

namespace KaiFlow.Timesheets.Tests;

public class ProjectQuotationDisplayTests
{
    [Fact]
    public void IsSummaryLine_matches_total_agreed_amount()
    {
        Assert.True(ProjectQuotationDisplay.IsSummaryLine("Total agreed amount"));
        Assert.False(ProjectQuotationDisplay.IsSummaryLine("Labor"));
    }

    [Fact]
    public void ClientTotalAmount_uses_offer_not_duplicate_summaries()
    {
        var lines = new[]
        {
            ("Labor", 500.0, 1),
            ("Total agreed amount", 2000.0, 2),
            ("Total agreed amount", 2000.0, 3),
        };

        Assert.Equal(2000, ProjectQuotationDisplay.ClientTotalAmount(2000, lines));
    }

    [Fact]
    public void ClientTotalAmount_without_offer_sums_non_summary_lines_only()
    {
        var lines = new[]
        {
            ("Labor", 500.0, 1),
            ("Materials", 300.0, 2),
            ("Total agreed amount", 9999.0, 3),
        };

        Assert.Equal(800, ProjectQuotationDisplay.ClientTotalAmount(0, lines));
    }
}
