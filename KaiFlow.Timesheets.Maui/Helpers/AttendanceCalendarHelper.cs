using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>
/// Merges punch sessions with HR-marked absences and approved leave days
/// so the attendance table shows non-work days instead of punch rows.
/// </summary>
public static class AttendanceCalendarHelper
{
    public static List<PunchSession> MergeNonWorkDays(
        List<PunchSession> sessions,
        IEnumerable<DailyAbsence> absences,
        IEnumerable<LeaveRequest> leaveRequests,
        Employee employee,
        DateOnly from,
        DateOnly to,
        int lateThresholdMinutes = 30,
        int otStartAfterMinutes = 30,
        EmployeeShiftTemplate? template = null)
    {
        var employeeAbsences = absences
            .Where(a => a.EmployeeId == employee.Id && a.Date >= from && a.Date <= to)
            .ToList();

        var absentDates = employeeAbsences.Select(a => a.Date).ToHashSet();

        var leaveDates = new HashSet<DateOnly>();
        foreach (var leave in leaveRequests.Where(r =>
                     r.EmployeeId == employee.Id && r.IsApproved))
        {
            var start = leave.StartDate < from ? from : leave.StartDate;
            var end = leave.EndDate > to ? to : leave.EndDate;
            for (var d = start; d <= end; d = d.AddDays(1))
                leaveDates.Add(d);
        }

        // Absence and leave take precedence over punch rows on the same date.
        var filtered = sessions
            .Where(s => s.EmployeeId != employee.Id
                        || (!absentDates.Contains(s.Date) && !leaveDates.Contains(s.Date)))
            .ToList();

        var coveredDates = filtered
            .Where(s => s.EmployeeId == employee.Id)
            .Select(s => s.Date)
            .ToHashSet();

        var result = new List<PunchSession>(filtered);

        for (var d = from; d <= to; d = d.AddDays(1))
        {
            if (coveredDates.Contains(d))
                continue;

            var absence = employeeAbsences.FirstOrDefault(a => a.Date == d);
            if (absence != null)
            {
                result.Add(PunchSession.ForAbsentDay(
                    employee, d, absence, template, lateThresholdMinutes, otStartAfterMinutes));
                continue;
            }

            if (leaveDates.Contains(d))
            {
                var leave = leaveRequests.First(r =>
                    r.EmployeeId == employee.Id
                    && r.IsApproved
                    && r.StartDate <= d
                    && r.EndDate >= d);

                result.Add(PunchSession.ForLeaveDay(
                    employee, d, leave, template, lateThresholdMinutes, otStartAfterMinutes));
            }
        }

        return result.OrderByDescending(s => s.ClockIn).ToList();
    }
}
