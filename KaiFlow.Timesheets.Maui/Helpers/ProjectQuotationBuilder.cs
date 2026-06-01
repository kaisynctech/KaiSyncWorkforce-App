using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public static class ProjectQuotationBuilder
{
    public static string Build(Client? client, ClientDeal deal, IEnumerable<ProjectQuotationLine> lines, string? companyName = null)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine("QUOTATION");
        sb.AppendLine(new string('=', 48));
        if (!string.IsNullOrWhiteSpace(companyName))
            sb.AppendLine($"From: {companyName}");
        if (client != null)
            sb.AppendLine($"To:   {client.Name}");
        sb.AppendLine($"Project: {deal.ProjectCodeDisplay} — {deal.Title}");
        sb.AppendLine($"Date:    {DateTime.Today:dd MMM yyyy}");
        if (deal.QuotationValidUntil.HasValue)
            sb.AppendLine($"Valid until: {deal.QuotationValidUntil.Value:dd MMM yyyy}");
        if (deal.QuotationSentAt.HasValue)
            sb.AppendLine($"Sent: {deal.QuotationSentAt.Value.ToLocalTime():dd MMM yyyy}");
        sb.AppendLine();

        if (!string.IsNullOrWhiteSpace(deal.QuotationNotes))
        {
            sb.AppendLine(deal.QuotationNotes.Trim());
            sb.AppendLine();
        }

        sb.AppendLine("Line items");
        sb.AppendLine(new string('-', 48));
        double total = 0;
        var ordered = lines.OrderBy(l => l.LineNo).ToList();
        if (ordered.Count == 0 && deal.OfferAmount > 0)
        {
            sb.AppendLine(" 1. Total agreed amount");
            sb.AppendLine($"    1.00 × R{deal.OfferAmount:N2} = R{deal.OfferAmount:N2}");
            total = deal.OfferAmount;
        }
        else
        {
            foreach (var line in ordered)
            {
                sb.AppendLine($"{line.LineNo,2}. {line.Description}");
                sb.AppendLine($"    {line.Quantity:N2} × R{line.UnitPrice:N2} = R{line.LineTotal:N2}");
                total += line.LineTotal;
            }
        }
        sb.AppendLine(new string('-', 48));
        sb.AppendLine($"TOTAL: R{total:N2}");
        if (deal.OfferAmount > 0 && Math.Abs(total - deal.OfferAmount) > 0.01)
            sb.AppendLine($"(Agreed project total: R{deal.OfferAmount:N2})");
        sb.AppendLine();
        sb.AppendLine("Thank you for your business.");
        return sb.ToString();
    }
}
