using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

/// <summary>Team / manager-line scoping for operational roles.</summary>
public class EmployeeScopeService
{
    public IReadOnlyList<Employee> FilterEmployees(
        Employee viewer,
        IReadOnlyList<Employee> companyEmployees,
        IReadOnlyList<WorkTeam> teams,
        IPermissionsService permissions)
    {
        if (viewer.AccessLevel == AccessLevel.Owner
            || permissions.Can(PermissionKeys.AttendanceViewAll)
            || viewer.AccessLevel is AccessLevel.Admin or AccessLevel.HrAdmin)
        {
            return companyEmployees;
        }

        if (!permissions.Can(PermissionKeys.EmployeesView)
            && !permissions.Can(PermissionKeys.AttendanceViewTeam))
            return [viewer];

        var allowedIds = GetScopedEmployeeIds(viewer, companyEmployees, teams);
        return companyEmployees.Where(e => allowedIds.Contains(e.Id)).ToList();
    }

    public HashSet<Guid> GetScopedEmployeeIds(
        Employee viewer,
        IReadOnlyList<Employee> companyEmployees,
        IReadOnlyList<WorkTeam> teams)
    {
        var ids = new HashSet<Guid> { viewer.Id };

        var managerAuthId = viewer.UserId;
        if (managerAuthId.HasValue)
        {
            foreach (var e in companyEmployees)
            {
                if (e.ManagerUserId == managerAuthId)
                    ids.Add(e.Id);
            }
        }

        foreach (var team in teams)
        {
            if (team.LeaderEmployeeId == viewer.Id)
            {
                foreach (var memberId in team.MemberIds)
                    ids.Add(memberId);
            }
            else if (team.MemberIds.Contains(viewer.Id) && team.LeaderEmployeeId.HasValue)
                ids.Add(team.LeaderEmployeeId.Value);
        }

        return ids;
    }

    public IReadOnlyList<WorkTeam> FilterTeams(
        Employee viewer,
        IReadOnlyList<WorkTeam> teams,
        IPermissionsService permissions)
    {
        if (viewer.AccessLevel == AccessLevel.Owner
            || permissions.Can(PermissionKeys.AttendanceViewAll))
            return teams;

        return teams
            .Where(t => t.LeaderEmployeeId == viewer.Id || t.MemberIds.Contains(viewer.Id))
            .ToList();
    }

    public bool CanViewAllProjects(IPermissionsService permissions)
        => permissions.Can(PermissionKeys.ProjectsViewAll);

    public bool CanViewAllJobs(IPermissionsService permissions)
        => permissions.Can(PermissionKeys.JobsViewAll);
}
