namespace KaiFlow.Payroll.Tests;

public class PayrollCalculatorTests
{
    private static PayrollEmployeeSnapshot SalaryEmployee => new(
        Id: Guid.NewGuid(),
        MonthlySalary: 20000,
        HourlyRate: 115,
        DailyRate: 920,
        DailyHours: 8,
        WorkDaysWeekly: 5,
        OvertimeRate: 1.5,
        PayBasis: PayBasis.MonthlySalary,
        PayeRatePercent: 25,
        UifExempt: false);

    private static PayrollEmployeeSnapshot HourlyEmployee => new(
        Id: Guid.NewGuid(),
        MonthlySalary: 0,
        HourlyRate: 100,
        DailyRate: 800,
        DailyHours: 8,
        WorkDaysWeekly: 5,
        OvertimeRate: 1.5,
        PayBasis: PayBasis.Hourly,
        PayeRatePercent: null,
        UifExempt: false);

    private static readonly DateOnly PeriodStart = new(2026, 5, 1);
    private static readonly DateOnly PeriodEnd = new(2026, 5, 25);

    private static PayrollCalculationResult Calculate(PayrollCalculationInput input)
    {
        var result = PayrollCalculator.Calculate(input);
        Assert.NotNull(result);
        return result;
    }

    [Fact]
    public void Salary_employee_gets_full_monthly_when_employed_before_month()
    {
        var policy = new PayrollPolicy();
        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, policy, PeriodStart, PeriodEnd,
            Sessions: [], Leave: [], Absences: [],
            DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(PayBasis.MonthlySalary, result.PayBasis);
        Assert.Equal(20000, result.BaseSalary);
        Assert.Equal(20000, result.RegularPay);
    }

