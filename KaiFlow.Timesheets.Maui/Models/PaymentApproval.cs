using Newtonsoft.Json;
using Supabase.Postgrest.Attributes;
using Supabase.Postgrest.Models;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Helpers;

namespace KaiFlow.Timesheets.Models;

public enum PaymentStatus { Pending, Approved, Paid, Rejected }

[Table("payment_approvals")]
public class PaymentApproval : BaseModel
{
    [PrimaryKey("id")]
    public Guid Id { get; set; }

    [Column("employee_id")]
    public Guid EmployeeId { get; set; }

    [Column("period_start")]
    public DateOnly PeriodStart { get; set; }

    [Column("period_end")]
    public DateOnly PeriodEnd { get; set; }

    [Column("regular_hours")]
    public double RegularHours { get; set; }

    [Column("overtime_hours")]
    public double OvertimeHours { get; set; }

    [Column("working_days")]
    public int WorkingDays { get; set; }

    [Column("leave_days")]
    public double LeaveDays { get; set; }

    [Column("absent_days")]
    public int AbsentDays { get; set; }

    [Column("regular_pay")]
    public double RegularPay { get; set; }

    [Column("overtime_pay")]
    public double OvertimePay { get; set; }

    [Column("gross_pay")]
    public double GrossPay { get; set; }

    [Column("deductions")]
    public double Deductions { get; set; }

    [Column("net_pay")]
    public double NetPay { get; set; }

    [Column("status")]
    public string StatusRaw { get; set; } = "pending";

    [Column("approved_by")]
    public Guid? ApprovedBy { get; set; }

    [Column("approved_at")]
    public DateTime? ApprovedAt { get; set; }

    [Column("paid_at")]
    public DateTime? PaidAt { get; set; }

    [Column("notes")]
    public string? Notes { get; set; }

    [Column("company_id")]
    public Guid CompanyId { get; set; }

    [Column("shared_with_employee")]
    public bool SharedWithEmployee { get; set; }

    [Column("pay_basis")]
    public string? PayBasisRaw { get; set; }

    [Column("base_salary")]
    public double BaseSalary { get; set; }

    [Column("pay_full_base_salary")]
    public bool PayFullBaseSalary { get; set; }

    [Column("waive_penalties")]
    public bool WaivePenalties { get; set; }

    [Column("manual_paye_override")]
    public double? ManualPayeOverride { get; set; }

    [Column("manual_adjustment")]
    public double ManualAdjustment { get; set; }

    [Column("adjustment_note")]
    public string? AdjustmentNote { get; set; }

    [Column("earnings_breakdown")]
    public string? EarningsBreakdownJson { get; set; }

    [Column("deductions_breakdown")]
    public string? DeductionsBreakdownJson { get; set; }

    [Column("policy_snapshot")]
    public string? PolicySnapshotJson { get; set; }

    [Column("bonus_amount")]
    public double BonusAmount { get; set; }

    [Column("bonus_note")]
    public string? BonusNote { get; set; }

    [Column("audit_log")]
    public string? AuditLogJson { get; set; }

    [Column("version")]
    public int Version { get; set; } = 1;

    [Column("unpaid_leave_days")]
    public double UnpaidLeaveDays { get; set; }

    [Column("ytd_json")]
    public string? YtdJson { get; set; }

    [Column("branch_label")]
    public string? BranchLabel { get; set; }

    [Column("cost_center")]
    public string? CostCenter { get; set; }

    [Column("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonIgnore]
    public DateTime? EffectiveCreatedAt
    {
        get
        {
            if (CreatedAt.Year >= 2000) return CreatedAt;
            var first = AuditEntries.FirstOrDefault();
            return first?.At;
        }
    }

    [JsonIgnore]
    public bool HasValidCreatedAt => EffectiveCreatedAt.HasValue;

    [JsonIgnore]
    public PaymentStatus Status => StatusRaw switch
    {
        "approved" => PaymentStatus.Approved,
        "paid" => PaymentStatus.Paid,
        "rejected" => PaymentStatus.Rejected,
        _ => PaymentStatus.Pending
    };

    [JsonIgnore] public string PeriodLabel    => $"{PeriodStart:dd MMM} – {PeriodEnd:dd MMM yyyy}";
    [JsonIgnore] public bool   HasOvertimePay => OvertimePay > 0;
    [JsonIgnore] public bool   HasDeductions  => Deductions > 0;
    [JsonIgnore] public bool   HasAbsences    => AbsentDays > 0;
    [JsonIgnore] public bool   HasItemizedDeductions => DeductionLines.Count > 0;
    [JsonIgnore] public string PayBasisLabel => PayBasisRaw switch
    {
        "monthly_salary" => "Monthly salary",
        "hourly" => "Hourly",
        "daily" => "Daily rate",
        _ => "Standard"
    };
    [JsonIgnore] public string LeaveDaysDisplay => LeaveDays == 1 ? "1 day" : $"{LeaveDays:F1} days";
    [JsonIgnore] public bool CanEditOverrides => StatusRaw is "pending";
    [JsonIgnore] public bool CanReleaseToEmployee => StatusRaw is "approved" or "paid" && !SharedWithEmployee;
    [JsonIgnore] public string EmployeeVisibilityLabel => SharedWithEmployee
        ? "Visible in My Payslips"
        : "Not shown to employee yet";

    [JsonIgnore] public string HoursDisplay => $"{RegularHours:F0}h / {OvertimeHours:F0}h OT";
    [JsonIgnore] public string GrossDisplay => $"R{GrossPay:N2}";
    [JsonIgnore] public string NetDisplay => $"R{NetPay:N2}";
    [JsonIgnore] public string DeductionsDisplay => Deductions > 0 ? $"R{Deductions:N2}" : "—";
    [JsonIgnore] public string GeneratedDisplay => HasValidCreatedAt
        ? EffectiveCreatedAt!.Value.ToString("dd MMM yyyy")
        : "—";

    [JsonIgnore]
    public IReadOnlyList<PayrollLineItem> EarningsLines =>
        DeserializeLines(EarningsBreakdownJson);

    [JsonIgnore]
    public IReadOnlyList<PayrollLineItem> DeductionLines =>
        DeserializeLines(DeductionsBreakdownJson);

    [JsonIgnore]
    public PayrollYtdTotals? YtdTotals
    {
        get
        {
            if (string.IsNullOrWhiteSpace(YtdJson)) return null;
            try { return JsonConvert.DeserializeObject<PayrollYtdTotals>(YtdJson); }
            catch { return null; }
        }
    }

    [JsonIgnore]
    public IReadOnlyList<PayrollAuditEntry> AuditEntries =>
        PayrollAuditHelper.Read(this);

    [JsonIgnore]
    public bool HasYtd => YtdTotals != null;

    private static List<PayrollLineItem> DeserializeLines(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonConvert.DeserializeObject<List<PayrollLineItem>>(json) ?? [];
        }
        catch
        {
            return [];
        }
    }
}
