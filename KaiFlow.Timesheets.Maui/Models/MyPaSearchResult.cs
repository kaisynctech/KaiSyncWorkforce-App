namespace KaiFlow.Timesheets.Models;

public class MyPaSearchResult
{
    public string Kind { get; init; } = "task";
    public string Title { get; init; } = "";
    public string Subtitle { get; init; } = "";
    public PaTask? Task { get; init; }
    public MyPaCalendarEntry? Entry { get; init; }
}
