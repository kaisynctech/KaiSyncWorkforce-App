namespace KaiFlow.Timesheets.Models;

/// <summary>One row of a rendered finance report (up to four columns).</summary>
public class FinanceReportLine
{
    public string C1 { get; set; } = "";
    public string C2 { get; set; } = "";
    public string C3 { get; set; } = "";
    public string C4 { get; set; } = "";

    /// <summary>Section header (e.g. "INCOME"). Rendered emphasised, no values.</summary>
    public bool IsHeader { get; set; }
    /// <summary>Subtotal / total row. Rendered bold with a tint.</summary>
    public bool IsTotal { get; set; }

    public List<string> Cells(int columnCount) => columnCount switch
    {
        2 => new() { C1, C2 },
        3 => new() { C1, C2, C3 },
        _ => new() { C1, C2, C3, C4 }
    };

    // Binding helpers (string colour/font tokens resolved by MAUI type converters)
    public string RowBackground => IsTotal ? "#E0E7FF" : IsHeader ? "#EEF2F7" : "Transparent";
    public string FontAttr => IsHeader || IsTotal ? "Bold" : "None";
    public string TextColor => IsHeader ? "#1E3A5F" : "#0F172A";
}

/// <summary>
/// A ready-to-render / ready-to-export finance report. The same structure feeds
/// the on-screen preview, the QuestPDF export and the ClosedXML export.
/// </summary>
public class FinanceReport
{
    public string Title { get; set; } = "";
    public string PeriodLabel { get; set; } = "";
    public string FileBaseName { get; set; } = "finance-report";
    public int ColumnCount { get; set; } = 2;

    public string H1 { get; set; } = "";
    public string H2 { get; set; } = "";
    public string H3 { get; set; } = "";
    public string H4 { get; set; } = "";

    public List<FinanceReportLine> Lines { get; set; } = new();

    public List<string> Headers => ColumnCount switch
    {
        2 => new() { H1, H2 },
        3 => new() { H1, H2, H3 },
        _ => new() { H1, H2, H3, H4 }
    };

    public IEnumerable<IEnumerable<string>> ExportRows => Lines.Select(l => l.Cells(ColumnCount));
    public bool HasRows => Lines.Count > 0;
}

/// <summary>Static catalogue of available finance report types.</summary>
public class FinanceReportType
{
    public string Key { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";

    public static readonly List<FinanceReportType> All = new()
    {
        new() { Key = "pnl", Name = "Profit & Loss", Description = "Income vs expenses and net profit" },
        new() { Key = "vat", Name = "VAT Summary", Description = "Output, input and net VAT due" },
        new() { Key = "ar_aging", Name = "Client Debt Aging", Description = "Outstanding invoices by age bucket" },
        new() { Key = "ap", Name = "Accounts Payable", Description = "Outstanding supplier & contractor amounts" },
        new() { Key = "cashflow", Name = "Cashflow Statement", Description = "Money in / out / net by month" },
        new() { Key = "revenue_expense", Name = "Revenue & Expense Trend", Description = "Monthly revenue, expenses and profit" },
        new() { Key = "spend", Name = "Spend Analysis", Description = "Outgoing money grouped by category" },
    };
}
