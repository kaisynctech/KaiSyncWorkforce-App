namespace KaiFlow.Finance;

/// <summary>
/// Higher-level, still fully deterministic finance helpers built on top of
/// <see cref="VatCalculator"/>: line totals, discounts, document roll-ups,
/// partial payments and settlement-state resolution.
/// </summary>
public static class FinanceCalculationHelper
{
    /// <summary>
    /// Applies a percentage discount then a fixed-amount discount. Never returns below zero.
    /// <paramref name="discountPercent"/> accepts 10 or 0.10 (both =&gt; 10%).
    /// </summary>
    public static decimal ApplyDiscount(decimal amount, decimal discountAmount = 0m, decimal discountPercent = 0m)
    {
        var afterPercent = discountPercent > 0m
            ? amount - VatCalculator.RoundFinancialValues(amount * VatCalculator.NormalizeRate(discountPercent))
            : amount;
        var net = afterPercent - discountAmount;
        return VatCalculator.RoundFinancialValues(net < 0m ? 0m : net);
    }

    /// <summary>
    /// Computes a single invoice/quote line: quantity × unit price, discount applied,
    /// then VAT resolved either inclusive or exclusive.
    /// </summary>
    public static VatCalculationResult CalculateLine(
        decimal quantity,
        decimal unitPrice,
        decimal vatRate,
        bool isVatInclusive,
        TaxType taxType = TaxType.Standard,
        decimal discountAmount = 0m,
        decimal discountPercent = 0m)
    {
        var gross = VatCalculator.RoundFinancialValues(quantity * unitPrice);
        var discounted = ApplyDiscount(gross, discountAmount, discountPercent);
        return isVatInclusive
            ? VatCalculator.CalculateVatInclusive(discounted, vatRate, taxType)
            : VatCalculator.CalculateVatExclusive(discounted, vatRate, taxType);
    }

    /// <summary>Aggregates pre-computed line results into document totals.</summary>
    public static InvoiceTotals SummariseLines(IEnumerable<VatCalculationResult> lines)
    {
        decimal sub = 0m, vat = 0m, total = 0m;
        foreach (var line in lines)
        {
            sub += line.Subtotal;
            vat += line.VatAmount;
            total += line.TotalAmount;
        }
        return new InvoiceTotals
        {
            Subtotal = VatCalculator.RoundFinancialValues(sub),
            VatAmount = VatCalculator.RoundFinancialValues(vat),
            TotalAmount = VatCalculator.RoundFinancialValues(total)
        };
    }

    /// <summary>Remaining balance on a document; never negative.</summary>
    public static decimal BalanceDue(decimal totalAmount, decimal amountPaid)
        => VatCalculator.RoundFinancialValues(Math.Max(0m, totalAmount - amountPaid));

    /// <summary>
    /// Deterministically resolves a document's settlement state from amounts and an
    /// optional due date. <paramref name="asOf"/> defaults to today (UTC) when omitted.
    /// </summary>
    public static PaymentState ResolvePaymentState(
        decimal totalAmount,
        decimal amountPaid,
        DateOnly? dueDate = null,
        DateOnly? asOf = null)
    {
        var today = asOf ?? DateOnly.FromDateTime(DateTime.UtcNow);
        var balance = VatCalculator.RoundFinancialValues(totalAmount - amountPaid);
        var isOverdue = dueDate.HasValue && today > dueDate.Value && balance > 0m;

        if (balance <= 0m && totalAmount > 0m) return PaymentState.Paid;
        if (amountPaid > 0m && balance > 0m) return isOverdue ? PaymentState.Overdue : PaymentState.PartiallyPaid;
        return isOverdue ? PaymentState.Overdue : PaymentState.Unpaid;
    }

    /// <summary>
    /// Builds a VAT-period roll-up. Output VAT is collected on sales (invoices),
    /// input VAT is claimable on purchases (supplier invoices / expenses).
    /// </summary>
    public static VatPeriodSummary SummariseVatPeriod(IEnumerable<decimal> outputVat, IEnumerable<decimal> inputVat)
    {
        var output = VatCalculator.RoundFinancialValues(outputVat.Sum());
        var input = VatCalculator.RoundFinancialValues(inputVat.Sum());
        return new VatPeriodSummary
        {
            OutputVat = output,
            InputVat = input,
            VatDue = VatCalculator.RoundFinancialValues(output - input)
        };
    }

    /// <summary>Profit and margin for a job/project. Margin is expressed as a fraction (0.25 == 25%).</summary>
    public static (decimal Profit, decimal MarginFraction) Profitability(decimal revenue, decimal totalCost)
    {
        var profit = VatCalculator.RoundFinancialValues(revenue - totalCost);
        var margin = revenue == 0m ? 0m : Math.Round(profit / revenue, 4, MidpointRounding.AwayFromZero);
        return (profit, margin);
    }
}
