namespace KaiFlow.Payroll;

public static class PayrollCalculator
{
    public static PayrollCalculationResult? Calculate(PayrollCalculationInput input)
    {
        var emp = input.Employee;
        if (!PayrollPeriodHelper.IsEmployedInPeriod(
                input.PeriodStart, input.PeriodEnd, emp.EmploymentDate, emp.TerminationDate))
            return null;

        var (resolvedMonthly, resolvedHourly, resolvedDaily) = SalaryResolver.ResolveAsOf(
            emp.MonthlySalary, emp.HourlyRate, emp.DailyRate,
            input.PeriodEnd, input.SalaryHistory);
        emp = emp with
        {
            MonthlySalary = resolvedMonthly,
            HourlyRate = resolvedHourly,
            DailyRate = resolvedDaily
        };

        var policy = input.Policy;
        var overrides = input.Overrides ?? new PayrollPayslipOverrides();
        var payBasis = ResolvePayBasis(emp, policy);
        var isContractor = emp.WorkerType is "contractor" or "subcontractor";

        var proRateFactor = overrides.PayFullBaseSalary
            ? 1.0
            : PayrollPeriodHelper.ProRateFactor(
                input.PeriodStart, input.PeriodEnd, emp.EmploymentDate, emp.TerminationDate);

        if (proRateFactor <= 0) return null;

        var absentDates = input.Absences.Select(a => a.Date).ToHashSet();
        var closedSessions = input.Sessions.Where(s => !s.IsOpen && !absentDates.Contains(s.Date)).ToList();

        var sessionDates = closedSessions.Select(s => s.Date).Distinct().ToHashSet();
        var workingDays = sessionDates.Count;
        var lateCount = closedSessions.Count(s => s.IsLate);
        var earlyCount = closedSessions.Count(s => s.IsLeftEarly);

        var hourlyRate = ResolveHourlyRate(emp, input.DailyHours);
        var dailyRate = emp.DailyRate > 0 ? emp.DailyRate : hourlyRate * input.DailyHours;
        var otMultiplier = emp.OvertimeRate > 0 ? emp.OvertimeRate : input.OtMultiplier;

        var allowOt = payBasis != PayBasis.MonthlySalary || policy.AllowOvertimeForSalary;
        var overtimeHours = allowOt ? closedSessions.Sum(s => s.OvertimeHours) : 0;

        double paidLeaveDays = 0;
        double unpaidLeaveDays = 0;
        foreach (var leave in input.Leave.Where(l => l.IsApproved))
        {
            var days = LeaveDayCalculator.CountDaysInPeriod(
                leave.StartDate, leave.EndDate,
                input.PeriodStart, input.PeriodEnd,
                leave.HalfDayStart, leave.HalfDayEnd, leave.TotalDays);

            if (LeaveDayCalculator.IsUnpaidLeave(leave.LeaveType))
                unpaidLeaveDays += days;
            else
                paidLeaveDays += days;
        }

        var paidLeaveOnlyDays = CountLeaveOnlyDays(input, sessionDates, absentDates, unpaid: false);
        var overlapLeaveDays = CountOverlapLeaveDays(input, sessionDates, unpaid: false);
        var absentDays = absentDates.Count;

        var holidaysInPeriod = policy.PublicHolidays
            .Where(h => h >= input.PeriodStart && h <= input.PeriodEnd
                        && !sessionDates.Contains(h) && !absentDates.Contains(h))
            .ToList();

        var earnings = new List<PayrollLineItem>();
        double regularPay;
        double regularHours;
        double baseSalary = 0;

        var periodDays = input.PeriodEnd.DayNumber - input.PeriodStart.DayNumber + 1;
        var daysInMonth = DateTime.DaysInMonth(input.PeriodEnd.Year, input.PeriodEnd.Month);

        switch (payBasis)
        {
            case PayBasis.MonthlySalary:
            {
                var payFullSalary = overrides.PayFullBaseSalary
                    || emp.PayFullMonthlySalary
                    || policy.PayFullSalaryForMidMonthJoiners;

                var salaryFactor = payFullSalary
                    ? 1.0
                    : PayrollPeriodHelper.MonthlySalaryFactor(
                        input.PeriodStart, input.PeriodEnd, emp.EmploymentDate, emp.TerminationDate);

                if (salaryFactor <= 0) return null;

                baseSalary = emp.MonthlySalary * salaryFactor;
                regularPay = baseSalary;
                regularHours = workingDays * input.DailyHours;
                var salaryLabel = payFullSalary
                    ? "Base salary (full month)"
                    : salaryFactor < 1.0
                        ? "Base salary (pro-rated for join/leave)"
                        : "Base salary";
                earnings.Add(new PayrollLineItem(salaryLabel, baseSalary, "earning"));
                break;
            }

            case PayBasis.Daily:
                regularHours = (workingDays + paidLeaveOnlyDays + overlapLeaveDays) * input.DailyHours;
                regularPay = (workingDays + paidLeaveOnlyDays + overlapLeaveDays) * dailyRate;
                if (workingDays > 0)
                    earnings.Add(new PayrollLineItem("Days worked", workingDays * dailyRate, "earning"));
                if (paidLeaveOnlyDays + overlapLeaveDays > 0)
                    earnings.Add(new PayrollLineItem("Paid leave (daily)",
                        (paidLeaveOnlyDays + overlapLeaveDays) * dailyRate, "earning"));
                break;

            default:
                var workedHours = closedSessions.Sum(s => s.RegularHours);
                var leaveHours = (paidLeaveOnlyDays + overlapLeaveDays) * input.DailyHours;
                regularHours = workedHours + leaveHours;
                regularPay = regularHours * hourlyRate;
                if (workedHours > 0)
                    earnings.Add(new PayrollLineItem("Regular hours", workedHours * hourlyRate, "earning"));
                if (leaveHours > 0)
                    earnings.Add(new PayrollLineItem("Paid leave", leaveHours * hourlyRate, "earning"));
                break;
        }

        AddPublicHolidayEarnings(earnings, ref regularPay, payBasis, holidaysInPeriod, dailyRate, hourlyRate, input.DailyHours, policy);

        var overtimePay = overtimeHours * hourlyRate * otMultiplier;
        if (overtimePay > 0)
            earnings.Add(new PayrollLineItem("Overtime", overtimePay, "earning"));

        if (overrides.BonusAmount > 0)
        {
            var bonusLabel = string.IsNullOrWhiteSpace(overrides.BonusNote) ? "Bonus" : overrides.BonusNote!;
            earnings.Add(new PayrollLineItem(bonusLabel, overrides.BonusAmount, "earning"));
        }

        double unpaidLeaveDeduction = 0;
        if (unpaidLeaveDays > 0 && payBasis == PayBasis.MonthlySalary && !overrides.WaivePenalties)
        {
            unpaidLeaveDeduction = unpaidLeaveDays * dailyRate;
            regularPay = Math.Max(0, regularPay - unpaidLeaveDeduction);
        }

        var grossPay = regularPay + overtimePay + overrides.BonusAmount;

        var deductions = new List<PayrollLineItem>();
        if (unpaidLeaveDeduction > 0)
            deductions.Add(new PayrollLineItem(
                $"Unpaid leave ({unpaidLeaveDays:F1} day(s))", unpaidLeaveDeduction, "leave"));
        if (!overrides.WaivePenalties)
            AddAttendancePenalties(deductions, policy, payBasis, absentDays, lateCount, earlyCount,
                hourlyRate, dailyRate, input.DailyHours);

        AddFixedEmployeeDeductions(deductions, emp);

        if (overrides.ManualAdjustment > 0)
        {
            var label = string.IsNullOrWhiteSpace(overrides.AdjustmentNote)
                ? "Manual adjustment"
                : overrides.AdjustmentNote!;
            deductions.Add(new PayrollLineItem(label, overrides.ManualAdjustment, "adjustment"));
        }

        if (!isContractor)
        {
            var statutoryFactor = payBasis == PayBasis.MonthlySalary
                ? PayrollPeriodHelper.MonthlySalaryFactor(
                    input.PeriodStart, input.PeriodEnd, emp.EmploymentDate, emp.TerminationDate)
                : periodDays / (double)daysInMonth;
            AddStatutoryDeductions(deductions, policy, emp, grossPay, statutoryFactor, overrides);
        }

        var totalDeductions = deductions.Sum(d => d.Amount);
        var netPay = Math.Max(0, grossPay - totalDeductions);

        var noteParts = new List<string>();
        if (payBasis == PayBasis.MonthlySalary && !overrides.PayFullBaseSalary
            && !emp.PayFullMonthlySalary && !policy.PayFullSalaryForMidMonthJoiners)
        {
            var sf = PayrollPeriodHelper.MonthlySalaryFactor(
                input.PeriodStart, input.PeriodEnd, emp.EmploymentDate, emp.TerminationDate);
            if (sf < 1.0) noteParts.Add("pro-rated for join/leave dates");
        }
        else if (overrides.PayFullBaseSalary || emp.PayFullMonthlySalary || policy.PayFullSalaryForMidMonthJoiners)
        {
            if (payBasis == PayBasis.MonthlySalary) noteParts.Add("full monthly salary");
        }
        else if (proRateFactor < 1.0 && !overrides.PayFullBaseSalary)
            noteParts.Add("pro-rated for join/leave dates");
        if (lateCount > 0) noteParts.Add($"{lateCount} late arrival{(lateCount > 1 ? "s" : "")}");
        if (earlyCount > 0) noteParts.Add($"{earlyCount} early departure{(earlyCount > 1 ? "s" : "")}");
        if (absentDays > 0) noteParts.Add($"{absentDays} absent day{(absentDays > 1 ? "s" : "")}");
        if (unpaidLeaveDays > 0) noteParts.Add($"{unpaidLeaveDays:F1} unpaid leave day(s)");
        if (paidLeaveDays > 0) noteParts.Add($"{paidLeaveDays:F1} paid leave day(s)");
        if (holidaysInPeriod.Count > 0) noteParts.Add($"{holidaysInPeriod.Count} public holiday(s)");
        if (overrides.PayFullBaseSalary) noteParts.Add("full base salary override");
        if (overrides.WaivePenalties) noteParts.Add("penalties waived");
        if (overrides.BonusAmount > 0) noteParts.Add("bonus included");

        var interim = new PayrollCalculationResult(
            PayBasis: payBasis,
            BaseSalary: baseSalary,
            WorkingDays: workingDays,
            LeaveDays: Math.Round(paidLeaveDays, 2),
            AbsentDays: absentDays,
            UnpaidLeaveDays: Math.Round(unpaidLeaveDays, 2),
            RegularHours: regularHours,
            OvertimeHours: overtimeHours,
            RegularPay: regularPay,
            OvertimePay: overtimePay,
            GrossPay: grossPay,
            TotalDeductions: totalDeductions,
            NetPay: netPay,
            LateCount: lateCount,
            EarlyCount: earlyCount,
            EarningsLines: earnings,
            DeductionLines: deductions,
            Notes: noteParts.Count > 0 ? string.Join(", ", noteParts) : null);

        var ytd = input.PriorYtd != null
            ? PayrollYtdHelper.Merge(input.PriorYtd, interim)
            : null;

        return interim with { YtdTotals = ytd };
    }

