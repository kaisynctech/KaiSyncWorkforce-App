namespace KaiFlow.Timesheets.Models;

public class MyPaTimelineSlot
{
    public int Hour { get; init; }
    public string HourLabel => $"{Hour:00}:00";
    public IReadOnlyList<MyPaCalendarEntry> Entries { get; init; } = [];
    public bool HasEntries => Entries.Count > 0;
}
