namespace KaiFlow.Timesheets.Models;

/// <summary>
/// South African BCEA leave entitlements used as defaults.
/// Companies may override these by editing the policy in Settings.
/// </summary>
public static class LeavePolicy
{
    public static readonly IReadOnlyList<(string Key, string Label, double AnnualDays, string Color)> Types =
    [
        ("Annual Leave",          "Annual Leave",          15,  "#3B82F6"),
        ("Sick Leave",            "Sick Leave",            10,  "#22C55E"),
        ("Family Responsibility", "Family Responsibility",  3,  "#A855F7"),
        ("Maternity Leave",       "Maternity Leave",       60,  "#EC4899"),
        ("Paternity Leave",       "Paternity Leave",       10,  "#0EA5E9"),
        ("Study Leave",           "Study Leave",            5,  "#F59E0B"),
        ("Unpaid Leave",          "Unpaid Leave",         365,  "#64748B"),
    ];

    public static IReadOnlyList<string> TypeKeys => Types.Select(t => t.Key).ToList();

    public static double GetAnnualDays(string key) =>
        Types.FirstOrDefault(t => t.Key.Equals(key, StringComparison.OrdinalIgnoreCase)).AnnualDays;

    public static string GetColor(string key) =>
        Types.FirstOrDefault(t => t.Key.Equals(key, StringComparison.OrdinalIgnoreCase)).Color ?? "#64748B";

    public static bool IsUnpaid(string key) =>
        key.Equals("Unpaid Leave", StringComparison.OrdinalIgnoreCase);
}

/// <summary>Computed leave balance for one leave type for one employee in the current year.</summary>
public record LeaveBalance(
    string TypeKey,
    string Label,
    string Color,
    double AnnualEntitlement,
    double TakenDays,
    double PendingDays)
{
    public double RemainingDays => Math.Max(0, AnnualEntitlement - TakenDays);
    public string SummaryText => $"{RemainingDays:F0} / {AnnualEntitlement:F0}";
    public string SubText => $"{TakenDays:F0} taken · {PendingDays:F0} pending";
    public double ProgressFraction => AnnualEntitlement > 0 ? Math.Min(1.0, TakenDays / AnnualEntitlement) : 0;
}
