namespace KaiFlow.Payroll;

/// <summary>
/// Simplified SA PAYE for 2025/2026 tax year (annual brackets, monthly conversion).
/// Use when policy.Statutory.UseSarsTaxTables is true.
/// </summary>
public static class SarsPayeCalculator
{
    // 2025 tax year annual brackets (approximate statutory tables)
    private static readonly (double Limit, double Base, double Rate)[] AnnualBrackets =
    [
        (237_100, 0, 0.18),
        (370_500, 42_678, 0.26),
        (512_800, 77_362, 0.31),
        (673_000, 121_475, 0.36),
        (857_900, 179_147, 0.39),
        (1_817_000, 563_562, 0.41),
        (double.MaxValue, 956_793, 0.45)
    ];

    private const double PrimaryRebateAnnual = 17_235;
    private const double SecondaryRebateAnnual = 9_444; // 65+
    private const double TertiaryRebateAnnual = 3_145;  // 75+

    public static double CalculateMonthlyPaye(
        double monthlyTaxableIncome,
        DateOnly? dateOfBirth = null,
        double? directiveRatePercent = null)
    {
        if (monthlyTaxableIncome <= 0) return 0;

        if (directiveRatePercent.HasValue && directiveRatePercent.Value > 0)
            return Math.Round(monthlyTaxableIncome * directiveRatePercent.Value / 100.0, 2);

        var annual = monthlyTaxableIncome * 12;
        var tax = CalculateAnnualTax(annual);
        var rebate = RebatesFor(dateOfBirth);
        tax = Math.Max(0, tax - rebate);
        return Math.Round(tax / 12.0, 2);
    }

    public static double CalculateAnnualTax(double annualTaxable)
    {
        if (annualTaxable <= 0) return 0;

        double prevLimit = 0;
        foreach (var (limit, baseTax, rate) in AnnualBrackets)
        {
            if (annualTaxable <= limit)
                return baseTax + (annualTaxable - prevLimit) * rate;
            prevLimit = limit;
        }

        var last = AnnualBrackets[^1];
        return last.Base + (annualTaxable - 1_817_000) * last.Rate;
    }

    private static double RebatesFor(DateOnly? dob)
    {
        if (!dob.HasValue) return PrimaryRebateAnnual;
        var age = DateOnly.FromDateTime(DateTime.Today).Year - dob.Value.Year;
        if (age >= 75) return PrimaryRebateAnnual + SecondaryRebateAnnual + TertiaryRebateAnnual;
        if (age >= 65) return PrimaryRebateAnnual + SecondaryRebateAnnual;
        return PrimaryRebateAnnual;
    }
}
