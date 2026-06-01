namespace KaiFlow.Payroll;

public record Irp5EmployeeYearRecord(
    string EmployeeName,
    string? IdNumber,
    string? TaxNumber,
    double YtdGross,
    double YtdPaye,
    double YtdUif,
    double YtdNet,
    int PayslipCount);

public static class Irp5RecordBuilder
{
    public static IReadOnlyList<Irp5EmployeeYearRecord> BuildForTaxYear(
        int taxYearStartYear,
        IEnumerable<(Guid EmployeeId, string Name, string? IdNumber, string? TaxNumber, IReadOnlyList<PayrollYtdPayslipRow> Payslips)> employees)
    {
        var tyStart = new DateOnly(taxYearStartYear, 3, 1);
        var tyEnd = new DateOnly(taxYearStartYear + 1, 2, DateTime.DaysInMonth(taxYearStartYear + 1, 2));

        return employees.Select(e =>
        {
            var ytd = PayrollYtdHelper.Aggregate(
                e.Payslips.Where(p => p.PeriodEnd >= tyStart && p.PeriodEnd <= tyEnd),
                tyEnd);
            return new Irp5EmployeeYearRecord(
                e.Name, e.IdNumber, e.TaxNumber,
                ytd.GrossPay, ytd.Paye, ytd.Uif, ytd.NetPay, ytd.PayslipCount);
        }).Where(r => r.PayslipCount > 0).OrderBy(r => r.EmployeeName).ToList();
    }

    public static IReadOnlyList<string[]> ToCsvRows(IReadOnlyList<Irp5EmployeeYearRecord> records) =>
        records.Select(r => new[]
        {
            r.EmployeeName,
            r.IdNumber ?? "",
            r.TaxNumber ?? "",
            r.YtdGross.ToString("F2"),
            r.YtdPaye.ToString("F2"),
            r.YtdUif.ToString("F2"),
            r.YtdNet.ToString("F2"),
            r.PayslipCount.ToString()
        }).ToList();
}
