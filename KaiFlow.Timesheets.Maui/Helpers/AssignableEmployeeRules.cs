using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>Unified filters for job collaborator and leadership assignment pickers.</summary>
public static class AssignableEmployeeRules
{
    /// <summary>Privileged roles eligible for job leadership notification / escalation.</summary>
    public static bool IsAssignableLeadership(Employee employee, Guid? excludeEmployeeId = null)
    {
        if (!employee.IsActive) return false;
        if (excludeEmployeeId.HasValue && employee.Id == excludeEmployeeId.Value) return false;
        return employee.AccessLevel is AccessLevel.Manager
            or AccessLevel.Admin
            or AccessLevel.HrAdmin
            or AccessLevel.Owner;
    }

    /// <summary>Active coworkers on the same company (field team).</summary>
    public static bool IsAssignableCoworker(Employee employee, Guid? excludeEmployeeId = null)
    {
        if (!employee.IsActive) return false;
        if (excludeEmployeeId.HasValue && employee.Id == excludeEmployeeId.Value) return false;
        return true;
    }
}
