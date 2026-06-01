using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

/// <summary>
/// ConverterParameter="TrueText|FalseText"
/// </summary>
public class BoolToStringConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var isTrue = value is bool b && b;
        var parts = (parameter as string)?.Split('|');
        if (parts?.Length >= 2)
            return isTrue ? parts[0] : parts[1];
        return isTrue ? "Yes" : "No";
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
