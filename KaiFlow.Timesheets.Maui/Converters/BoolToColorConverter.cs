using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

/// <summary>
/// ConverterParameter="trueColor|falseColor" — accepts hex strings like "#4ADE80|#6B7280"
/// </summary>
public class BoolToColorConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var isTrue = value is bool b && b;
        var parts = (parameter as string)?.Split('|');
        if (parts?.Length >= 2)
        {
            var hex = isTrue ? parts[0] : parts[1];
            return Color.FromArgb(hex);
        }
        return Colors.Transparent;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
