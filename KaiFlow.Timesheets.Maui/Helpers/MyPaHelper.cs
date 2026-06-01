using System.Globalization;
using System.Text;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

public static class MyPaHelper
{
    public static (int Open, int Overdue, int DueToday) Metrics(IEnumerable<PaTask> tasks)
    {
        var open = 0;
        var overdue = 0;
        var dueToday = 0;
        foreach (var t in tasks)
        {
            if (!t.IsOpen) continue;
            open++;
            if (t.IsOverdue) overdue++;
            if (t.IsDueToday) dueToday++;
        }
        return (open, overdue, dueToday);
    }

    public static List<PaTask> FilterTasks(IEnumerable<PaTask> tasks, string filter) =>
        filter switch
        {
            "all" => tasks.OrderBy(t => t.EffectiveDue ?? DateTime.MaxValue).ThenByDescending(t => t.CreatedAt).ToList(),
            "overdue" => tasks.Where(t => t.IsOverdue).OrderBy(t => t.EffectiveDue).ToList(),
            "todo" => tasks.Where(t => t.StatusRaw is "todo" or "open" && t.IsOpen).ToList(),
            "in_progress" => tasks.Where(t => t.StatusRaw is "in_progress" or "inProgress").ToList(),
            "done" => tasks.Where(t => t.IsDone).OrderByDescending(t => t.CompletedAt ?? t.UpdatedAt).ToList(),
            _ => tasks.Where(t => t.StatusRaw == filter && t.IsOpen).ToList()
        };

    public static List<MyPaCalendarEntry> BuildCalendarEntries(
        IEnumerable<PaTask> tasks,
        IEnumerable<Job> jobs,
        IEnumerable<ClientDeal> deals,
        Guid? ownerEmployeeId)
    {
        var entries = new List<MyPaCalendarEntry>();

        foreach (var t in tasks)
        {
            var start = t.MeetingAt ?? t.EffectiveDue ?? t.RemindAt ?? t.CreatedAt;
            entries.Add(new MyPaCalendarEntry
            {
                Id = $"pa_{t.Id}",
                Title = t.Title,
                Subtitle = t.SourceBadge,
                Start = start,
                End = t.MeetingAt?.AddMinutes(45),
                Kind = t.MeetingAt.HasValue ? "meeting" : "task",
                KindLabel = t.MeetingAt.HasValue ? "Meeting" : "Due",
                Task = t,
                LinkedJobId = t.LinkedTypeRaw == "job" && Guid.TryParse(t.LinkedId, out var jid) ? jid : null,
                LinkedDealId = t.LinkedTypeRaw == "deal" && Guid.TryParse(t.LinkedId, out var did) ? did : null,
                IsDone = t.IsDone
            });
        }

        var taskJobIds = tasks
            .Where(t => t.LinkedTypeRaw == "job" && t.LinkedId != null)
            .Select(t => t.LinkedId!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var j in jobs)
        {
            if (j.ScheduledStart == null) continue;
            if (ownerEmployeeId.HasValue
                && j.AssigneeEmployeeId != ownerEmployeeId
                && !(j.AssignedEmployeeIds ?? []).Contains(ownerEmployeeId.Value))
                continue;
            if (taskJobIds.Contains(j.Id.ToString())) continue;

            entries.Add(new MyPaCalendarEntry
            {
                Id = $"job_{j.Id}",
                Title = j.Title,
                Subtitle = "Scheduled job",
                Start = j.ScheduledStart.Value,
                End = j.ScheduledEnd,
                Kind = "job",
                KindLabel = "Job",
                LinkedJobId = j.Id,
                IsDone = j.StatusRaw is "completed" or "cancelled"
            });
        }

        foreach (var d in deals)
        {
            if (!d.ExpectedCloseDate.HasValue) continue;
            if (ownerEmployeeId.HasValue && d.ManagerEmployeeId != ownerEmployeeId) continue;

            var start = d.ExpectedCloseDate.Value.ToDateTime(TimeOnly.MinValue).AddHours(9);
            entries.Add(new MyPaCalendarEntry
            {
                Id = $"deal_{d.Id}",
                Title = d.Title,
                Subtitle = "Project close date",
                Start = start,
                Kind = "project",
                KindLabel = "Project",
                LinkedDealId = d.Id,
                IsDone = d.StatusRaw is "won" or "lost"
            });
        }

        return entries.OrderBy(e => e.Start).ToList();
    }

    public static List<MyPaCalendarEntry> EntriesOnDay(IEnumerable<MyPaCalendarEntry> all, DateTime day)
    {
        var d0 = day.Date;
        return all.Where(e => e.Start.Date == d0).OrderBy(e => e.Start).ToList();
    }

