using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

/// <summary>
/// Converts a full name string to up to 2 uppercase initials.
/// </summary>
public class InitialsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string name || string.IsNullOrWhiteSpace(name))
            return "?";
        var parts = name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length >= 2
            ? $"{parts[0][0]}{parts[^1][0]}".ToUpperInvariant()
            : parts[0][..Math.Min(2, parts[0].Length)].ToUpperInvariant();
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
