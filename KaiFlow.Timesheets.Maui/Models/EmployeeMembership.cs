using Newtonsoft.Json;

namespace KaiFlow.Timesheets.Models;

public class EmployeeMembership
{
    [JsonProperty("employee_id")]
    public Guid EmployeeId { get; set; }

    [JsonProperty("company_id")]
    public Guid CompanyId { get; set; }

    [JsonProperty("registration_status")]
    public string RegistrationStatus { get; set; } = "active";

    [JsonProperty("is_active")]
    public bool IsActive { get; set; }

    [JsonProperty("name")]
    public string Name { get; set; } = "";

    [JsonProperty("surname")]
    public string Surname { get; set; } = "";

    [JsonProperty("position")]
    public string? Position { get; set; }

    [JsonProperty("branch")]
    public string? Branch { get; set; }

    [JsonProperty("access_level")]
    public string AccessLevel { get; set; } = "employee";

    [JsonProperty("company_name")]
    public string CompanyName { get; set; } = "";

    [JsonProperty("company_code")]
    public string CompanyCode { get; set; } = "";

    public string FullName => $"{Name} {Surname}".Trim();

    public bool IsApproved => RegistrationStatus == "active" && IsActive;
    public bool IsPending => RegistrationStatus == "pending";
    public bool IsRejected => RegistrationStatus == "rejected";
    public bool IsHr => AccessLevel is "owner" or "hr_admin" or "admin";

    public bool UsesCompanyDashboard =>
        AccessLevel is "owner" or "hr_admin" or "admin" or "manager";

    public string StatusLabel => IsApproved ? "Active"
        : IsPending ? "Awaiting HR approval"
        : IsRejected ? "Declined"
        : RegistrationStatus;

    public string StatusColor => IsApproved ? "#22C55E"
        : IsPending ? "#F59E0B"
        : IsRejected ? "#EF4444"
        : "#94A3B8";

    public Employee ToEmployee() => new()
    {
        Id = EmployeeId,
        CompanyId = CompanyId,
        Name = Name,
        Surname = Surname,
        Position = Position,
        Branch = Branch,
        AccessLevelRaw = AccessLevel,
        RegistrationStatus = RegistrationStatus,
        IsActive = IsActive
    };

    public static EmployeeMembership From(Employee employee, Company company) => new()
    {
        EmployeeId = employee.Id,
        CompanyId = employee.CompanyId,
        RegistrationStatus = employee.RegistrationStatus,
        IsActive = employee.IsActive,
        Name = employee.Name,
        Surname = employee.Surname,
        Position = employee.Position,
        Branch = employee.Branch,
        AccessLevel = employee.AccessLevelRaw,
        CompanyName = company.Name,
        CompanyCode = company.Code
    };
}
