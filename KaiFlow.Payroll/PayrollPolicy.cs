namespace KaiFlow.Payroll;

public class PayrollPolicy
{
    public string DefaultPayBasis { get; set; } = "monthly_salary";
    public bool SalaryIgnoreAttendanceDeductions { get; set; } = true;

    public PenaltyPolicy AbsentPenalty { get; set; } = new() { Mode = "none" };
    public PenaltyPolicy LatePenalty { get; set; } = new() { Mode = "none" };
    public PenaltyPolicy EarlyPenalty { get; set; } = new() { Mode = "none" };

    public StatutoryPolicy Statutory { get; set; } = new();

    public bool AllowOvertimeForSalary { get; set; } = true;
    public bool PaySalaryOnPublicHolidays { get; set; } = true;
    public bool PayHourlyOnPublicHolidays { get; set; } = false;
    /// <summary>When true, mid-month joiners receive full monthly salary (no join-date pro-rate).</summary>
    public bool PayFullSalaryForMidMonthJoiners { get; set; }
    /// <summary>Preferred day of month to release payslips to employees (0 = manual only).</summary>
    public int PayslipReleaseDay { get; set; }
    /// <summary>When true, approved payslips auto-release to employees on PayslipReleaseDay.</summary>
    public bool AutoReleasePayslipsOnReleaseDay { get; set; }

    public IReadOnlyList<DateOnly> PublicHolidays { get; set; } = [];

    public static PayrollPolicy FromSettings(IReadOnlyDictionary<string, object>? settings)
    {
        var policy = new PayrollPolicy();
        if (settings == null) return policy;

        if (settings.TryGetValue("payroll_default_pay_basis", out var pb))
            policy.DefaultPayBasis = pb?.ToString() ?? policy.DefaultPayBasis;

        if (settings.TryGetValue("payroll_salary_ignore_attendance_deductions", out var si)
            && bool.TryParse(si?.ToString(), out var siB))
            policy.SalaryIgnoreAttendanceDeductions = siB;

        policy.AbsentPenalty = ReadPenalty(settings, "payroll_absent", legacyDeductAbsent: settings);
        policy.LatePenalty = ReadPenalty(settings, "payroll_late");
        policy.EarlyPenalty = ReadPenalty(settings, "payroll_early");
        policy.Statutory = ReadStatutory(settings);
        if (settings.TryGetValue("payroll_allow_ot_for_salary", out var aos) && bool.TryParse(aos?.ToString(), out var aosB))
            policy.AllowOvertimeForSalary = aosB;
        if (settings.TryGetValue("payroll_pay_salary_public_holidays", out var sph) && bool.TryParse(sph?.ToString(), out var sphB))
            policy.PaySalaryOnPublicHolidays = sphB;
        if (settings.TryGetValue("payroll_pay_hourly_public_holidays", out var hph) && bool.TryParse(hph?.ToString(), out var hphB))
            policy.PayHourlyOnPublicHolidays = hphB;
        if (settings.TryGetValue("payroll_pay_full_salary_mid_month_join", out var pfs) && bool.TryParse(pfs?.ToString(), out var pfsB))
            policy.PayFullSalaryForMidMonthJoiners = pfsB;
        if (settings.TryGetValue("payroll_payslip_release_day", out var prd) && int.TryParse(prd?.ToString(), out var prdI))
            policy.PayslipReleaseDay = Math.Clamp(prdI, 0, 28);
        if (settings.TryGetValue("payroll_auto_release_payslips", out var ar) && bool.TryParse(ar?.ToString(), out var arB))
            policy.AutoReleasePayslipsOnReleaseDay = arB;
        policy.PublicHolidays = ReadPublicHolidays(settings);

        return policy;
    }

    public void WriteTo(Dictionary<string, object> settings)
    {
        settings["payroll_default_pay_basis"] = DefaultPayBasis;
        settings["payroll_salary_ignore_attendance_deductions"] = SalaryIgnoreAttendanceDeductions;
        WritePenalty(settings, "payroll_absent", AbsentPenalty);
        WritePenalty(settings, "payroll_late", LatePenalty);
        WritePenalty(settings, "payroll_early", EarlyPenalty);
        settings["payroll_uif_enabled"] = Statutory.UifEnabled;
        settings["payroll_uif_rate_percent"] = Statutory.UifRatePercent;
        settings["payroll_uif_ceiling_monthly"] = Statutory.UifCeilingMonthly;
        settings["payroll_paye_enabled"] = Statutory.PayeEnabled;
        settings["payroll_default_paye_rate_percent"] = Statutory.DefaultPayeRatePercent;
        settings["payroll_use_sars_tax_tables"] = Statutory.UseSarsTaxTables;
        settings["payroll_allow_ot_for_salary"] = AllowOvertimeForSalary;
        settings["payroll_pay_salary_public_holidays"] = PaySalaryOnPublicHolidays;
        settings["payroll_pay_hourly_public_holidays"] = PayHourlyOnPublicHolidays;
        settings["payroll_pay_full_salary_mid_month_join"] = PayFullSalaryForMidMonthJoiners;
        settings["payroll_payslip_release_day"] = PayslipReleaseDay;
        settings["payroll_auto_release_payslips"] = AutoReleasePayslipsOnReleaseDay;
        settings["payroll_public_holidays"] = string.Join(",", PublicHolidays.Select(d => d.ToString("yyyy-MM-dd")));
        // Legacy compat
        settings["deduct_absent_from_pay"] = AbsentPenalty.Mode is "per_day" or "threshold";
    }

