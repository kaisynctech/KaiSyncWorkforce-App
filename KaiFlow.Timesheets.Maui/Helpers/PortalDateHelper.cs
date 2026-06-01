namespace KaiFlow.Timesheets.Helpers;

/// <summary>Filters unset SQL/default dates and converts DB UTC timestamps for display.</summary>
public static class PortalDateHelper
{
    public const int MinValidYear = 1900;

    public static bool IsSet(DateOnly? date) =>
        date is { Year: >= MinValidYear };

    public static bool IsSet(DateTime? date) =>
        date is { Year: >= MinValidYear };

    public static bool IsSet(DateTime date) =>
        date.Year >= MinValidYear;

    /// <summary>Supabase/PostgREST often returns UTC without DateTimeKind — treat Unspecified as UTC.</summary>
    public static DateTime ToLocalFromDb(DateTime value)
    {
        if (!IsSet(value))
            return value;
        if (value.Kind == DateTimeKind.Local)
            return value;
        var utc = value.Kind == DateTimeKind.Utc
            ? value
            : DateTime.SpecifyKind(value, DateTimeKind.Utc);
        return utc.ToLocalTime();
    }

    public static DateOnly? Normalize(DateOnly? date) =>
        IsSet(date) ? date : null;

    public static string Format(DateOnly? date) =>
        IsSet(date) ? date!.Value.ToString("dd MMM yyyy") : "—";

    public static string Format(DateTime? date) =>
        date is { } d && IsSet(d) ? ToLocalFromDb(d).ToString("dd MMM yyyy") : "—";

    public static string FormatDateTime(DateTime? date) =>
        date is { } d && IsSet(d) ? ToLocalFromDb(d).ToString("dd MMM yyyy HH:mm") : "—";

    public static string FormatDateTime(DateTime date) =>
        IsSet(date) ? ToLocalFromDb(date).ToString("dd MMM yyyy HH:mm") : "—";

    public static string FormatTime(DateTime? date) =>
        date is { } d && IsSet(d) ? ToLocalFromDb(d).ToString("HH:mm") : "—";

    public static string FormatTime(DateTime date) =>
        IsSet(date) ? ToLocalFromDb(date).ToString("HH:mm") : "—";

    public static string FormatShortDate(DateTime? date) =>
        date is { } d && IsSet(d) ? ToLocalFromDb(d).ToString("dd MMM") : "—";
}
