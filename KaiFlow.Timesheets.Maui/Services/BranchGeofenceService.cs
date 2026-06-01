using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public class BranchGeofenceService : IBranchGeofenceService
{
    private readonly IStorageService _storage;
    private readonly ILocationService _location;

    public BranchGeofenceService(IStorageService storage, ILocationService location)
    {
        _storage = storage;
        _location = location;
    }

    public async Task<BranchGeofenceResult> ValidateClockInAsync(
        Employee employee,
        Company company,
        double? latitude,
        double? longitude)
    {
        if (!company.EnforceBranchSignInRadius)
            return BranchGeofenceResult.Allowed;

        var branchName = employee.Branch?.Trim() ?? "";
        if (string.IsNullOrEmpty(branchName))
            return BranchGeofenceResult.Allowed;

        var branch = await FindBranchAsync(employee.CompanyId, branchName);
        if (branch?.Latitude == null || branch.Longitude == null)
        {
            return new BranchGeofenceResult(
                false,
                $"Branch \"{branchName}\" does not have a sign-in location yet. Ask HR to set the branch address in Settings.",
                BranchName: branchName);
        }

        if (latitude == null || longitude == null)
        {
            return new BranchGeofenceResult(
                false,
                "Location is required for branch sign-in. Enable location services and try again.",
                BranchName: branchName);
        }

        var radiusM = company.BranchSignInRadiusMeters;
        var distanceM = _location.CalculateDistance(
            latitude.Value, longitude.Value,
            branch.Latitude.Value, branch.Longitude.Value);

        if (distanceM > radiusM)
        {
            return new BranchGeofenceResult(
                false,
                $"You are {distanceM:F0}m away from your branch sign-in location ({branchName}). Move within {radiusM:F0}m to clock in.",
                distanceM,
                radiusM,
                branchName);
        }

        return BranchGeofenceResult.Allowed;
    }

    public async Task<BranchGeofenceStatus> GetStatusAsync(
        Employee employee,
        Company company,
        double? latitude,
        double? longitude)
    {
        if (!company.EnforceBranchSignInRadius)
        {
            return new BranchGeofenceStatus
            {
                EnforcementActive = false,
                IsWithinRadius = true,
                DisplayMessage = ""
            };
        }

        var branchName = employee.Branch?.Trim() ?? "";
        if (string.IsNullOrEmpty(branchName))
        {
            return new BranchGeofenceStatus
            {
                EnforcementActive = false,
                IsWithinRadius = true,
                DisplayMessage = ""
            };
        }

        var branch = await FindBranchAsync(employee.CompanyId, branchName);
        var radiusM = company.BranchSignInRadiusMeters;

        if (branch?.Latitude == null || branch.Longitude == null)
        {
            return new BranchGeofenceStatus
            {
                EnforcementActive = true,
                IsWithinRadius = false,
                AllowedRadiusMeters = radiusM,
                BranchName = branchName,
                DisplayMessage = $"Branch \"{branchName}\" needs a location in HR Settings before you can clock in."
            };
        }

        if (latitude == null || longitude == null)
        {
            return new BranchGeofenceStatus
            {
                EnforcementActive = true,
                IsWithinRadius = false,
                AllowedRadiusMeters = radiusM,
                BranchName = branchName,
                DisplayMessage = "Turn on location to verify you are at your branch."
            };
        }

        var distanceM = _location.CalculateDistance(
            latitude.Value, longitude.Value,
            branch.Latitude.Value, branch.Longitude.Value);
        var within = distanceM <= radiusM;

        return new BranchGeofenceStatus
        {
            EnforcementActive = true,
            IsWithinRadius = within,
            DistanceMeters = distanceM,
            AllowedRadiusMeters = radiusM,
            BranchName = branchName,
            DisplayMessage = within
                ? $"Within {branchName} sign-in area ({distanceM:F0}m / {radiusM:F0}m)"
                : $"Outside {branchName} sign-in area ({distanceM:F0}m away — must be within {radiusM:F0}m)"
        };
    }

    private async Task<Branch?> FindBranchAsync(Guid companyId, string branchName)
    {
        var branches = await _storage.GetBranchesAsync(companyId);
        return branches.FirstOrDefault(b =>
            b.IsActive &&
            string.Equals(b.Name, branchName, StringComparison.OrdinalIgnoreCase));
    }
}