    private static PenaltyPolicy ReadPenalty(
        IReadOnlyDictionary<string, object> s,
        string prefix,
        IReadOnlyDictionary<string, object>? legacyDeductAbsent = null)
    {
        var p = new PenaltyPolicy();
        if (s.TryGetValue($"{prefix}_mode", out var mode))
            p.Mode = mode?.ToString() ?? "none";

        if (legacyDeductAbsent != null
            && prefix == "payroll_absent"
            && p.Mode == "none"
            && legacyDeductAbsent.TryGetValue("deduct_absent_from_pay", out var da)
            && bool.TryParse(da?.ToString(), out var dab)
            && dab)
            p.Mode = "per_day";

        if (s.TryGetValue($"{prefix}_threshold", out var th) && int.TryParse(th?.ToString(), out var thI))
            p.ThresholdCount = thI;
        if (s.TryGetValue($"{prefix}_deduct_days", out var dd) && double.TryParse(dd?.ToString(), out var ddD))
            p.DeductDays = ddD;
        if (s.TryGetValue($"{prefix}_deduct_hours", out var dh) && double.TryParse(dh?.ToString(), out var dhD))
            p.DeductHours = dhD;
        if (s.TryGetValue($"{prefix}_apply_to", out var at))
            p.ApplyTo = at?.ToString() ?? "all";

        return p;
    }

    private static void WritePenalty(Dictionary<string, object> s, string prefix, PenaltyPolicy p)
    {
        s[$"{prefix}_mode"] = p.Mode;
        s[$"{prefix}_threshold"] = p.ThresholdCount;
        s[$"{prefix}_deduct_days"] = p.DeductDays;
        s[$"{prefix}_deduct_hours"] = p.DeductHours;
        s[$"{prefix}_apply_to"] = p.ApplyTo;
    }

    private static StatutoryPolicy ReadStatutory(IReadOnlyDictionary<string, object> s)
    {
        var st = new StatutoryPolicy();
        if (s.TryGetValue("payroll_uif_enabled", out var ue) && bool.TryParse(ue?.ToString(), out var ueB))
            st.UifEnabled = ueB;
        if (s.TryGetValue("payroll_uif_rate_percent", out var ur) && double.TryParse(ur?.ToString(), out var urD))
            st.UifRatePercent = urD;
        if (s.TryGetValue("payroll_uif_ceiling_monthly", out var uc) && double.TryParse(uc?.ToString(), out var ucD))
            st.UifCeilingMonthly = ucD;
        if (s.TryGetValue("payroll_paye_enabled", out var pe) && bool.TryParse(pe?.ToString(), out var peB))
            st.PayeEnabled = peB;
        if (s.TryGetValue("payroll_default_paye_rate_percent", out var pr) && double.TryParse(pr?.ToString(), out var prD))
            st.DefaultPayeRatePercent = prD;
        if (s.TryGetValue("payroll_use_sars_tax_tables", out var sars) && bool.TryParse(sars?.ToString(), out var sarsB))
            st.UseSarsTaxTables = sarsB;
        return st;
    }

    private static List<DateOnly> ReadPublicHolidays(IReadOnlyDictionary<string, object> s)
    {
        if (!s.TryGetValue("payroll_public_holidays", out var raw) || raw == null)
            return [];

        var text = raw.ToString() ?? "";
        var list = new List<DateOnly>();
        foreach (var part in text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (DateOnly.TryParse(part, out var d))
                list.Add(d);
        }
        return list;
    }
}

public class PenaltyPolicy
{
    /// <summary>none | per_day | per_occurrence | threshold</summary>
    public string Mode { get; set; } = "none";
    public int ThresholdCount { get; set; } = 3;
    public double DeductDays { get; set; } = 1;
    public double DeductHours { get; set; } = 2;
    /// <summary>all | hourly_only | salary_only</summary>
    public string ApplyTo { get; set; } = "all";
}

public class StatutoryPolicy
{
    public bool UifEnabled { get; set; } = true;
    public double UifRatePercent { get; set; } = 1.0;
    public double UifCeilingMonthly { get; set; } = 17712.0;
    public bool PayeEnabled { get; set; } = true;
    public double DefaultPayeRatePercent { get; set; } = 25.0;
    public bool UseSarsTaxTables { get; set; }
}

public static class PayBasis
{
    public const string MonthlySalary = "monthly_salary";
    public const string Hourly = "hourly";
    public const string Daily = "daily";
}
