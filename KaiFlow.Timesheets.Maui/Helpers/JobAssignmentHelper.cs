using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>Ensures assignee is always included in assigned_employee_ids so My Jobs and RLS stay in sync.</summary>
public static class JobAssignmentHelper
{
    public static void Normalize(Job job)
    {
        var ids = new List<Guid>(job.AssignedEmployeeIds ?? []);
        if (job.AssigneeEmployeeId is { } assignee && assignee != Guid.Empty && !ids.Contains(assignee))
            ids.Insert(0, assignee);
        else if (ids.Count > 0 && (job.AssigneeEmployeeId is null || job.AssigneeEmployeeId == Guid.Empty))
            job.AssigneeEmployeeId = ids[0];

        job.AssignedEmployeeIds = ids;
    }

    /// <summary>Matches employee_get_jobs_for_employee assignment rules (assignee, team, contractor link).</summary>
    public static bool IsAssignedTo(this Job job, Guid employeeId) =>
        job.AssigneeEmployeeId == employeeId
        || (job.AssignedEmployeeIds ?? []).Contains(employeeId)
        || job.ContractorEmployeeId == employeeId;
}
