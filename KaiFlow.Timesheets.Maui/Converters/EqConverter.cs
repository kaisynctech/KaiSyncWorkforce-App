using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

/// <summary>
/// Returns true when value equals ConverterParameter string.
/// </summary>
public class EqConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
        => value?.ToString() == parameter?.ToString();

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
