using KaiFlow.Timesheets.Models;
using Xunit;

namespace KaiFlow.Timesheets.Tests;

/// <summary>Logic mirrors MyPaHelper for regression coverage without linking the full MAUI graph.</summary>
public class MyPaHelperTests
{
    private static DateTime StartOfWeekMonday(DateTime day)
    {
        var d = day.Date;
        var offset = ((int)d.DayOfWeek + 6) % 7;
        return d.AddDays(-offset);
    }

    [Fact]
    public void WeekRangeLabel_FormatsSameMonth()
    {
        var start = StartOfWeekMonday(new DateTime(2026, 5, 15));
        var end = start.AddDays(6);
        var label = start.Month == end.Month
            ? $"{start:dd} – {end:dd MMMM yyyy}"
            : $"{start:dd MMM} – {end:dd MMM yyyy}";
        Assert.Contains("May", label);
        Assert.Contains("–", label);
    }

    [Fact]
    public void PaTask_IsOverdue_WhenDueInPastAndOpen()
    {
        var t = new PaTask
        {
            Id = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            Title = "Late",
            StatusRaw = "todo",
            DueAt = DateTime.Now.AddDays(-1)
        };
        Assert.True(t.IsOverdue);
        Assert.True(t.IsOpen);
    }

    [Fact]
    public void PaTask_IsDone_WhenStatusCompleted()
    {
        var t = new PaTask
        {
            Id = Guid.NewGuid(),
            CompanyId = Guid.NewGuid(),
            Title = "Done",
            StatusRaw = "done"
        };
        Assert.True(t.IsDone);
        Assert.False(t.IsOverdue);
    }

    [Fact]
    public void MyPaCalendarEntry_CanReschedule_OnlyPersonalTasks()
    {
        var personal = new MyPaCalendarEntry
        {
            Kind = "task",
            Task = new PaTask { Id = Guid.NewGuid(), CompanyId = Guid.NewGuid(), Title = "x", SourceType = "manual" }
        };
        var system = new MyPaCalendarEntry
        {
            Kind = "task",
            Task = new PaTask { Id = Guid.NewGuid(), CompanyId = Guid.NewGuid(), Title = "x", SourceType = "job_assignment" }
        };
        Assert.True(personal.CanReschedule);
        Assert.False(system.CanReschedule);
    }
}