    public static List<PaTask> UpcomingReminders(IEnumerable<PaTask> tasks, int daysAhead = 3)
    {
        var now = DateTime.Now;
        var horizon = now.AddDays(daysAhead);
        return tasks
            .Where(t => t.IsOpen && t.RemindAt.HasValue)
            .Where(t =>
            {
                var r = t.RemindAt!.Value;
                return r >= now.AddMinutes(-1) && r <= horizon;
            })
            .OrderBy(t => t.RemindAt)
            .ToList();
    }

    public static List<MyPaMonthDay> BuildMonthGrid(
        DateTime month,
        DateTime selectedDay,
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks)
    {
        var first = new DateTime(month.Year, month.Month, 1);
        var daysInMonth = DateTime.DaysInMonth(month.Year, month.Month);
        var leading = ((int)first.DayOfWeek + 6) % 7;
        var cells = new List<MyPaMonthDay>();
        var today = DateTime.Today;

        for (var i = 0; i < leading; i++)
            cells.Add(new MyPaMonthDay { DayNumber = 0, Date = default });

        for (var d = 1; d <= daysInMonth; d++)
        {
            var date = new DateTime(month.Year, month.Month, d);
            var markers = MarkerColorsForDay(date, entries, tasks);
            var (chips, overflow) = DayChips(date, entries, tasks, maxChips: 2);
            cells.Add(new MyPaMonthDay
            {
                DayNumber = d,
                Date = date,
                IsToday = date.Date == today,
                IsSelected = date.Date == selectedDay.Date,
                HasEvents = markers.Count > 0,
                EventCount = markers.Count,
                MarkerColors = markers,
                EventChips = chips,
                OverflowCount = overflow
            });
        }

        while (cells.Count % 7 != 0)
            cells.Add(new MyPaMonthDay { DayNumber = 0, Date = default });

        return cells;
    }

    public static List<string> MarkerColorsForDay(
        DateTime day,
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks)
    {
        var d0 = day.Date;
        var colors = new List<string>();

        foreach (var e in entries.Where(x => x.Start.Date == d0))
            AddMarker(colors, e.IsExternal ? "external" : e.Kind);

        foreach (var t in tasks)
        {
            if (t.MeetingAt?.Date == d0) AddMarker(colors, "meeting");
            if (t.EffectiveDue?.Date == d0) AddMarker(colors, "task");
            if (t.IsOpen && t.RemindAt?.Date == d0) AddMarker(colors, "reminder");
        }

        return colors.Take(4).ToList();
    }

    /// <summary>
    /// Returns up to <paramref name="maxChips"/> short event chips for a day plus the
    /// number of additional events not shown, for in-cell calendar rendering.
    /// </summary>
    public static (List<MyPaDayChip> Chips, int Overflow) DayChips(
        DateTime day,
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks,
        int maxChips)
    {
        var dayEntries = EntriesForDayIncludingReminders(entries, tasks, day);
        var chips = dayEntries
            .Take(maxChips)
            .Select(e => new MyPaDayChip { Title = e.Title, Color = e.AccentColor })
            .ToList();
        var overflow = Math.Max(0, dayEntries.Count - chips.Count);
        return (chips, overflow);
    }

    private static void AddMarker(List<string> colors, string kind)
    {
        var hex = kind switch
        {
            "meeting" => "#F97316",
            "job" => "#8B5CF6",
            "project" => "#10B981",
            "reminder" => "#22C55E",
            "external" => "#64748B",
            _ => "#3B82F6"
        };
        if (!colors.Contains(hex))
            colors.Add(hex);
    }

    public static List<MyPaCalendarEntry> EntriesForDayIncludingReminders(
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks,
        DateTime day)
    {
        var list = EntriesOnDay(entries, day).ToList();
        var d0 = day.Date;
        foreach (var t in tasks.Where(t => t.IsOpen && t.RemindAt?.Date == d0))
        {
            if (list.Any(e => e.Task?.Id == t.Id)) continue;
            list.Add(new MyPaCalendarEntry
            {
                Id = $"remind_{t.Id}",
                Title = t.Title,
                Subtitle = "Reminder",
                Start = t.RemindAt!.Value,
                Kind = "reminder",
                KindLabel = "Reminder",
                Task = t,
                IsDone = false
            });
        }
        return list.OrderBy(e => e.Start).ToList();
    }

    public static DateTime StartOfWeekMonday(DateTime day)
    {
        var d = day.Date;
        var offset = ((int)d.DayOfWeek + 6) % 7;
        return d.AddDays(-offset);
    }

