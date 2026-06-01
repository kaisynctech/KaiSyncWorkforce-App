namespace KaiFlow.Timesheets.Helpers;

public sealed record PipelineStageOption(string Value, string Label, string ColumnHint);

public static class ProjectPipeline
{
    public static IReadOnlyList<PipelineStageOption> Stages { get; } =
    [
        new("draft", "Draft", "New lead"),
        new("sent", "Quote sent", "Awaiting response"),
        new("negotiation", "Negotiating", "Terms & pricing"),
        new("in_progress", "In progress", "Work underway"),
        new("won", "Won", "Completed / won"),
        new("lost", "Lost", "Did not proceed")
    ];

    public static string LabelFor(string? statusRaw) =>
        Stages.FirstOrDefault(s => s.Value == statusRaw)?.Label ?? "Draft";

    public static string StageAccentColor(string? statusRaw) => statusRaw switch
    {
        "sent" => "#3B82F6",
        "negotiation" => "#F59E0B",
        "in_progress" => "#8B5CF6",
        "won" => "#10B981",
        "lost" => "#EF4444",
        _ => "#6B7280"
    };

    public static int IndexOf(string? statusRaw)
    {
        var i = 0;
        foreach (var s in Stages)
        {
            if (s.Value == statusRaw) return i;
            i++;
        }
        return 0;
    }

    public static string? NextStage(string? statusRaw)
    {
        var idx = IndexOf(statusRaw);
        if (idx < 0 || idx >= Stages.Count - 2) return null;
        if (Stages[idx].Value is "won" or "lost") return null;
        return Stages[idx + 1].Value;
    }
}