    private static void AddPublicHolidayEarnings(
        List<PayrollLineItem> earnings,
        ref double regularPay,
        string payBasis,
        List<DateOnly> holidays,
        double dailyRate,
        double hourlyRate,
        double dailyHours,
        PayrollPolicy policy)
    {
        if (holidays.Count == 0) return;

        var paySalary = payBasis == PayBasis.MonthlySalary && policy.PaySalaryOnPublicHolidays;
        var payHourly = payBasis != PayBasis.MonthlySalary && policy.PayHourlyOnPublicHolidays;
        if (!paySalary && !payHourly) return;

        double amount = payBasis switch
        {
            PayBasis.Daily => holidays.Count * dailyRate,
            PayBasis.MonthlySalary => 0,
            _ => holidays.Count * dailyHours * hourlyRate
        };

        if (amount > 0)
        {
            regularPay += amount;
            earnings.Add(new PayrollLineItem($"Public holidays ({holidays.Count})", amount, "earning"));
        }
    }

    private static void AddFixedEmployeeDeductions(List<PayrollLineItem> deductions, PayrollEmployeeSnapshot emp)
    {
        if (emp.MedicalAidDeduction > 0)
            deductions.Add(new PayrollLineItem("Medical aid", emp.MedicalAidDeduction, "fixed"));
        if (emp.PensionDeduction > 0)
            deductions.Add(new PayrollLineItem("Pension", emp.PensionDeduction, "fixed"));
        if (emp.UnionDeduction > 0)
            deductions.Add(new PayrollLineItem("Union", emp.UnionDeduction, "fixed"));
    }