    public static List<MyPaMonthDay> BuildWeekDays(
        DateTime anchorDay,
        DateTime selectedDay,
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks)
    {
        var weekStart = StartOfWeekMonday(anchorDay);
        var today = DateTime.Today;
        var cells = new List<MyPaMonthDay>();
        for (var i = 0; i < 7; i++)
        {
            var date = weekStart.AddDays(i);
            var markers = MarkerColorsForDay(date, entries, tasks);
            var (chips, overflow) = DayChips(date, entries, tasks, maxChips: 3);
            cells.Add(new MyPaMonthDay
            {
                DayNumber = date.Day,
                Date = date,
                IsToday = date.Date == today,
                IsSelected = date.Date == selectedDay.Date,
                HasEvents = markers.Count > 0,
                EventCount = markers.Count,
                MarkerColors = markers,
                EventChips = chips,
                OverflowCount = overflow
            });
        }
        return cells;
    }

    public static string WeekRangeLabel(DateTime anchorDay)
    {
        var start = StartOfWeekMonday(anchorDay);
        var end = start.AddDays(6);
        return start.Month == end.Month
            ? $"{start:dd} – {end:dd MMMM yyyy}"
            : $"{start:dd MMM} – {end:dd MMM yyyy}";
    }

    public static List<MyPaCalendarEntry> EntriesInRange(
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks,
        DateTime from,
        DateTime to)
    {
        var list = new List<MyPaCalendarEntry>();
        for (var d = from.Date; d <= to.Date; d = d.AddDays(1))
            list.AddRange(EntriesForDayIncludingReminders(entries, tasks, d));
        return list.OrderBy(e => e.Start).ToList();
    }

    public static string BuildIcsCalendar(IEnumerable<MyPaCalendarEntry> entries, string calendarName = "KaiFlow My PA")
    {
        var sb = new StringBuilder();
        sb.AppendLine("BEGIN:VCALENDAR");
        sb.AppendLine("VERSION:2.0");
        sb.AppendLine("PRODID:-//KaiFlow//My PA//EN");
        sb.AppendLine("CALSCALE:GREGORIAN");
        sb.AppendLine($"X-WR-CALNAME:{EscapeIcs(calendarName)}");

        foreach (var e in entries)
        {
            var uid = $"{e.Id}@kaiflow.app";
            var startUtc = e.Start.ToUniversalTime();
            var endUtc = (e.End ?? e.Start.AddHours(1)).ToUniversalTime();
            sb.AppendLine("BEGIN:VEVENT");
            sb.AppendLine($"UID:{uid}");
            sb.AppendLine($"DTSTAMP:{FormatIcsUtc(DateTime.UtcNow)}");
            sb.AppendLine($"DTSTART:{FormatIcsUtc(startUtc)}");
            sb.AppendLine($"DTEND:{FormatIcsUtc(endUtc)}");
            sb.AppendLine($"SUMMARY:{EscapeIcs(e.Title)}");
            if (!string.IsNullOrWhiteSpace(e.Subtitle))
                sb.AppendLine($"DESCRIPTION:{EscapeIcs($"{e.KindLabel}: {e.Subtitle}")}");
            sb.AppendLine($"CATEGORIES:{EscapeIcs(e.KindLabel)}");
            sb.AppendLine("END:VEVENT");
        }

        sb.AppendLine("END:VCALENDAR");
        return sb.ToString();
    }

