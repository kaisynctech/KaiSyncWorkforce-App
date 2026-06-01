namespace KaiFlow.Timesheets.Models;

/// <summary>Pairs job site sign-in/out into displayable hours.</summary>
public class JobSiteSession
{
    public Guid VisitId { get; init; }
    public Guid JobId { get; init; }
    public string PartyType { get; init; } = "employee";
    public string PartyName { get; init; } = "";
    public string? ReporterName { get; init; }
    public DateTime SignInAt { get; init; }
    public DateTime? SignOutAt { get; init; }
    public string? SignInAddress { get; init; }
    public string? SignOutAddress { get; init; }

    public bool IsOpen => !SignOutAt.HasValue;
    public TimeSpan Duration => (SignOutAt ?? DateTime.UtcNow) - SignInAt;
    public double TotalHours => Duration.TotalHours;

    public string SignInDisplay => SignInAt.ToLocalTime().ToString("dd MMM h:mm tt");
    public string SignOutDisplay => SignOutAt.HasValue ? SignOutAt.Value.ToLocalTime().ToString("h:mm tt") : "On site";
    public string HoursDisplay => $"{TotalHours:F1}h";
    public string PartyLine => string.IsNullOrWhiteSpace(ReporterName) ? PartyName : $"{PartyName} · {ReporterName}";

    public static List<JobSiteSession> Build(IEnumerable<JobSiteVisit> visits)
    {
        return visits
            .OrderByDescending(v => v.SignInAt)
            .Select(v => new JobSiteSession
            {
                VisitId = v.Id,
                JobId = v.JobId,
                PartyType = v.PartyType,
                PartyName = v.PartyDisplay,
                ReporterName = v.ReportedByName,
                SignInAt = v.SignInAt.ToUniversalTime(),
                SignOutAt = v.SignOutAt?.ToUniversalTime(),
                SignInAddress = v.SignInAddress,
                SignOutAddress = v.SignOutAddress
            })
            .ToList();
    }

    public static double TotalHoursForParty(IEnumerable<JobSiteVisit> visits, Guid? employeeId = null, Guid? contractorId = null)
    {
        var filtered = visits.Where(v =>
            (employeeId.HasValue && v.EmployeeId == employeeId) ||
            (contractorId.HasValue && v.ContractorId == contractorId));
        return Build(filtered).Sum(s => s.TotalHours);
    }
}
