namespace KaiFlow.Timesheets.Models;

/// <summary>Reporting-line manager (maps to employees.manager_user_id = auth user id).</summary>
public class ManagerOption
{
    public Guid? EmployeeId { get; init; }
    public Guid? ManagerUserId { get; init; }
    public string DisplayName { get; init; } = "";

    public static ManagerOption None { get; } = new() { DisplayName = "(No manager)" };

    public static ManagerOption From(Employee e) => new()
    {
        EmployeeId = e.Id,
        ManagerUserId = e.UserId,
        DisplayName = string.IsNullOrWhiteSpace(e.Position)
            ? e.FullName
            : $"{e.FullName} · {e.Position}"
    };
}
