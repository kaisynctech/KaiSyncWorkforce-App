namespace KaiFlow.Timesheets.Models;

public record LeaveRequestDisplay(
    LeaveRequest Request,
    string EmployeeName,
    string TypeColor,
    double AnnualEntitlement,
    double TakenDays)
{
    public string EmployeeInitials  => EmployeeName.Split(' ').Where(p => p.Length > 0).Take(2).Aggregate("", (a, p) => a + p[0]).ToUpperInvariant();
    public double RemainingDays    => Math.Max(0, AnnualEntitlement - TakenDays);
    public double AfterApproval    => Math.Max(0, RemainingDays - Request.TotalDays);
    public string PeriodText       => $"{Request.StartDate:dd MMM} – {Request.EndDate:dd MMM yyyy}";
    public string RequestedDaysText => Request.TotalDays == 1 ? "1 day" : $"{Request.TotalDays:F0} days";
    public string BalanceText      => $"{RemainingDays:F0} of {AnnualEntitlement:F0} days remaining";
    public string AfterApprovalText => $"{AfterApproval:F0} days left if approved";
    public bool HasSufficientBalance => AfterApproval >= 0 && RemainingDays >= Request.TotalDays;
}
