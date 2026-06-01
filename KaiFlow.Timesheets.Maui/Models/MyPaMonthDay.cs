namespace KaiFlow.Timesheets.Models;

/// <summary>One cell in the My PA month grid (empty padding cells use DayNumber = 0).</summary>
public class MyPaMonthDay
{
    public int DayNumber { get; init; }
    public DateTime Date { get; init; }
    public bool IsPlaceholder => DayNumber == 0;
    public bool IsToday { get; init; }
    public bool IsSelected { get; init; }
    public bool HasEvents { get; init; }
    public int EventCount { get; init; }
    /// <summary>Up to 4 accent hex colors for event dots (meeting, due, job, project).</summary>
    public IReadOnlyList<string> MarkerColors { get; init; } = [];

    /// <summary>Short event labels rendered inside the day cell (month/week views).</summary>
    public IReadOnlyList<MyPaDayChip> EventChips { get; init; } = [];

    /// <summary>Count of events beyond those shown as chips.</summary>
    public int OverflowCount { get; init; }
    public bool HasOverflow => OverflowCount > 0;
    public string OverflowLabel => $"+{OverflowCount} more";
    public bool HasChips => EventChips.Count > 0;

    public string WeekdayShort => IsPlaceholder ? "" : Date.ToString("ddd");
}

/// <summary>A single in-cell event chip (title + accent colour) for the calendar grid.</summary>
public class MyPaDayChip
{
    public string Title { get; init; } = "";
    public string Color { get; init; } = "#3B82F6";
}
