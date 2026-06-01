namespace KaiFlow.Payroll;

public record PayrollYtdTotals(
    double GrossPay,
    double NetPay,
    double TotalDeductions,
    double Paye,
    double Uif,
    double TaxableEarnings,
    int PayslipCount);

public static class PayrollYtdHelper
{
    /// <summary>SA tax year: March to February.</summary>
    public static (DateOnly Start, DateOnly End) TaxYearFor(DateOnly date)
    {
        var year = date.Month >= 3 ? date.Year : date.Year - 1;
        var start = new DateOnly(year, 3, 1);
        var end = new DateOnly(year + 1, 2, DateTime.DaysInMonth(year + 1, 2));
        return (start, end);
    }

    public static PayrollYtdTotals Aggregate(IEnumerable<PayrollYtdPayslipRow> priorPayslips, DateOnly asOfPeriodEnd)
    {
        var (tyStart, tyEnd) = TaxYearFor(asOfPeriodEnd);
        var rows = priorPayslips
            .Where(p => p.PeriodEnd >= tyStart && p.PeriodEnd <= asOfPeriodEnd && p.Status != "rejected")
            .ToList();

        double paye = 0, uif = 0;
        foreach (var row in rows)
        {
            foreach (var line in row.DeductionLines)
            {
                if (line.Label == "PAYE") paye += line.Amount;
                if (line.Label == "UIF") uif += line.Amount;
            }
        }

        return new PayrollYtdTotals(
            rows.Sum(r => r.GrossPay),
            rows.Sum(r => r.NetPay),
            rows.Sum(r => r.Deductions),
            paye,
            uif,
            rows.Sum(r => r.GrossPay),
            rows.Count);
    }

    public static PayrollYtdTotals Merge(PayrollYtdTotals prior, PayrollCalculationResult current)
    {
        var paye = current.DeductionLines.Where(d => d.Label == "PAYE").Sum(d => d.Amount);
        var uif = current.DeductionLines.Where(d => d.Label == "UIF").Sum(d => d.Amount);
        return new PayrollYtdTotals(
            prior.GrossPay + current.GrossPay,
            prior.NetPay + current.NetPay,
            prior.TotalDeductions + current.TotalDeductions,
            prior.Paye + paye,
            prior.Uif + uif,
            prior.TaxableEarnings + current.GrossPay,
            prior.PayslipCount + 1);
    }
}

public record PayrollYtdPayslipRow(
    DateOnly PeriodEnd,
    string Status,
    double GrossPay,
    double NetPay,
    double Deductions,
    IReadOnlyList<PayrollLineItem> DeductionLines);
