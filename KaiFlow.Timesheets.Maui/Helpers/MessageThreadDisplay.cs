namespace KaiFlow.Timesheets.Helpers;

public static class MessageThreadDisplay
{
    public static bool TryParseDealId(string? subject, out Guid dealId)
    {
        dealId = Guid.Empty;
        if (string.IsNullOrWhiteSpace(subject) || !subject.StartsWith("Deal:", StringComparison.OrdinalIgnoreCase))
            return false;
        return Guid.TryParse(subject.AsSpan(5), out dealId);
    }

    public static bool TryParseJobId(string? subject, out Guid jobId)
    {
        jobId = Guid.Empty;
        if (string.IsNullOrWhiteSpace(subject) || !subject.StartsWith("Job:", StringComparison.OrdinalIgnoreCase))
            return false;
        return Guid.TryParse(subject.AsSpan(4), out jobId);
    }

    public static string DealThreadTitle(string clientName, string projectTitle) =>
        $"{clientName.Trim()} — {projectTitle.Trim()}";

    public static string JobThreadTitle(string jobTitle) =>
        $"Job: {jobTitle.Trim()}";
}