    private static double CountOverlapLeaveDays(
        PayrollCalculationInput input,
        HashSet<DateOnly> sessionDates,
        bool unpaid)
    {
        double overlap = 0;
        foreach (var leave in input.Leave.Where(l => l.IsApproved && LeaveDayCalculator.IsUnpaidLeave(l.LeaveType) == unpaid))
        {
            var overlapStart = leave.StartDate < input.PeriodStart ? input.PeriodStart : leave.StartDate;
            var overlapEnd = leave.EndDate > input.PeriodEnd ? input.PeriodEnd : leave.EndDate;
            for (var d = overlapStart; d <= overlapEnd; d = d.AddDays(1))
            {
                if (!sessionDates.Contains(d)) continue;
                if (d == leave.StartDate && d == leave.EndDate)
                {
                    if (leave.TotalDays > 0 && leave.TotalDays < 1) overlap += leave.TotalDays;
                    else if (leave.HalfDayStart || leave.HalfDayEnd) overlap += 0.5;
                }
                else if (d == leave.StartDate && leave.HalfDayStart) overlap += 0.5;
                else if (d == leave.EndDate && leave.HalfDayEnd) overlap += 0.5;
            }
        }
        return overlap;
    }

    private static string ResolvePayBasis(PayrollEmployeeSnapshot emp, PayrollPolicy policy)
    {
        if (!string.IsNullOrWhiteSpace(emp.PayBasis))
            return emp.PayBasis!;

        if (emp.MonthlySalary > 0) return PayBasis.MonthlySalary;
        if (emp.HourlyRate > 0) return PayBasis.Hourly;
        if (emp.DailyRate > 0) return PayBasis.Daily;
        return policy.DefaultPayBasis;
    }

