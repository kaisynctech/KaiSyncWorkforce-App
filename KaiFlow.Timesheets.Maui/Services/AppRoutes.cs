namespace KaiFlow.Timesheets.Services;

/// <summary>ShellContent root routes — use absolute /// navigation only for these.</summary>
public static class AppRoutes
{
    public static readonly HashSet<string> ShellContent = new(StringComparer.OrdinalIgnoreCase)
    {
        "IdEntry", "EmployeeLogin", "EmployeeEmailOtp", "HrSignIn", "HrRegister",
        "HrRegisterVerifyCode", "HrRegisterCompanyDetails", "RoleSelection", "EmployeeCompanySelector",
        "EmployeeDashboard", "HrDashboard"
    };

    public const string IdEntry = "///IdEntry";
    public const string EmployeeDashboard = "///EmployeeDashboard";
    public const string HrDashboard = "///HrDashboard";
    public const string EmployeeCompanySelector = "///EmployeeCompanySelector";

    public static string Shell(string route, string? query = null)
    {
        var path = route.TrimStart('/');
        if (!path.StartsWith("///", StringComparison.Ordinal))
            path = $"///{path}";
        return query == null ? path : $"{path}?{query}";
    }

    public static string Normalize(string route)
    {
        if (string.IsNullOrWhiteSpace(route))
            return route;

        if (route.StartsWith("..", StringComparison.Ordinal))
            return route;

        if (route.StartsWith("///", StringComparison.Ordinal))
            return route;

        if (route.StartsWith("//", StringComparison.Ordinal))
        {
            var rest = route[2..];
            var baseName = rest.Split('?')[0];
            return ShellContent.Contains(baseName) ? $"///{rest}" : route;
        }

        var name = route.Split('?')[0].TrimStart('/');
        if (ShellContent.Contains(name))
            return $"///{route.TrimStart('/')}";

        return route;
    }
}
