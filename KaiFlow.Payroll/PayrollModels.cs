namespace KaiFlow.Payroll;

public class PayrollLineItem
{
    public string Label { get; set; } = "";
    public double Amount { get; set; }
    public string Category { get; set; } = "deduction";

    public PayrollLineItem() { }

    public PayrollLineItem(string label, double amount, string category = "deduction")
    {
        Label = label;
        Amount = amount;
        Category = category;
    }
}

public record PayrollSessionSnapshot(
    DateOnly Date,
    double RegularHours,
    double OvertimeHours,
    bool IsLate,
    bool IsLeftEarly,
    bool IsOpen);

public record PayrollLeaveSnapshot(
    string LeaveType,
    DateOnly StartDate,
    DateOnly EndDate,
    bool HalfDayStart,
    bool HalfDayEnd,
    double TotalDays,
    bool IsApproved);

public record PayrollAbsenceSnapshot(DateOnly Date);

public record PayrollEmployeeSnapshot(
    Guid Id,
    double MonthlySalary,
    double HourlyRate,
    double DailyRate,
    double DailyHours,
    int WorkDaysWeekly,
    double OvertimeRate,
    string? PayBasis,
    double? PayeRatePercent,
    bool UifExempt,
    DateOnly? EmploymentDate = null,
    DateOnly? TerminationDate = null,
    string? WorkerType = null,
    double MedicalAidDeduction = 0,
    double PensionDeduction = 0,
    double UnionDeduction = 0,
    bool PayFullMonthlySalary = false,
    double PayeFixedAmount = 0,
    double? UifRatePercent = null,
    double UifFixedAmount = 0,
    DateOnly? DateOfBirth = null,
    double? TaxDirectiveRatePercent = null,
    string? CostCenter = null);

public record PayrollPayslipOverrides(
    bool PayFullBaseSalary = false,
    bool WaivePenalties = false,
    double? ManualPayeOverride = null,
    double ManualAdjustment = 0,
    string? AdjustmentNote = null,
    double BonusAmount = 0,
    string? BonusNote = null);

public record PayrollCalculationInput(
    PayrollEmployeeSnapshot Employee,
    PayrollPolicy Policy,
    DateOnly PeriodStart,
    DateOnly PeriodEnd,
    IReadOnlyList<PayrollSessionSnapshot> Sessions,
    IReadOnlyList<PayrollLeaveSnapshot> Leave,
    IReadOnlyList<PayrollAbsenceSnapshot> Absences,
    double DailyHours,
    double OtMultiplier,
    PayrollPayslipOverrides? Overrides = null,
    PayrollYtdTotals? PriorYtd = null,
    IReadOnlyList<SalaryHistoryEntry>? SalaryHistory = null);

public record PayrollCalculationResult(
    string PayBasis,
    double BaseSalary,
    int WorkingDays,
    double LeaveDays,
    int AbsentDays,
    double UnpaidLeaveDays,
    double RegularHours,
    double OvertimeHours,
    double RegularPay,
    double OvertimePay,
    double GrossPay,
    double TotalDeductions,
    double NetPay,
    int LateCount,
    int EarlyCount,
    IReadOnlyList<PayrollLineItem> EarningsLines,
    IReadOnlyList<PayrollLineItem> DeductionLines,
    string? Notes,
    PayrollYtdTotals? YtdTotals = null);