    private static double ResolveHourlyRate(PayrollEmployeeSnapshot emp, double dailyHours)
    {
        if (emp.HourlyRate > 0) return emp.HourlyRate;
        if (emp.DailyRate > 0 && dailyHours > 0) return emp.DailyRate / dailyHours;
        if (emp.MonthlySalary > 0 && emp.WorkDaysWeekly > 0 && dailyHours > 0)
        {
            var workDaysPerMonth = emp.WorkDaysWeekly * 52.0 / 12.0;
            var daily = emp.MonthlySalary / workDaysPerMonth;
            return daily / dailyHours;
        }
        return 0;
    }

    private static double CountLeaveOnlyDays(
        PayrollCalculationInput input,
        HashSet<DateOnly> sessionDates,
        HashSet<DateOnly> absentDates,
        bool unpaid)
    {
        double only = 0;
        foreach (var leave in input.Leave.Where(l => l.IsApproved && LeaveDayCalculator.IsUnpaidLeave(l.LeaveType) == unpaid))
        {
            var overlapStart = leave.StartDate < input.PeriodStart ? input.PeriodStart : leave.StartDate;
            var overlapEnd = leave.EndDate > input.PeriodEnd ? input.PeriodEnd : leave.EndDate;
            for (var d = overlapStart; d <= overlapEnd; d = d.AddDays(1))
            {
                if (sessionDates.Contains(d) || absentDates.Contains(d)) continue;
                if (d == leave.StartDate && d == leave.EndDate)
                {
                    if (leave.TotalDays > 0 && leave.TotalDays < 1) only += leave.TotalDays;
                    else if (leave.HalfDayStart || leave.HalfDayEnd) only += 0.5;
                    else only += 1;
                }
                else if (d == leave.StartDate && leave.HalfDayStart) only += 0.5;
                else if (d == leave.EndDate && leave.HalfDayEnd) only += 0.5;
                else only += 1;
            }
        }
        return only;
    }

