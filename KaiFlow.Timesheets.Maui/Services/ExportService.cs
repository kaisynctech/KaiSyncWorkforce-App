using ClosedXML.Excel;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services.Platform;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using System.Text;
using QuestUnit = QuestPDF.Infrastructure.Unit;

namespace KaiFlow.Timesheets.Services;

public class ExportService : IExportService
{
    private readonly IExportHistoryService _history;
    private readonly TimesheetStateService _state;
    private readonly IUsageMeteringService _usage;

    public ExportService(IExportHistoryService history, TimesheetStateService state, IUsageMeteringService usage)
    {
        _history = history;
        _state = state;
        _usage = usage;
    }
    public async Task<bool?> AskExportDeliveryAsync(string title)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page;
        if (page == null) return true;

        var action = await page.DisplayActionSheet(
            title,
            "Cancel",
            null,
            "Save to Downloads",
            "Share / Email");

        return action switch
        {
            "Save to Downloads" => true,
            "Share / Email" => false,
            _ => null
        };
    }

    public async Task ExportToCsvAsync(string fileName, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, string source = "export")
    {
        var downloadToDevice = await AskExportDeliveryAsync(fileName);
        if (downloadToDevice == null) return;

        var sb = new StringBuilder();
        sb.AppendLine(string.Join(",", headers.Select(EscapeCsv)));
        var rowCount = 0;
        foreach (var row in rows)
        {
            sb.AppendLine(string.Join(",", row.Select(EscapeCsv)));
            rowCount++;
        }

        if (downloadToDevice.Value)
        {
            var dest = GetDownloadPath(fileName);
            await File.WriteAllTextAsync(dest, sb.ToString(), Encoding.UTF8);
            _history.Record(fileName, "csv", source, rowCount);
            await RecordExportAsync("export.csv", source);
            await ShowSavedAlert(dest);
            return;
        }

        var path = Path.Combine(FileSystem.CacheDirectory, fileName);
        await File.WriteAllTextAsync(path, sb.ToString(), Encoding.UTF8);
        _history.Record(fileName, "csv", source, rowCount);
        await RecordExportAsync("export.csv", source);
        await Share.Default.RequestAsync(new ShareFileRequest
        {
            Title = fileName,
            File = new ShareFile(path, "text/csv")
        });
    }

    public async Task ExportToExcelAsync(string fileName, string sheetTitle, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, bool downloadToDevice = false)
    {
        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add(sheetTitle.Length > 31 ? sheetTitle[..31] : sheetTitle);

        var headerList = headers.ToList();
        for (int col = 0; col < headerList.Count; col++)
        {
            var cell = ws.Cell(1, col + 1);
            cell.Value = headerList[col];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
            cell.Style.Font.FontColor = XLColor.White;
            cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        }

        int rowIndex = 2;
        foreach (var rowData in rows)
        {
            int col = 1;
            bool isAlt = (rowIndex % 2) == 0;
            var xlRow = ws.Row(rowIndex);
            if (isAlt)
                xlRow.Style.Fill.BackgroundColor = XLColor.FromHtml("#F1F5F9");

            foreach (var value in rowData)
                ws.Cell(rowIndex, col++).Value = value;

            rowIndex++;
        }

        ws.Columns().AdjustToContents(1, 60);
        ws.SheetView.FreezeRows(1);
        var rowCount = Math.Max(0, rowIndex - 2);

        if (downloadToDevice)
        {
            var dest = GetDownloadPath(fileName);
            wb.SaveAs(dest);
            _history.Record(fileName, "excel", sheetTitle, rowCount);
            await RecordExportAsync("export.excel", sheetTitle);
            await ShowSavedAlert(dest);
        }
        else
        {
            var path = Path.Combine(FileSystem.CacheDirectory, fileName);
            wb.SaveAs(path);
            _history.Record(fileName, "excel", sheetTitle, rowCount);
            await RecordExportAsync("export.excel", sheetTitle);
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = fileName,
                File = new ShareFile(path, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            });
        }
    }

    public async Task ExportToPdfAsync(string fileName, string title, IEnumerable<string> headers, IEnumerable<IEnumerable<string>> rows, bool downloadToDevice = false)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        var headerList = headers.ToList();
        var rowList = rows.Select(r => r.ToList()).ToList();
        var colCount = headerList.Count;

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(colCount > 6 ? PageSizes.A4.Landscape() : PageSizes.A4);
                page.Margin(1.5f, QuestUnit.Centimetre);
                page.DefaultTextStyle(x => x.FontSize(9).FontFamily("Arial"));

                page.Header().Column(col =>
                {
                    col.Item().Text(title).Bold().FontSize(14).FontColor("#1e3a5f");
                    col.Item().Text($"Generated: {DateTime.Now:dd MMM yyyy HH:mm}")
                        .FontSize(8).FontColor("#64748b");
                    col.Item().Height(8);
                });

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cd =>
                    {
                        for (int i = 0; i < colCount; i++)
                            cd.RelativeColumn();
                    });

                    table.Header(header =>
                    {
                        foreach (var h in headerList)
                            header.Cell()
                                .Background("#1e3a5f")
                                .Padding(5)
                                .Text(h).Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                    });

                    for (int i = 0; i < rowList.Count; i++)
                    {
                        var bg = i % 2 == 0 ? "#ffffff" : "#f1f5f9";
                        foreach (var cell in rowList[i])
                            table.Cell()
                                .Background(bg)
                                .BorderBottom(0.5f).BorderColor("#e2e8f0")
                                .Padding(4)
                                .Text(cell).FontSize(9);
                    }
                });

                page.Footer().AlignRight()
                    .Text(x =>
                    {
                        x.Span("Page ").FontSize(8).FontColor("#94a3b8");
                        x.CurrentPageNumber().FontSize(8).FontColor("#94a3b8");
                        x.Span(" of ").FontSize(8).FontColor("#94a3b8");
                        x.TotalPages().FontSize(8).FontColor("#94a3b8");
                    });
            });
        });

        if (downloadToDevice)
        {
            var dest = GetDownloadPath(fileName);
            doc.GeneratePdf(dest);
            _history.Record(fileName, "pdf", title, rowList.Count);
            await RecordExportAsync("export.pdf", title);
            await ShowSavedAlert(dest);
        }
        else
        {
            var path = Path.Combine(FileSystem.CacheDirectory, fileName);
            doc.GeneratePdf(path);
            _history.Record(fileName, "pdf", title, rowList.Count);
            await RecordExportAsync("export.pdf", title);
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = fileName,
                File = new ShareFile(path, "application/pdf")
            });
        }
    }

    public async Task ExportPayslipPdfAsync(PaymentApproval payment, string employeeName, string companyName, bool downloadToDevice = false)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        var safeName = string.Concat(employeeName.Select(c => char.IsLetterOrDigit(c) ? c : '_'));
        var fileName = $"Payslip_{safeName}_{payment.PeriodStart:yyyy-MM}.pdf";

        var statusColor = payment.StatusRaw switch
        {
            "paid"     => "#16a34a",
            "approved" => "#2563eb",
            "rejected" => "#dc2626",
            _          => "#d97706"
        };

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2.2f, QuestUnit.Centimetre);
                page.DefaultTextStyle(x => x.FontFamily("Arial").FontSize(10).FontColor("#0f172a"));

                page.Content().Column(col =>
                {
                    // ── Header ──────────────────────────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(companyName).Bold().FontSize(15).FontColor("#1e3a5f");
                            c.Item().Text("PAYSLIP").Bold().FontSize(22).FontColor("#3b82f6");
                        });
                        row.ConstantItem(130).Column(c =>
                        {
                            c.Item().AlignRight().Text(payment.PeriodLabel).FontSize(9).FontColor("#64748b");
                            c.Item().AlignRight().Text(payment.StatusRaw.ToUpper()).Bold().FontSize(10).FontColor(statusColor);
                        });
                    });

                    col.Item().Height(6);
                    col.Item().LineHorizontal(1.5f).LineColor("#1e3a5f");
                    col.Item().Height(10);

                    col.Item().Text(employeeName).Bold().FontSize(13);
                    col.Item().Height(14);

                    // ── Attendance ───────────────────────────────────
                    col.Item().Text("ATTENDANCE").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(5);
                    PayslipRow(col, "Days Worked",     $"{payment.WorkingDays} day(s)");
                    PayslipRow(col, "Approved Leave",  payment.LeaveDaysDisplay, "#2563eb");
                    if (payment.AbsentDays > 0)
                        PayslipRow(col, "Absent Days", $"{payment.AbsentDays} day(s)", "#dc2626");
                    col.Item().Height(12);

                    // ── Hours ────────────────────────────────────────
                    col.Item().Text("HOURS").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(5);
                    PayslipRow(col, "Regular Hours",  $"{payment.RegularHours:F2} hrs");
                    if (payment.OvertimeHours > 0)
                        PayslipRow(col, "Overtime Hours", $"{payment.OvertimeHours:F2} hrs", "#d97706");
                    col.Item().Height(12);

                    // ── Earnings ─────────────────────────────────────
                    col.Item().Text("EARNINGS").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(5);
                    PayslipRow(col, "Regular Pay",   $"R {payment.RegularPay:N2}");
                    if (payment.OvertimePay > 0)
                        PayslipRow(col, "Overtime Pay", $"R {payment.OvertimePay:N2}", "#d97706");
                    if (payment.BaseSalary > 0 && payment.PayBasisRaw == "monthly_salary")
                        PayslipRow(col, "Base salary", $"R {payment.BaseSalary:N2}");
                    col.Item().Height(4);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(4);
                    PayslipRow(col, "Gross Pay", $"R {payment.GrossPay:N2}");

                    if (payment.DeductionLines.Count > 0)
                    {
                        col.Item().Height(8);
                        col.Item().Text("DEDUCTIONS").Bold().FontSize(8).FontColor("#64748b");
                        col.Item().Height(3);
                        col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                        col.Item().Height(4);
                        foreach (var line in payment.DeductionLines)
                            PayslipRow(col, line.Label, $"- R {line.Amount:N2}", "#dc2626");
                    }
                    else if (payment.Deductions > 0)
                        PayslipRow(col, "Deductions", $"- R {payment.Deductions:N2}", "#dc2626");
                    col.Item().Height(6);
                    col.Item().LineHorizontal(1.5f).LineColor("#1e3a5f");
                    col.Item().Height(8);

                    // ── Net Pay ──────────────────────────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text("NET PAY").Bold().FontSize(14).FontColor("#1e3a5f");
                        row.ConstantItem(160).AlignRight()
                            .Text($"R {payment.NetPay:N2}").Bold().FontSize(16).FontColor("#3b82f6");
                    });

                    if (payment.YtdTotals is { } ytd)
                    {
                        col.Item().Height(14);
                        col.Item().Text("YEAR TO DATE (TAX YEAR)").Bold().FontSize(8).FontColor("#64748b");
                        col.Item().Height(3);
                        col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                        col.Item().Height(4);
                        PayslipRow(col, "YTD Gross", $"R {ytd.GrossPay:N2}");
                        PayslipRow(col, "YTD PAYE", $"R {ytd.Paye:N2}", "#dc2626");
                        PayslipRow(col, "YTD UIF", $"R {ytd.Uif:N2}", "#dc2626");
                        PayslipRow(col, "YTD Net", $"R {ytd.NetPay:N2}", "#2563eb");
                    }

                    // ── Notes ────────────────────────────────────────
                    if (!string.IsNullOrWhiteSpace(payment.Notes))
                    {
                        col.Item().Height(14);
                        col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                        col.Item().Height(6);
                        col.Item().Text("NOTES").Bold().FontSize(8).FontColor("#64748b");
                        col.Item().Height(3);
                        col.Item().Text(payment.Notes).FontSize(9).FontColor("#475569").Italic();
                    }

                    // ── Footer ───────────────────────────────────────
                    col.Item().Height(20);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(4);
                    if (payment.ApprovedAt.HasValue)
                        col.Item().Text($"Approved: {payment.ApprovedAt.Value:dd MMM yyyy}").FontSize(8).FontColor("#94a3b8");
                    if (payment.PaidAt.HasValue)
                        col.Item().Text($"Paid: {payment.PaidAt.Value:dd MMM yyyy}").FontSize(8).FontColor("#94a3b8");
                    col.Item().Text($"Generated by KaiSync Workforce  •  {DateTime.Now:dd MMM yyyy HH:mm}").FontSize(8).FontColor("#94a3b8");
                });
            });
        });

        if (downloadToDevice)
        {
            var dest = GetDownloadPath(fileName);
            doc.GeneratePdf(dest);
            await ShowSavedAlert(dest);
        }
        else
        {
            var path = Path.Combine(FileSystem.CacheDirectory, fileName);
            doc.GeneratePdf(path);
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = $"Payslip – {employeeName}",
                File = new ShareFile(path, "application/pdf")
            });
        }
    }

    public async Task ExportQuotationPdfAsync(Client? client, ClientDeal deal, IEnumerable<ProjectQuotationLine> lines, string? companyName, bool downloadToDevice = false)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        var safeCode = string.IsNullOrWhiteSpace(deal.ProjectCode) ? deal.Id.ToString()[..8] : deal.ProjectCode;
        var fileName = $"quotation-{safeCode}.pdf";
        var ordered = lines.OrderBy(l => l.LineNo).ToList();
        double total = ordered.Sum(l => l.LineTotal);
        if (ordered.Count == 0 && deal.OfferAmount > 0)
            total = deal.OfferAmount;

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2f, QuestUnit.Centimetre);
                page.DefaultTextStyle(x => x.FontFamily("Arial").FontSize(10).FontColor("#0f172a"));

                page.Content().Column(col =>
                {
                    col.Item().Text("QUOTATION").Bold().FontSize(20).FontColor("#1e3a5f");
                    col.Item().Height(6);
                    if (!string.IsNullOrWhiteSpace(companyName))
                        col.Item().Text($"From: {companyName}").FontSize(10).FontColor("#475569");
                    if (client != null)
                        col.Item().Text($"To:   {client.Name}").FontSize(10).FontColor("#475569");
                    else
                        col.Item().Text("To:   Internal project").FontSize(10).FontColor("#475569");
                    col.Item().Text($"Project: {deal.ProjectCodeDisplay} — {deal.Title}").Bold().FontSize(11);
                    col.Item().Text($"Date: {DateTime.Today:dd MMM yyyy}").FontSize(9).FontColor("#64748b");
                    if (deal.QuotationValidUntil.HasValue)
                        col.Item().Text($"Valid until: {deal.QuotationValidUntil.Value:dd MMM yyyy}").FontSize(9).FontColor("#64748b");
                    if (deal.QuotationSentAt.HasValue)
                        col.Item().Text($"Sent: {deal.QuotationSentAt.Value.ToLocalTime():dd MMM yyyy}").FontSize(9).FontColor("#64748b");

                    if (!string.IsNullOrWhiteSpace(deal.QuotationNotes))
                    {
                        col.Item().Height(10);
                        col.Item().Text(deal.QuotationNotes.Trim()).FontSize(10).FontColor("#334155");
                    }

                    col.Item().Height(16);
                    col.Item().Text("Line items").Bold().FontSize(11).FontColor("#1e3a5f");
                    col.Item().Height(6);

                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(cd =>
                        {
                            cd.ConstantColumn(28);
                            cd.RelativeColumn(3);
                            cd.ConstantColumn(56);
                            cd.ConstantColumn(72);
                            cd.ConstantColumn(88);
                        });

                        table.Header(header =>
                        {
                            header.Cell().Background("#1e3a5f").Padding(6).AlignMiddle()
                                .Text("#").Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                            header.Cell().Background("#1e3a5f").Padding(6).AlignMiddle()
                                .Text("Description").Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                            header.Cell().Background("#1e3a5f").Padding(6).AlignRight().AlignMiddle()
                                .Text("Qty").Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                            header.Cell().Background("#1e3a5f").Padding(6).AlignRight().AlignMiddle()
                                .Text("Unit").Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                            header.Cell().Background("#1e3a5f").Padding(6).AlignRight().AlignMiddle()
                                .Text("Total").Bold().FontColor(QuestPDF.Helpers.Colors.White).FontSize(9);
                        });

                        void DataRow(string no, string desc, string qty, string unit, string lineTotal, string bg)
                        {
                            table.Cell().Background(bg).Padding(5).Text(no).FontSize(9);
                            table.Cell().Background(bg).Padding(5).Text(desc).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(qty).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(unit).FontSize(9);
                            table.Cell().Background(bg).Padding(5).AlignRight().Text(lineTotal).FontSize(9);
                        }

                        if (ordered.Count == 0 && deal.OfferAmount > 0)
                        {
                            DataRow("1", "Total agreed amount", "1.00", $"R {deal.OfferAmount:N2}", $"R {deal.OfferAmount:N2}", "#ffffff");
                        }
                        else
                        {
                            for (int i = 0; i < ordered.Count; i++)
                            {
                                var line = ordered[i];
                                var bg = i % 2 == 0 ? "#ffffff" : "#f8fafc";
                                DataRow(
                                    line.LineNo.ToString(),
                                    line.Description,
                                    line.Quantity.ToString("N2"),
                                    $"R {line.UnitPrice:N2}",
                                    $"R {line.LineTotal:N2}",
                                    bg);
                            }
                        }
                    });

                    col.Item().Height(10);
                    col.Item().AlignRight().Text($"TOTAL: R {total:N2}").Bold().FontSize(14).FontColor("#1e3a5f");
                    if (deal.OfferAmount > 0 && Math.Abs(total - deal.OfferAmount) > 0.01)
                        col.Item().AlignRight().Text($"(Agreed project total: R {deal.OfferAmount:N2})").FontSize(9).FontColor("#64748b");

                    col.Item().Height(24);
                    col.Item().Text("Thank you for your business.").Italic().FontSize(10).FontColor("#64748b");
                    col.Item().Height(8);
                    col.Item().Text($"Generated by KaiSync Workforce  •  {DateTime.Now:dd MMM yyyy HH:mm}")
                        .FontSize(8).FontColor("#94a3b8");
                });
            });
        });

        if (downloadToDevice)
        {
            var dest = GetDownloadPath(fileName);
            doc.GeneratePdf(dest);
            await ShowSavedAlert(dest);
        }
        else
        {
            var path = Path.Combine(FileSystem.CacheDirectory, fileName);
            doc.GeneratePdf(path);
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = $"Quotation — {deal.Title}",
                File = new ShareFile(path, "application/pdf")
            });
        }
    }

    public async Task ExportContractorRemittancePdfAsync(ContractorPayout payout, string contractorName, string companyName, bool downloadToDevice = false)
    {
        QuestPDF.Settings.License = LicenseType.Community;

        var safe = string.Concat(contractorName.Select(c => char.IsLetterOrDigit(c) ? c : '_'));
        var fileName = $"Remittance_{safe}_{DateTime.Now:yyyy-MM-dd}.pdf";

        var paymentDate = payout.PaidAt.HasValue
            ? payout.PaidAt.Value.ToLocalTime().ToString("dd MMM yyyy")
            : payout.PayoutDate?.ToString("dd MMM yyyy") ?? DateTime.Today.ToString("dd MMM yyyy");

        var invoiceRef = payout.InvoiceReferenceDisplay != "—" ? payout.InvoiceReferenceDisplay : payout.Id.ToString()[..8].ToUpper();

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(2.2f, QuestUnit.Centimetre);
                page.DefaultTextStyle(x => x.FontFamily("Arial").FontSize(10).FontColor("#0f172a"));

                page.Content().Column(col =>
                {
                    // ── Header ──────────────────────────────────────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Column(c =>
                        {
                            c.Item().Text(companyName).Bold().FontSize(15).FontColor("#1e3a5f");
                            c.Item().Text("REMITTANCE ADVICE").Bold().FontSize(22).FontColor("#3b82f6");
                        });
                        row.ConstantItem(130).Column(c =>
                        {
                            c.Item().AlignRight().Text($"Date: {paymentDate}").FontSize(9).FontColor("#64748b");
                            c.Item().AlignRight().Text("PAID").Bold().FontSize(10).FontColor("#16a34a");
                        });
                    });

                    col.Item().Height(6);
                    col.Item().LineHorizontal(1.5f).LineColor("#1e3a5f");
                    col.Item().Height(10);

                    // ── Recipient ───────────────────────────────────────────────
                    col.Item().Text("TO").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().Text(contractorName).Bold().FontSize(13);
                    col.Item().Height(14);

                    // ── Reference ───────────────────────────────────────────────
                    col.Item().Text("PAYMENT DETAILS").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(5);
                    RemittanceRow(col, "Invoice Reference", invoiceRef);
                    RemittanceRow(col, "Payment Date",      paymentDate);
                    RemittanceRow(col, "Payment Method",    "EFT");
                    col.Item().Height(14);

                    // ── Amounts ─────────────────────────────────────────────────
                    col.Item().Text("AMOUNT BREAKDOWN").Bold().FontSize(8).FontColor("#64748b");
                    col.Item().Height(3);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(5);
                    RemittanceRow(col, "Subtotal",          $"R {payout.Subtotal:N2}");
                    if (payout.VatAmount > 0)
                        RemittanceRow(col, $"VAT ({payout.VatRate:G}%)", $"R {payout.VatAmount:N2}", "#64748b");
                    RemittanceRow(col, "Total Amount",      $"R {payout.TotalAmount:N2}");
                    if (payout.RetentionAmount > 0)
                        RemittanceRow(col, "Retention Held", $"- R {payout.RetentionAmount:N2}", "#d97706");
                    col.Item().Height(6);
                    col.Item().LineHorizontal(1.5f).LineColor("#1e3a5f");
                    col.Item().Height(8);

                    // ── Net Pay ─────────────────────────────────────────────────
                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text("NET PAYMENT").Bold().FontSize(14).FontColor("#1e3a5f");
                        row.ConstantItem(160).AlignRight()
                            .Text($"R {payout.NetPayable:N2}").Bold().FontSize(16).FontColor("#3b82f6");
                    });

                    // ── Notes ───────────────────────────────────────────────────
                    if (!string.IsNullOrWhiteSpace(payout.Notes))
                    {
                        col.Item().Height(14);
                        col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                        col.Item().Height(6);
                        col.Item().Text("NOTES").Bold().FontSize(8).FontColor("#64748b");
                        col.Item().Height(3);
                        col.Item().Text(payout.Notes).FontSize(9).FontColor("#475569").Italic();
                    }

                    // ── Footer ──────────────────────────────────────────────────
                    col.Item().Height(24);
                    col.Item().LineHorizontal(0.5f).LineColor("#e2e8f0");
                    col.Item().Height(4);
                    col.Item().Text($"Generated by KaiSync Workforce  •  {DateTime.Now:dd MMM yyyy HH:mm}")
                        .FontSize(8).FontColor("#94a3b8");
                });
            });
        });

        if (downloadToDevice)
        {
            var dest = GetDownloadPath(fileName);
            doc.GeneratePdf(dest);
            await ShowSavedAlert(dest);
        }
        else
        {
            var path = Path.Combine(FileSystem.CacheDirectory, fileName);
            doc.GeneratePdf(path);
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = $"Remittance — {contractorName}",
                File  = new ShareFile(path, "application/pdf")
            });
        }
    }

    private static void PayslipRow(ColumnDescriptor col, string label, string value, string? valueColor = null)
    {
        col.Item().Row(row =>
        {
            row.RelativeItem().Text(label).FontSize(10).FontColor("#475569");
            row.ConstantItem(160).AlignRight().Text(value).FontSize(10).FontColor(valueColor ?? "#0f172a");
        });
        col.Item().Height(3);
    }

    private static void RemittanceRow(ColumnDescriptor col, string label, string value, string? valueColor = null)
    {
        col.Item().Row(row =>
        {
            row.RelativeItem().Text(label).FontSize(10).FontColor("#475569");
            row.ConstantItem(180).AlignRight().Text(value).FontSize(10).FontColor(valueColor ?? "#0f172a");
        });
        col.Item().Height(3);
    }

    public async Task DeliverRemoteFileAsync(string url, string suggestedFileName)
    {
        var downloadToDevice = await AskExportDeliveryAsync(suggestedFileName);
        if (downloadToDevice == null) return;

        using var http = new HttpClient();
        var bytes = await http.GetByteArrayAsync(url);

        var ext = Path.GetExtension(new Uri(url).AbsolutePath);
        if (string.IsNullOrEmpty(ext)) ext = ".pdf";
        var safeBase = string.Concat(suggestedFileName.Split(Path.GetInvalidFileNameChars()));
        if (string.IsNullOrWhiteSpace(safeBase)) safeBase = "document";
        var fileName = safeBase + ext;

        const string mimePdf = "application/pdf";
        var mime = ext.ToLowerInvariant() switch
        {
            ".pdf"  => mimePdf,
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png"  => "image/png",
            ".doc"  => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            _       => "application/octet-stream"
        };

        if (downloadToDevice.Value)
        {
            var dest = GetDownloadPath(fileName);
            await File.WriteAllBytesAsync(dest, bytes);
            await ShowSavedAlert(dest);
            return;
        }

        var cachePath = Path.Combine(FileSystem.CacheDirectory, fileName);
        await File.WriteAllBytesAsync(cachePath, bytes);
        await Share.Default.RequestAsync(new ShareFileRequest
        {
            Title = suggestedFileName,
            File  = new ShareFile(cachePath, mime)
        });
    }

    public async Task ExportEmployeeImportTemplateAsync(IReadOnlyList<EmployeeShiftTemplate> templates)
    {
        const string fileName = "employee_import_template.xlsx";
        var downloadToDevice = await AskExportDeliveryAsync("Employee Import Template");
        if (downloadToDevice == null) return;

        var defaultTemplateName = templates.FirstOrDefault(t => t.IsDefault)?.Name
            ?? (templates.Count == 1 ? templates[0].Name : "");

        using var wb = new XLWorkbook();
        var ws = wb.Worksheets.Add("Employees");

        string[] headers =
        [
            "name", "surname", "id_number", "position", "branch", "employment_type",
            "worker_type", "access_level", "monthly_salary", "pay_basis", "paye_rate_percent",
            "uif_exempt", "medical_aid_deduction", "pension_deduction", "union_deduction",
            "work_days_weekly", "daily_hours", "time_template", "employment_date",
            "termination_date", "email", "phone", "employee_code", "hourly_rate", "daily_rate"
        ];

        for (var i = 0; i < headers.Length; i++)
        {
            var cell = ws.Cell(1, i + 1);
            cell.Value = headers[i];
            cell.Style.Font.Bold = true;
            cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
            cell.Style.Font.FontColor = XLColor.White;
        }

        var sample = new object?[]
        {
            "John", "Doe", "9001011234088", "Technician", "Johannesburg", "permanent",
            "employee", "employee", "15000", "monthly_salary", "25", "no", "500", "0", "0",
            "5", "", defaultTemplateName,
            DateTime.Today.ToString("yyyy-MM-dd"), "",
            "john.doe@company.com", "+27821234567", "", "85.50", "684"
        };
        for (var i = 0; i < sample.Length; i++)
            ws.Cell(2, i + 1).Value = sample[i]?.ToString() ?? "";
        ws.Row(2).Style.Font.Italic = true;
        ws.Row(2).Style.Font.FontColor = XLColor.FromHtml("#64748b");

        var notes = wb.Worksheets.Add("Instructions");
        notes.Cell(1, 1).Value = "Required columns: name, surname, id_number (or employee_code), access_level";
        notes.Cell(2, 1).Value = "employment_type: permanent, part-time, contract, student";
        notes.Cell(3, 1).Value = "worker_type: employee, contractor, subcontractor";
        notes.Cell(4, 1).Value = "access_level: employee, manager, admin, hr_admin";
        notes.Cell(5, 1).Value = "pay_basis: monthly_salary, hourly, daily (blank = auto from employment type)";
        notes.Cell(6, 1).Value = "uif_exempt: yes/no — contractors default to yes";
        notes.Cell(7, 1).Value = "time_template: optional — leave blank to use company default; daily_hours auto-fills from template when blank";
        notes.Cell(8, 1).Value = "You may use your own Excel — matching column headers are detected automatically.";

        if (templates.Count > 0)
        {
            var refSheet = wb.Worksheets.Add("Time Templates");
            refSheet.Cell(1, 1).Value = "Name";
            refSheet.Cell(1, 2).Value = "Start";
            refSheet.Cell(1, 3).Value = "End";
            refSheet.Cell(1, 4).Value = "Paid Hours";
            refSheet.Cell(1, 5).Value = "Default";
            refSheet.Row(1).Style.Font.Bold = true;
            refSheet.Row(1).Style.Fill.BackgroundColor = XLColor.FromHtml("#1E3A5F");
            refSheet.Row(1).Style.Font.FontColor = XLColor.White;

            for (var i = 0; i < templates.Count; i++)
            {
                var t = templates[i];
                var row = i + 2;
                refSheet.Cell(row, 1).Value = t.Name;
                refSheet.Cell(row, 2).Value = t.StartTime.ToString("HH:mm");
                refSheet.Cell(row, 3).Value = t.EndTime.ToString("HH:mm");
                refSheet.Cell(row, 4).Value = t.PaidHours;
                refSheet.Cell(row, 5).Value = t.IsDefault ? "yes" : "";
            }
            refSheet.Columns().AdjustToContents();
        }

        ws.Columns().AdjustToContents();
        ws.SheetView.FreezeRows(1);

        const string mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (downloadToDevice.Value)
        {
            var dest = GetDownloadPath(fileName);
            wb.SaveAs(dest);
            await ShowSavedAlert(dest);
            return;
        }

        var path = Path.Combine(FileSystem.CacheDirectory, fileName);
        wb.SaveAs(path);
        await Share.Default.RequestAsync(new ShareFileRequest
        {
            Title = "Employee Import Template",
            File  = new ShareFile(path, mime)
        });
    }

    public Task<EmployeeImportParseResult> ParseEmployeeImportFileAsync(
        string filePath,
        Guid companyId,
        IReadOnlySet<string> existingLoginIdentifiers,
        EmployeeImportContext? templateContext = null)
        => Task.FromResult(EmployeeImportParser.Parse(filePath, companyId, existingLoginIdentifiers, templateContext));

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private async Task RecordExportAsync(string metricKey, string source)
    {
        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (!companyId.HasValue) return;
        try
        {
            await _usage.RecordEventAsync(companyId.Value, metricKey);
            await _usage.RecordEventAsync(companyId.Value, $"export.source.{source}");
        }
        catch { /* non-critical */ }
    }

    private static string EscapeCsv(string value)
    {
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }

    private static string GetDownloadPath(string fileName)
    {
        var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        if (!Directory.Exists(downloads))
            downloads = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        return Path.Combine(downloads, fileName);
    }

    private static async Task ShowSavedAlert(string fullPath)
    {
        var page = Application.Current?.Windows[0].Page;
        if (page != null)
            await page.DisplayAlert("Saved", $"File saved to:\n{fullPath}", "OK");
    }
}
