using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>
/// Saves HR payslip adjustments back to the employee profile for future payroll runs.
/// </summary>
public static class PayrollEmployeePersistence
{
    public static void ApplyPayslipToEmployee(Employee emp, PaymentApproval payment)
    {
        emp.PayFullMonthlySalary = payment.PayFullBaseSalary;

        if (payment.ManualPayeOverride.HasValue)
        {
            emp.PayeFixedAmount = payment.ManualPayeOverride.Value;
            emp.PayeRatePercent = null;
        }
        else
        {
            var payeLine = payment.DeductionLines.FirstOrDefault(d => d.Label == "PAYE");
            if (payeLine != null && emp.PayeRatePercent == null)
                emp.PayeFixedAmount = payeLine.Amount;
        }

        var uifLine = payment.DeductionLines.FirstOrDefault(d => d.Label == "UIF");
        if (uifLine != null && emp.UifRatePercent == null)
            emp.UifFixedAmount = uifLine.Amount;
    }
}