    private static void AddAttendancePenalties(
        List<PayrollLineItem> deductions,
        PayrollPolicy policy,
        string payBasis,
        int absentDays,
        int lateCount,
        int earlyCount,
        double hourlyRate,
        double dailyRate,
        double dailyHours)
    {
        if (ShouldApplyPenalty(policy.AbsentPenalty, policy, payBasis))
            AddPenalty(deductions, policy.AbsentPenalty, absentDays, 0,
                dailyRate, hourlyRate, dailyHours, "Absent");

        if (ShouldApplyPenalty(policy.LatePenalty, policy, payBasis))
            AddPenalty(deductions, policy.LatePenalty, 0, lateCount,
                dailyRate, hourlyRate, dailyHours, "Late arrival");

        if (ShouldApplyPenalty(policy.EarlyPenalty, policy, payBasis))
            AddPenalty(deductions, policy.EarlyPenalty, 0, earlyCount,
                dailyRate, hourlyRate, dailyHours, "Early departure");
    }

    private static bool ShouldApplyPenalty(PenaltyPolicy penalty, PayrollPolicy policy, string payBasis)
    {
        if (penalty.Mode == "none") return false;
        if (payBasis == PayBasis.MonthlySalary && policy.SalaryIgnoreAttendanceDeductions)
            return penalty.ApplyTo == "salary_only";
        if (payBasis != PayBasis.MonthlySalary && penalty.ApplyTo == "salary_only")
            return false;
        if (payBasis == PayBasis.MonthlySalary && penalty.ApplyTo == "hourly_only")
            return false;
        return true;
    }

    private static void AddPenalty(
        List<PayrollLineItem> deductions,
        PenaltyPolicy penalty,
        int dayCount,
        int occurrenceCount,
        double dailyRate,
        double hourlyRate,
        double dailyHours,
        string labelPrefix)
    {
        double amount = 0;
        string label = labelPrefix;

        switch (penalty.Mode)
        {
            case "per_day" when dayCount > 0:
                amount = dayCount * penalty.DeductDays * dailyRate;
                label = $"{labelPrefix} ({dayCount} day(s))";
                break;
            case "threshold" when dayCount >= penalty.ThresholdCount && dayCount > 0:
                amount = penalty.DeductDays * dailyRate;
                label = $"{labelPrefix} ({penalty.ThresholdCount}+ days)";
                break;
            case "per_occurrence" when occurrenceCount > 0:
                amount = occurrenceCount * penalty.DeductHours * hourlyRate;
                label = $"{labelPrefix} ({occurrenceCount}×)";
                break;
            case "threshold" when occurrenceCount >= penalty.ThresholdCount && occurrenceCount > 0:
                amount = penalty.DeductHours * hourlyRate;
                label = $"{labelPrefix} ({penalty.ThresholdCount}+ times)";
                break;
        }

        if (amount > 0)
            deductions.Add(new PayrollLineItem(label, amount, "penalty"));
    }

    private static void AddStatutoryDeductions(
        List<PayrollLineItem> deductions,
        PayrollPolicy policy,
        PayrollEmployeeSnapshot emp,
        double grossPay,
        double periodFactor,
        PayrollPayslipOverrides overrides)
    {
        if (!emp.UifExempt && grossPay > 0)
        {
            double? uif = null;
            if (emp.UifFixedAmount > 0)
                uif = emp.UifFixedAmount;
            else if (emp.UifRatePercent.HasValue && emp.UifRatePercent.Value > 0)
            {
                var ceiling = policy.Statutory.UifCeilingMonthly * periodFactor;
                var uifBase = Math.Min(grossPay, ceiling);
                uif = Math.Round(uifBase * emp.UifRatePercent.Value / 100.0, 2);
            }

            if (uif is > 0)
                deductions.Add(new PayrollLineItem("UIF", uif.Value, "statutory"));
        }

        if (grossPay > 0)
        {
            double? paye = null;
            if (overrides.ManualPayeOverride.HasValue)
                paye = overrides.ManualPayeOverride.Value;
            else if (emp.PayeFixedAmount > 0)
                paye = emp.PayeFixedAmount;
            else if (policy.Statutory.UseSarsTaxTables)
                paye = SarsPayeCalculator.CalculateMonthlyPaye(
                    grossPay, emp.DateOfBirth, emp.TaxDirectiveRatePercent ?? emp.PayeRatePercent);
            else if (emp.PayeRatePercent.HasValue && emp.PayeRatePercent.Value > 0)
                paye = Math.Round(grossPay * emp.PayeRatePercent.Value / 100.0, 2);

            if (paye is > 0)
                deductions.Add(new PayrollLineItem("PAYE", paye.Value, "statutory"));
        }
    }
}
