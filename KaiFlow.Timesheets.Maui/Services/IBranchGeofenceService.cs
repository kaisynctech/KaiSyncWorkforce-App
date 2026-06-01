using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public sealed record BranchGeofenceResult(
    bool IsAllowed,
    string? BlockReason = null,
    double? DistanceMeters = null,
    double? AllowedRadiusMeters = null,
    string? BranchName = null)
{
    public static BranchGeofenceResult Allowed { get; } = new(true);
}

public sealed class BranchGeofenceStatus
{
    public bool EnforcementActive { get; init; }
    public bool IsWithinRadius { get; init; } = true;
    public double? DistanceMeters { get; init; }
    public double? AllowedRadiusMeters { get; init; }
    public string? BranchName { get; init; }
    public string DisplayMessage { get; init; } = "";
}

public interface IBranchGeofenceService
{
    Task<BranchGeofenceResult> ValidateClockInAsync(
        Employee employee,
        Company company,
        double? latitude,
        double? longitude);

    Task<BranchGeofenceStatus> GetStatusAsync(
        Employee employee,
        Company company,
        double? latitude,
        double? longitude);
}
