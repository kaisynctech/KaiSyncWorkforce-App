using System.Globalization;

namespace KaiFlow.Timesheets.Converters;

public class IsZeroConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is null) return true;
        if (value is int i) return i == 0;
        if (value is long l) return l == 0;
        if (value is double d) return d == 0;
        if (value is string s && int.TryParse(s, NumberStyles.Integer, culture, out var n)) return n == 0;
        return false;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}

public class IsNotZeroConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is null) return false;
        if (value is int i) return i != 0;
        if (value is long l) return l != 0;
        if (value is double d) return d != 0;
        if (value is string s && int.TryParse(s, NumberStyles.Integer, culture, out var n)) return n != 0;
        return true;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
