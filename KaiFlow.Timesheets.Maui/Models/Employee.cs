using KaiFlow.Timesheets.Helpers;
using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;

namespace KaiFlow.Timesheets.Models;

public enum EmploymentType { PartTime, Contract, Permanent, Student }
public enum AccessLevel { Employee, Manager, Admin, HrAdmin, Owner }
public enum WorkerType { Employee, Contractor, Subcontractor }

[Table("employees")]
public class Employee : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("name")]
    public string Name { get; set; } = "";

    [Column("surname")]
    public string Surname { get; set; } = "";

    [Column("employee_code")]
    public string? EmployeeCode { get; set; }

    [Column("employment_type")]
    public string EmploymentTypeRaw { get; set; } = "permanent";

    [Column("access_level")]
    public string AccessLevelRaw { get; set; } = "employee";

    [Column("worker_type")]
    public string WorkerTypeRaw { get; set; } = "employee";

    [Column("position")]
    public string? Position { get; set; }

    [Column("branch")]
    public string? Branch { get; set; }

    [Column("employment_date")]
    public DateOnly? EmploymentDate { get; set; }

    [Column("hourly_rate")]
    public double HourlyRate { get; set; }

    [Column("daily_rate")]
    public double DailyRate { get; set; }

    [Column("weekly_rate")]
    public double WeeklyRate { get; set; }

    [Column("monthly_salary")]
    public double MonthlySalary { get; set; }

    [Column("overtime_rate")]
    public double OvertimeRate { get; set; }

    [Column("double_time_rate")]
    public double DoubleTimeRate { get; set; }

    [Column("pay_basis")]
    public string? PayBasisRaw { get; set; }

    [Column("paye_rate_percent")]
    public double? PayeRatePercent { get; set; }

    [Column("paye_fixed_amount")]
    public double PayeFixedAmount { get; set; }

    [Column("uif_exempt")]
    public bool UifExempt { get; set; }

    [Column("uif_rate_percent")]
    public double? UifRatePercent { get; set; }

    [Column("uif_fixed_amount")]
    public double UifFixedAmount { get; set; }

    [Column("tax_number")]
    public string? TaxNumber { get; set; }

    [Column("paye_reference")]
    public string? PayeReference { get; set; }

    [Column("medical_aid_member_number")]
    public string? MedicalAidMemberNumber { get; set; }

    [Column("pension_fund_number")]
    public string? PensionFundNumber { get; set; }

    [Column("tax_directive_number")]
    public string? TaxDirectiveNumber { get; set; }

    [Column("tax_directive_rate_percent")]
    public double? TaxDirectiveRatePercent { get; set; }

    [Column("date_of_birth")]
    public DateOnly? DateOfBirth { get; set; }

    [Column("cost_center")]
    public string? CostCenter { get; set; }

    [Column("termination_date")]
    public DateOnly? TerminationDate { get; set; }

    [Column("medical_aid_deduction")]
    public double MedicalAidDeduction { get; set; }

    [Column("pension_deduction")]
    public double PensionDeduction { get; set; }

    [Column("union_deduction")]
    public double UnionDeduction { get; set; }

    [Column("pay_full_monthly_salary")]
    public bool PayFullMonthlySalary { get; set; }

    [Column("daily_hours")]
    public double DailyHours { get; set; } = 8.0;

    [Column("work_days_weekly")]
    public int WorkDaysWeekly { get; set; } = 5;

    [Column("email")]
    public string? Email { get; set; }

    [Column("phone")]
    public string? Phone { get; set; }

    [Column("manager_user_id")]
    public Guid? ManagerUserId { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("user_id")]
    public Guid? UserId { get; set; }

    [Column("is_active")]
    public bool IsActive { get; set; } = true;

    [Column("profile_photo_url")]
    public string? ProfilePhotoUrl { get; set; }

    [Column("id_number")]
    public string? IdNumber { get; set; }

    [Column("bank_account")]
    public string? BankAccount { get; set; }

    [Column("bank_name")]
    public string? BankName { get; set; }

    [Column("bank_branch_code")]
    public string? BankBranchCode { get; set; }

    [Column("bank_details_updated_at")]
    public DateTime? BankDetailsUpdatedAt { get; set; }

    [Column("bank_details_updated_by")]
    public string? BankDetailsUpdatedBy { get; set; }

    [Column("shift_template_id")]
    public Guid? ShiftTemplateId { get; set; }

    [Column("login_password_ready")]
    public bool LoginPasswordReady { get; set; }

    [Column("registration_status")]
    [JsonProperty("registration_status")]
    public string RegistrationStatus { get; set; } = "active";

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    // Computed — [JsonIgnore] prevents these from being serialized into INSERT/UPDATE bodies
    [JsonIgnore]
    public EmploymentType EmploymentType => EmploymentTypeRaw switch
    {
        "part-time" or "partTime" => EmploymentType.PartTime,
        "contract" => EmploymentType.Contract,
        "student" => EmploymentType.Student,
        _ => EmploymentType.Permanent
    };

    [JsonIgnore]
    public AccessLevel AccessLevel => AccessLevelRaw switch
    {
        "manager" => AccessLevel.Manager,
        "admin" => AccessLevel.Admin,
        "hr_admin" or "hrAdmin" => AccessLevel.HrAdmin,
        "owner" => AccessLevel.Owner,
        _ => AccessLevel.Employee
    };

    [JsonIgnore]
    public WorkerType WorkerType => WorkerTypeRaw switch
    {
        "contractor" => WorkerType.Contractor,
        "subcontractor" => WorkerType.Subcontractor,
        _ => WorkerType.Employee
    };

    [JsonIgnore]
    public string FullName => $"{Name} {Surname}".Trim();

    [JsonIgnore]
    public string Initials
    {
        get
        {
            var n = Name.Length > 0 ? Name[0].ToString() : "";
            var s = Surname.Length > 0 ? Surname[0].ToString() : "";
            return (n + s).ToUpperInvariant();
        }
    }

    [JsonIgnore]
    public string EmploymentTypeDisplay => EmploymentTypeRaw switch
    {
        "part-time" or "partTime" => "Part-Time",
        "contract" => "Contract",
        "student" => "Student",
        _ => "Permanent"
    };

    [JsonIgnore]
    public string AccessLevelDisplay => AccessLevelRaw switch
    {
        "owner" => "Owner",
        "hr_admin" or "hrAdmin" => "HR Admin",
        "admin" => "Admin",
        "manager" => "Manager",
        _ => "Employee"
    };

    [JsonIgnore]
    public string RequestedDateDisplay =>
        CreatedAt.Year < 2000 ? "—" : CreatedAt.ToLocalTime().ToString("dd MMM yyyy");

    [JsonIgnore]
    public bool IsHr => AccessLevel is AccessLevel.HrAdmin or AccessLevel.Owner or AccessLevel.Admin;

    /// <summary>Owner, HR, Admin, or field/ops Manager — uses company (HR/operations) dashboard.</summary>
    [JsonIgnore]
    public bool UsesCompanyDashboard =>
        AccessLevel is AccessLevel.Owner or AccessLevel.HrAdmin or AccessLevel.Admin or AccessLevel.Manager;

    [JsonIgnore]
    public bool IsFieldManager => AccessLevel == AccessLevel.Manager;

    [JsonIgnore]
    public bool IsManager => AccessLevel is AccessLevel.Manager or AccessLevel.HrAdmin or AccessLevel.Owner or AccessLevel.Admin;

    [JsonIgnore]
    public bool HasBankingDetails =>
        !string.IsNullOrWhiteSpace(BankAccount)
        || !string.IsNullOrWhiteSpace(BankName)
        || !string.IsNullOrWhiteSpace(BankBranchCode);

    [JsonIgnore]
    public string MaskedBankAccount => BankDetailsFormatting.MaskAccount(BankAccount);

    [JsonIgnore]
    public string BankDetailsUpdatedDisplay =>
        BankDetailsUpdatedAt.HasValue
            ? $"Updated {BankDetailsUpdatedAt.Value.ToLocalTime():dd MMM yyyy HH:mm} by {BankDetailsFormatting.UpdatedByLabel(BankDetailsUpdatedBy)}"
            : "";

    [JsonIgnore]
    public bool HasBankDetailsAudit => BankDetailsUpdatedAt.HasValue;

    /// <summary>Import preview only — not persisted.</summary>
    [JsonIgnore]
    public string? ImportTimeTemplateName { get; set; }
}
