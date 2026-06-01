namespace KaiFlow.Timesheets.Services;

/// <summary>Passes non-primitive navigation args when Shell query strings are not enough (WinUI).</summary>
public static class NavigationParameterBag
{
    private static Dictionary<string, object>? _bag;

    public static void Set(IReadOnlyDictionary<string, object> parameters)
        => _bag = new Dictionary<string, object>(parameters);

    public static bool TryGet<T>(string key, out T? value)
    {
        value = default;
        if (_bag == null || !_bag.TryGetValue(key, out var raw))
            return false;
        if (raw is T typed)
        {
            value = typed;
            return true;
        }
        return false;
    }

    public static void Clear() => _bag = null;
}
