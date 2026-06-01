namespace KaiFlow.Timesheets.Models;

public class MyPaBriefingItem
{
    public string Icon { get; init; } = "📌";
    public string Title { get; init; } = "";
    public string Subtitle { get; init; } = "";
    public string AccentColor { get; init; } = "#6C63FF";
    public PaTask? Task { get; init; }
    public MyPaCalendarEntry? Entry { get; init; }
    public DateTime? When { get; init; }
}
