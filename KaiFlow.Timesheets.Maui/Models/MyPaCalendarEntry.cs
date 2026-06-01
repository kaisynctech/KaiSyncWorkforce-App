namespace KaiFlow.Timesheets.Models;

/// <summary>Unified calendar row: PA task, assigned job, or project deadline.</summary>
public class MyPaCalendarEntry
{
    public string Id { get; init; } = "";
    public string Title { get; init; } = "";
    public string? Subtitle { get; init; }
    public DateTime Start { get; init; }
    public DateTime? End { get; init; }
    public string Kind { get; init; } = "task";
    public string KindLabel { get; init; } = "Task";
    public PaTask? Task { get; init; }
    public Guid? LinkedJobId { get; init; }
    public Guid? LinkedDealId { get; init; }
    public bool IsDone { get; init; }
    public bool IsExternal { get; init; }

    public string AccentColor => Kind switch
    {
        "meeting" => "#F97316",
        "job" => "#8B5CF6",
        "project" => "#10B981",
        "task" => "#3B82F6",
        "reminder" => "#22C55E",
        "external" => "#64748B",
        _ => "#6C63FF"
    };

    public string TimeDisplay => End.HasValue && End.Value.Date == Start.Date
        ? $"{Start:HH:mm} – {End:HH:mm}"
        : Start.ToString("HH:mm");

    public bool CanReschedule =>
        Task != null && !Task.IsSystemGenerated && Kind is not "job" and not "project";

    public string IconGlyph => Kind switch
    {
        "meeting" => "\uE787",
        "job" => "\uE8F9",
        "project" => "\uE7C3",
        _ => "\uE715"
    };
}