    private static string FormatIcsUtc(DateTime utc)
        => utc.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);

    private static string EscapeIcs(string value)
        => value.Replace("\\", "\\\\").Replace("\n", "\\n").Replace(",", "\\,").Replace(";", "\\;");

    public static List<MyPaCalendarEntry> FromExternalEvents(IEnumerable<ExternalCalendarEvent> events) =>
        events.Select(e => new MyPaCalendarEntry
        {
            Id = $"ext_{e.Id}",
            Title = e.Title,
            Subtitle = e.Location ?? e.Provider,
            Start = e.StartTime,
            End = e.EndTime,
            Kind = "external",
            KindLabel = e.Provider == "outlook" ? "Outlook" : "Google",
            IsDone = false,
            IsExternal = true
        }).ToList();

    public static List<MyPaCalendarEntry> MergeWithExternal(
        IEnumerable<MyPaCalendarEntry> kaiFlow,
        IEnumerable<ExternalCalendarEvent> external) =>
        kaiFlow.Concat(FromExternalEvents(external)).OrderBy(e => e.Start).ToList();

    public static List<MyPaBriefingItem> BuildBriefing(
        IEnumerable<PaTask> tasks,
        IEnumerable<MyPaCalendarEntry> entries,
        DateTime day)
    {
        var items = new List<MyPaBriefingItem>();
        var d0 = day.Date;

        foreach (var t in tasks.Where(t => t.IsOverdue).OrderBy(t => t.EffectiveDue))
            items.Add(new MyPaBriefingItem
            {
                Icon = "⚠️",
                Title = t.Title,
                Subtitle = $"Overdue · {t.SourceBadge}",
                AccentColor = "#FCA5A5",
                Task = t,
                When = t.EffectiveDue
            });

        foreach (var e in entries.Where(e => e.Start.Date == d0 && e.Kind == "meeting").OrderBy(e => e.Start))
            items.Add(new MyPaBriefingItem
            {
                Icon = "📅",
                Title = e.Title,
                Subtitle = $"Meeting · {e.TimeDisplay}",
                AccentColor = "#F97316",
                Entry = e,
                When = e.Start
            });

        foreach (var t in tasks.Where(t => t.IsDueToday && t.IsOpen).OrderBy(t => t.EffectiveDue))
            items.Add(new MyPaBriefingItem
            {
                Icon = "✅",
                Title = t.Title,
                Subtitle = t.EffectiveDue.HasValue ? $"Due {t.EffectiveDue:HH:mm}" : "Due today",
                AccentColor = "#3B82F6",
                Task = t,
                When = t.EffectiveDue
            });

        foreach (var t in tasks.Where(t => t.IsOpen && t.SourceType == "job_sla_risk"))
            items.Add(new MyPaBriefingItem
            {
                Icon = "🔧",
                Title = t.Title,
                Subtitle = "Job SLA risk",
                AccentColor = "#8B5CF6",
                Task = t
            });

        foreach (var t in UpcomingReminders(tasks, 1))
            items.Add(new MyPaBriefingItem
            {
                Icon = "🔔",
                Title = t.Title,
                Subtitle = $"Reminder {t.RemindAt:HH:mm}",
                AccentColor = "#22C55E",
                Task = t,
                When = t.RemindAt
            });

        return items;
    }

    public static List<MyPaSearchResult> Search(
        string query,
        IEnumerable<PaTask> tasks,
        IEnumerable<MyPaCalendarEntry> entries)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];
        var q = query.Trim();
        var results = new List<MyPaSearchResult>();

        foreach (var t in tasks.Where(t =>
                     t.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
                     || (t.Notes?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)
                     || (t.MeetingMinutes?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)
                     || (t.MeetingFollowUp?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)
                     || (t.LinkedLabel?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)))
        {
            results.Add(new MyPaSearchResult
            {
                Kind = "task",
                Title = t.Title,
                Subtitle = t.SourceBadge,
                Task = t
            });
        }

        foreach (var e in entries.Where(e =>
                     e.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
                     || (e.Subtitle?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)))
        {
            if (results.Any(r => r.Task?.Id == e.Task?.Id && e.Task != null)) continue;
            results.Add(new MyPaSearchResult
            {
                Kind = e.Kind,
                Title = e.Title,
                Subtitle = e.KindLabel,
                Entry = e,
                Task = e.Task
            });
        }

        return results.Take(40).ToList();
    }

    public static List<string> FindConflicts(
        DateTime start,
        DateTime? end,
        IEnumerable<MyPaCalendarEntry> entries,
        IEnumerable<PaTask> tasks,
        Guid? excludeTaskId = null)
    {
        var slotEnd = end ?? start.AddHours(1);
        var conflicts = new List<string>();

        foreach (var e in entries.Where(x => !x.IsDone))
        {
            var eEnd = e.End ?? e.Start.AddHours(1);
            if (Overlaps(start, slotEnd, e.Start, eEnd))
                conflicts.Add($"{e.KindLabel}: {e.Title} ({e.TimeDisplay})");
        }

        foreach (var t in tasks.Where(t => t.IsOpen && t.Id != excludeTaskId))
        {
            foreach (var when in new[] { t.MeetingAt, t.EffectiveDue, t.RemindAt })
            {
                if (!when.HasValue) continue;
                var wEnd = when.Value.AddHours(1);
                if (Overlaps(start, slotEnd, when.Value, wEnd))
                    conflicts.Add($"Task: {t.Title} ({when:HH:mm})");
            }
        }

        return conflicts.Distinct().Take(6).ToList();
    }

    private static bool Overlaps(DateTime aStart, DateTime aEnd, DateTime bStart, DateTime bEnd)
        => aStart < bEnd && bStart < aEnd;

    public static List<MyPaTimelineSlot> BuildTimeline(
        IEnumerable<MyPaCalendarEntry> dayEntries,
        int startHour = 8,
        int endHour = 18)
    {
        var slots = new List<MyPaTimelineSlot>();
        for (var h = startHour; h <= endHour; h++)
        {
            var hourEntries = dayEntries
                .Where(e => e.Start.Hour == h || (e.End.HasValue && e.Start.Hour < h && e.End.Value.Hour >= h))
                .ToList();
            slots.Add(new MyPaTimelineSlot { Hour = h, Entries = hourEntries });
        }
        return slots;
    }

    public static List<PaTask> FilterFocus(IEnumerable<PaTask> tasks) =>
        tasks.Where(t => t.IsOpen && (t.IsOverdue || t.IsDueToday || t.PriorityRaw is "urgent" or "high"))
            .OrderBy(t => t.EffectiveDue ?? DateTime.MaxValue)
            .ToList();

    public static DateTime? SnoozeUntil(string preset)
    {
        var now = DateTime.Now;
        return preset switch
        {
            "later_today" => now.Date.AddHours(now.Hour < 14 ? 14 : 17),
            "tomorrow_9" => now.Date.AddDays(1).AddHours(9),
            "next_monday" => StartOfWeekMonday(now).AddDays(7).AddHours(9),
            _ => now.AddHours(2)
        };
    }

    public static PaTask? SpawnNextRecurrence(PaTask completed)
    {
        if (completed.RecurrencePattern is not ("daily" or "weekly" or "monthly")) return null;
        var baseDue = completed.EffectiveDue ?? DateTime.Today.AddHours(9);
        var nextDue = completed.RecurrencePattern switch
        {
            "daily" => baseDue.AddDays(1),
            "weekly" => baseDue.AddDays(7),
            "monthly" => baseDue.AddMonths(1),
            _ => baseDue.AddDays(1)
        };
        return new PaTask
        {
            CompanyId = completed.CompanyId,
            Title = completed.Title,
            Notes = completed.Notes,
            Description = completed.Description,
            PriorityRaw = completed.PriorityRaw,
            LinkedTypeRaw = completed.LinkedTypeRaw,
            LinkedId = completed.LinkedId,
            LinkedLabel = completed.LinkedLabel,
            RecurrencePattern = completed.RecurrencePattern,
            MeetingWith = completed.MeetingWith,
            DueAt = nextDue,
            DueDate = DateOnly.FromDateTime(nextDue),
            RemindAt = completed.RemindAt.HasValue ? nextDue.AddHours(-1) : null,
            OwnerEmployeeId = completed.OwnerEmployeeId,
            AssignedEmployeeId = completed.AssignedEmployeeId,
            TemplateId = completed.TemplateId,
            SourceType = "manual",
            StatusRaw = "todo"
        };
    }

    public static PaTask DraftFromTemplate(PaTaskTemplate template, Guid companyId, Guid ownerId) =>
        new()
        {
            CompanyId = companyId,
            Title = template.Title,
            Notes = template.Description,
            Description = template.Description,
            PriorityRaw = template.DefaultPriority,
            RecurrencePattern = template.RecurrenceRule ?? "none",
            TemplateId = template.Id,
            OwnerEmployeeId = ownerId,
            AssignedEmployeeId = ownerId,
            DueAt = DateTime.Today.AddDays(1).AddHours(9),
            DueDate = DateOnly.FromDateTime(DateTime.Today.AddDays(1)),
            SourceType = "manual",
            StatusRaw = "todo"
        };

    public static List<MyPaManagerDigestLine> BuildManagerDigest(IEnumerable<PaTask> allCompanyTasks)
    {
        var open = allCompanyTasks.Where(t => t.IsOpen).ToList();
        return
        [
            new() { Label = "Open tasks", Count = open.Count, Color = "#3B82F6" },
            new() { Label = "Overdue", Count = open.Count(t => t.IsOverdue), Color = "#FCA5A5" },
            new() { Label = "Due today", Count = open.Count(t => t.IsDueToday), Color = "#6C63FF" },
            new() { Label = "SLA risks", Count = open.Count(t => t.SourceType == "job_sla_risk"), Color = "#8B5CF6" },
            new() { Label = "Meetings today", Count = open.Count(t => t.MeetingAt?.Date == DateTime.Today), Color = "#F97316" }
        ];
    }

    public static List<PaTask> TodayStrip(IEnumerable<PaTask> tasks, int max = 3) =>
        tasks.Where(t => t.IsOpen)
            .OrderBy(t => t.IsOverdue ? 0 : t.IsDueToday ? 1 : 2)
            .ThenBy(t => t.EffectiveDue ?? DateTime.MaxValue)
            .Take(max)
            .ToList();
}