    [Fact]
    public void Pay_full_base_salary_uses_full_monthly()
    {
        var policy = new PayrollPolicy();
        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, policy, PeriodStart, PeriodEnd,
            Sessions: [], Leave: [], Absences: [],
            DailyHours: 8, OtMultiplier: 1.5,
            Overrides: new PayrollPayslipOverrides(PayFullBaseSalary: true)));

        Assert.Equal(20000, result.BaseSalary);
    }

    [Fact]
    public void Hourly_employee_paid_for_work_and_half_day_leave()
    {
        var policy = new PayrollPolicy();
        var sessions = new List<PayrollSessionSnapshot>
        {
            new(new DateOnly(2026, 5, 5), 8, 0, false, false, false),
            new(new DateOnly(2026, 5, 6), 8, 0, false, false, false),
        };
        var leave = new List<PayrollLeaveSnapshot>
        {
            new("Annual Leave", new DateOnly(2026, 5, 7), new DateOnly(2026, 5, 7),
                HalfDayStart: true, HalfDayEnd: false, TotalDays: 0.5, IsApproved: true)
        };

        var result = Calculate(new PayrollCalculationInput(
            HourlyEmployee, policy, PeriodStart, PeriodEnd,
            sessions, leave, [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(2, result.WorkingDays);
        Assert.Equal(0.5, result.LeaveDays);
        Assert.Equal((2 + 0.5) * 8 * 100, result.RegularPay);
    }

    [Fact]
    public void Absent_per_day_penalty_deducts_for_hourly()
    {
        var policy = new PayrollPolicy
        {
            SalaryIgnoreAttendanceDeductions = false,
            AbsentPenalty = new PenaltyPolicy { Mode = "per_day", DeductDays = 1, ApplyTo = "all" }
        };
        var absences = new List<PayrollAbsenceSnapshot>
        {
            new(new DateOnly(2026, 5, 8)),
            new(new DateOnly(2026, 5, 9)),
        };

        var result = Calculate(new PayrollCalculationInput(
            HourlyEmployee, policy, PeriodStart, PeriodEnd,
            Sessions: [], Leave: [], absences, DailyHours: 8, OtMultiplier: 1.5));

        var absentDeduction = result.DeductionLines.First(d => d.Label.StartsWith("Absent"));
        Assert.Equal(2 * 800, absentDeduction.Amount);
    }

    [Fact]
    public void Salary_employee_skips_attendance_penalties_by_default()
    {
        var policy = new PayrollPolicy { SalaryIgnoreAttendanceDeductions = true };
        var absences = new List<PayrollAbsenceSnapshot> { new(new DateOnly(2026, 5, 8)) };

        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, policy, PeriodStart, PeriodEnd,
            Sessions: [], Leave: [], absences, DailyHours: 8, OtMultiplier: 1.5));

        Assert.DoesNotContain(result.DeductionLines, d => d.Category == "penalty");
    }

    [Fact]
    public void Late_threshold_penalty_after_three_lates()
    {
        var policy = new PayrollPolicy
        {
            SalaryIgnoreAttendanceDeductions = false,
            LatePenalty = new PenaltyPolicy
            {
                Mode = "threshold", ThresholdCount = 3, DeductHours = 2, ApplyTo = "all"
            }
        };
        var sessions = Enumerable.Range(1, 3).Select(i =>
            new PayrollSessionSnapshot(new DateOnly(2026, 5, i), 8, 0, true, false, false)).ToList();

        var result = Calculate(new PayrollCalculationInput(
            HourlyEmployee, policy, PeriodStart, PeriodEnd,
            sessions, [], [], DailyHours: 8, OtMultiplier: 1.5));

        var lateDeduction = result.DeductionLines.First(d => d.Label.StartsWith("Late"));
        Assert.Equal(2 * 100, lateDeduction.Amount);
    }

    [Fact]
    public void UIF_and_PAYE_calculated_on_gross()
    {
        var policy = new PayrollPolicy();
        var emp = HourlyEmployee with { PayeRatePercent = 25, UifRatePercent = 1 };
        var sessions = new List<PayrollSessionSnapshot>
        {
            new(new DateOnly(2026, 5, 5), 8, 0, false, false, false)
        };

        var result = Calculate(new PayrollCalculationInput(
            emp, policy, PeriodStart, PeriodEnd,
            sessions, [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Contains(result.DeductionLines, d => d.Label == "UIF");
        Assert.Contains(result.DeductionLines, d => d.Label == "PAYE");
        Assert.True(result.NetPay < result.GrossPay);
    }

    [Fact]
    public void No_statutory_deductions_when_employee_not_configured()
    {
        var emp = SalaryEmployee with { MonthlySalary = 10000, PayeRatePercent = null, PayeFixedAmount = 0, UifRatePercent = null, UifFixedAmount = 0 };
        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(10000, result.GrossPay);
        Assert.Equal(10000, result.NetPay);
        Assert.DoesNotContain(result.DeductionLines, d => d.Category == "statutory");
    }

    [Fact]
    public void Net_equals_gross_plus_bonus_when_no_deductions()
    {
        var emp = SalaryEmployee with { MonthlySalary = 10000, PayeRatePercent = null, PayeFixedAmount = 0 };
        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5,
            Overrides: new PayrollPayslipOverrides(BonusAmount: 2000)));

        Assert.Equal(12000, result.GrossPay);
        Assert.Equal(12000, result.NetPay);
    }

    [Fact]
    public void Waive_penalties_skips_attendance_deductions()
    {
        var policy = new PayrollPolicy
        {
            AbsentPenalty = new PenaltyPolicy { Mode = "per_day", DeductDays = 1 }
        };
        var absences = new List<PayrollAbsenceSnapshot> { new(new DateOnly(2026, 5, 8)) };

        var result = Calculate(new PayrollCalculationInput(
            HourlyEmployee, policy, PeriodStart, PeriodEnd,
            Sessions: [], Leave: [], absences, DailyHours: 8, OtMultiplier: 1.5,
            Overrides: new PayrollPayslipOverrides(WaivePenalties: true)));

        Assert.DoesNotContain(result.DeductionLines, d => d.Category == "penalty");
    }

    [Fact]
    public void Overtime_added_on_top_of_salary()
    {
        var policy = new PayrollPolicy();
        var sessions = new List<PayrollSessionSnapshot>
        {
            new(new DateOnly(2026, 5, 5), 8, 2, false, false, false)
        };

        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, policy, PeriodStart, PeriodEnd,
            sessions, [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(2, result.OvertimeHours);
        Assert.Equal(2 * 115 * 1.5, result.OvertimePay);
        Assert.True(result.GrossPay > result.RegularPay);
    }

    [Fact]
    public void Returns_null_when_terminated_before_period()
    {
        var emp = SalaryEmployee with { TerminationDate = new DateOnly(2026, 4, 30) };
        var result = PayrollCalculator.Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Null(result);
    }

    [Fact]
    public void Pro_rates_salary_when_joined_mid_month()
    {
        var emp = SalaryEmployee with { EmploymentDate = new DateOnly(2026, 5, 16) };
        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        // 16 days in May (16th–31st) of 31 → 20000 * 16/31
        Assert.Equal(20000 * 16 / 31.0, result.BaseSalary, 2);
    }

    [Fact]
    public void Ten_thousand_monthly_not_reduced_for_partial_pay_run()
    {
        var emp = SalaryEmployee with { MonthlySalary = 10000 };
        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(10000, result.BaseSalary);
    }

    [Fact]
    public void Mid_month_joiner_gets_full_salary_when_policy_enabled()
    {
        var emp = SalaryEmployee with
        {
            MonthlySalary = 10000,
            EmploymentDate = new DateOnly(2026, 5, 22)
        };
        var policy = new PayrollPolicy { PayFullSalaryForMidMonthJoiners = true };

        var result = Calculate(new PayrollCalculationInput(
            emp, policy, PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(10000, result.BaseSalary);
    }

    [Fact]
    public void Mid_month_joiner_gets_full_salary_when_employee_flag_set()
    {
        var emp = SalaryEmployee with
        {
            MonthlySalary = 10000,
            EmploymentDate = new DateOnly(2026, 5, 22),
            PayFullMonthlySalary = true
        };

        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(10000, result.BaseSalary);
    }

    [Fact]
    public void Fixed_deductions_applied()
    {
        var emp = SalaryEmployee with
        {
            MedicalAidDeduction = 500,
            PensionDeduction = 300,
            UnionDeduction = 50
        };

        var result = Calculate(new PayrollCalculationInput(
            emp, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Contains(result.DeductionLines, d => d.Label == "Medical aid" && d.Amount == 500);
        Assert.Contains(result.DeductionLines, d => d.Label == "Pension" && d.Amount == 300);
        Assert.Contains(result.DeductionLines, d => d.Label == "Union" && d.Amount == 50);
    }

    [Fact]
    public void Bonus_included_in_gross()
    {
        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, new PayrollPolicy(), PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5,
            Overrides: new PayrollPayslipOverrides(BonusAmount: 1500, BonusNote: "Performance")));

        Assert.Equal(1500, result.GrossPay - result.RegularPay - result.OvertimePay);
        Assert.Contains(result.EarningsLines, e => e.Label == "Performance" && e.Amount == 1500);
    }

    [Fact]
    public void Contractor_skips_statutory_deductions()
    {
        var contractor = HourlyEmployee with { WorkerType = "contractor" };
        var sessions = new List<PayrollSessionSnapshot>
        {
            new(new DateOnly(2026, 5, 5), 8, 0, false, false, false)
        };

        var result = Calculate(new PayrollCalculationInput(
            contractor, new PayrollPolicy(), PeriodStart, PeriodEnd,
            sessions, [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.DoesNotContain(result.DeductionLines, d => d.Category == "statutory");
    }

    [Fact]
    public void Salary_ot_disabled_when_policy_off()
    {
        var policy = new PayrollPolicy { AllowOvertimeForSalary = false };
        var sessions = new List<PayrollSessionSnapshot>
        {
            new(new DateOnly(2026, 5, 5), 8, 2, false, false, false)
        };

        var result = Calculate(new PayrollCalculationInput(
            SalaryEmployee, policy, PeriodStart, PeriodEnd,
            sessions, [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Equal(0, result.OvertimeHours);
        Assert.Equal(0, result.OvertimePay);
    }

    [Fact]
    public void Public_holiday_paid_for_hourly_when_enabled()
    {
        var holiday = new DateOnly(2026, 5, 1);
        var policy = new PayrollPolicy
        {
            PayHourlyOnPublicHolidays = true,
            PublicHolidays = [holiday]
        };

        var result = Calculate(new PayrollCalculationInput(
            HourlyEmployee, policy, PeriodStart, PeriodEnd,
            [], [], [], DailyHours: 8, OtMultiplier: 1.5));

        Assert.Contains(result.EarningsLines, e => e.Label.StartsWith("Public holidays"));
        Assert.Equal(8 * 100, result.EarningsLines.First(e => e.Label.StartsWith("Public holidays")).Amount);
    }
}
