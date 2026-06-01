using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum LaborSourceType { Manual, Punch }

[Table("labor_entries")]
public class LaborEntry : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("job_code_id")]
    public Guid? JobCodeId { get; set; }

    [Column("work_date")]
    public DateOnly WorkDate { get; set; }

    [Column("hours")]
    public double Hours { get; set; }

    [Column("hourly_rate")]
    public double HourlyRate { get; set; }

    [Column("source_type")]
    public string SourceTypeRaw { get; set; } = "manual";

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    public LaborSourceType SourceType => SourceTypeRaw == "punch"
        ? LaborSourceType.Punch
        : LaborSourceType.Manual;

    public double TotalCost => Hours * HourlyRate;
}
