using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public static class ProjectProgressHelper
{
    /// <summary>
    /// Auto progress from payments received vs offer and jobs completed on the project.
    /// </summary>
    public static int ComputePercent(ClientDeal deal, IEnumerable<Job> jobs)
    {
        if (deal.StatusRaw == "won") return 100;
        if (deal.StatusRaw == "lost") return Math.Clamp(deal.ProgressPercent, 0, 100);

        var paymentPct = 0;
        if (deal.OfferAmount > 0)
            paymentPct = (int)Math.Min(100, Math.Round(deal.AmountPaid / deal.OfferAmount * 100));

        var onProject = jobs.Where(j => j.DealId == deal.Id).ToList();
        var jobPct = 0;
        if (onProject.Count > 0)
        {
            var done = onProject.Count(j =>
                j.StatusRaw is "completed" or "Completed");
            jobPct = (int)Math.Round(done * 100.0 / onProject.Count);
        }

        return Math.Clamp(Math.Max(paymentPct, jobPct), 0, 100);
    }
}
