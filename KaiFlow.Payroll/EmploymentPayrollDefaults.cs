namespace KaiFlow.Payroll;

public static class EmploymentPayrollDefaults
{
    public static void ApplyForEmploymentType(string employmentType, string workerType, EmployeePayrollDefaults target)
    {
        if (workerType is "contractor" or "subcontractor")
        {
            target.PayBasis = PayBasis.Hourly;
            target.UifExempt = true;
            target.PayeRatePercent = null;
            return;
        }

        switch (employmentType)
        {
            case "part-time":
            case "student":
                target.PayBasis = PayBasis.Hourly;
                break;
            case "contract":
                target.PayBasis = PayBasis.Daily;
                break;
            default:
                target.PayBasis = PayBasis.MonthlySalary;
                break;
        }
    }
}

public class EmployeePayrollDefaults
{
    public string PayBasis { get; set; } = "monthly_salary";
    public bool UifExempt { get; set; }
    public double? PayeRatePercent { get; set; }
}
