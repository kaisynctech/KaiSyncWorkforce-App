using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

[Table("employee_salary_history")]
public class EmployeeSalaryHistory : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("effective_date")]
    public DateOnly EffectiveDate { get; set; }

    [Column("monthly_salary")]
    public double MonthlySalary { get; set; }

    [Column("hourly_rate")]
    public double HourlyRate { get; set; }

    [Column("daily_rate")]
    public double DailyRate { get; set; }

    [Column("note")]
    public string? Note { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }
}

[Table("payroll_period_locks")]
public class PayrollPeriodLock : BaseModel
{
    [PrimaryKey("company_id")]
    public Guid CompanyId { get; set; }

    [PrimaryKey("period_start")]
    public DateOnly PeriodStart { get; set; }

    [PrimaryKey("period_end")]
    public DateOnly PeriodEnd { get; set; }

    [Column("locked_at")]
    public DateTime LockedAt { get; set; }

    [Column("locked_by")]
    public Guid? LockedBy { get; set; }
}
