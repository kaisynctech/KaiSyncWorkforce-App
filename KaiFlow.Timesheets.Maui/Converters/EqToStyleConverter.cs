using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

/// <summary>
/// Maps a string value to a colour using a pipe-delimited lookup.
/// ConverterParameter="key1|color1,key2|color2,fallbackColor"
/// e.g. "critical|#7F1D1D,high|#7C2D12,medium|#78350F,#14532D"
/// </summary>
public class EqToStyleConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var input = value?.ToString() ?? "";
        var param = parameter as string ?? "";
        var entries = param.Split(',');

        foreach (var entry in entries)
        {
            var parts = entry.Split('|');
            if (parts.Length == 2)
            {
                if (input.Equals(parts[0], StringComparison.OrdinalIgnoreCase))
                    return Color.FromArgb(parts[1]);
            }
            else if (parts.Length == 1)
            {
                // fallback colour
                return Color.FromArgb(parts[0]);
            }
        }
        return Colors.Transparent;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
