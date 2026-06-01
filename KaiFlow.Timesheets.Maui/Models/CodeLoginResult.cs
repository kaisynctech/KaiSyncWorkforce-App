namespace KaiFlow.Timesheets.Models;

public class CodeLoginResult
{
    public string SessionToken { get; set; } = "";
    public Employee Employee { get; set; } = new();
    public Company Company { get; set; } = new();
    public List<EmployeeMembership> Memberships { get; set; } = [];
}
