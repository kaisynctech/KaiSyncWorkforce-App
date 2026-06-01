using System.Text.Json.Serialization;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("daily_absences")]
public class DailyAbsence : BaseModel
{
    [PrimaryKey("id")] public Guid Id { get; set; }
    [Column("company_id")] public Guid CompanyId { get; set; }
    [Column("employee_id")] public Guid EmployeeId { get; set; }
    [Column("date")] public DateOnly Date { get; set; }
    [Column("reason")] public string Reason { get; set; } = "";
    [Column("note")] public string? Note { get; set; }
    [Column("created_at")] public DateTime CreatedAt { get; set; }

    [JsonIgnore] public string ReasonLabel => Reason switch
    {
        "sick"      => "Sick",
        "personal"  => "Personal",
        "emergency" => "Emergency",
        _           => "Other"
    };
}
