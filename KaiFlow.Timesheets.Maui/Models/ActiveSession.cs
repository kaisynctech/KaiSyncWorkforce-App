namespace KaiFlow.Timesheets.Models;

public class ActiveSession
{
    public Guid SessionId { get; set; }
    public Guid EmployeeId { get; set; }
    public string EmployeeName { get; set; } = "";
    public string LoginMethod { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    public string LoginMethodDisplay => LoginMethod switch
    {
        "pin"       => "PIN",
        "code"      => "Login code",
        "id_number" => "ID number",
        _           => LoginMethod
    };
}
