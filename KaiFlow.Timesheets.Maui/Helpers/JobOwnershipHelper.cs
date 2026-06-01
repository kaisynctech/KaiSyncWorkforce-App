using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>Unified creator/assignee classification for jobs and similar entities.</summary>
public static class JobOwnershipHelper
{
    /// <summary>Job was created by the given employee (requires persisted created_by_employee_id).</summary>
    public static bool IsCreatedBy(this Job job, Guid employeeId) =>
        job.CreatedByEmployeeId.HasValue && job.CreatedByEmployeeId.Value == employeeId;

    /// <summary>On the team but not created by this employee (HR/manager-assigned).</summary>
    public static bool IsAssignedByOthers(this Job job, Guid employeeId) =>
        job.IsAssignedTo(employeeId) && !job.IsCreatedBy(employeeId);

    /// <summary>Visible in All tab: created by me OR assigned to me by others.</summary>
    public static bool IsInAllJobsScope(this Job job, Guid employeeId) =>
        job.IsCreatedBy(employeeId) || job.IsAssignedByOthers(employeeId);
}
