using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;
using System.Text;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record PaymentDisplay(PaymentApproval Payment, string EmployeeName)
{
    public bool CanReleaseToEmployee =>
        Payment.StatusRaw is "approved" or "paid" && !Payment.SharedWithEmployee;

    public bool IsVisibleToEmployee => Payment.SharedWithEmployee;

    public string VisibilityLabel => Payment.SharedWithEmployee
        ? "Visible to employee"
        : "Not shown to employee";

    public string HoursDisplay => Payment.HoursDisplay;

    public string GrossDisplay => Payment.GrossDisplay;

    public string NetDisplay => Payment.NetDisplay;

    public string DeductionsDisplay => Payment.DeductionsDisplay;

    public string StatusLabel =>
        char.ToUpperInvariant(Payment.StatusRaw[0]) + Payment.StatusRaw[1..];

    public string StatusChipKind => Payment.StatusRaw switch
    {
        "approved" or "paid" => "success",
        "pending" => "warning",
        "rejected" => "error",
        _ => "neutral"
    };
}

public partial class HrPaymentsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly StepUpVerificationService _stepUp;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<PaymentDisplay> _payments = [];
    [ObservableProperty] private string _statusFilter = "pending";
    [ObservableProperty] private double _totalPending;
    [ObservableProperty] private double _totalApproved;
    [ObservableProperty] private DateTime _dateFrom = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] private DateTime _dateTo = DateTime.Today;
    [ObservableProperty] private string _searchText = "";

    // Table sort + pagination
    [ObservableProperty] private string _sortColumn = "period";
    [ObservableProperty] private bool _sortAscending;
    [ObservableProperty] private int _pageIndex;
    [ObservableProperty] private int _pageSize = 25;
    [ObservableProperty] private string _pageSummary = "";
    [ObservableProperty] private bool _canGoPrevious;
    [ObservableProperty] private bool _canGoNext;

    public string EmployeeHeaderLabel => FormatHeader("Employee", "employee");
    public string PeriodHeaderLabel => FormatHeader("Period", "period");
    public string GrossHeaderLabel => FormatHeader("Gross", "gross");
    public string NetHeaderLabel => FormatHeader("Net", "net");
    public string StatusHeaderLabel => FormatHeader("Status", "status");

    private List<PaymentApproval> _all = [];
    private Dictionary<Guid, string> _employeeNames = [];
    private Dictionary<Guid, Employee> _employeeMap = [];
    private List<PayrollPeriodLock> _periodLocks = [];
    private bool _autoReleaseAttempted;

    [ObservableProperty] private bool _isCurrentPeriodLocked;
    [ObservableProperty] private string _periodLockLabel = "";

    public List<string> StatusOptions { get; } = ["all", "pending", "approved", "paid", "rejected"];
    public bool HasPendingPayments => Payments.Any(p => p.Payment.StatusRaw == "pending");
    public bool HasReleasablePayslips => Payments.Any(p => p.CanReleaseToEmployee);
    public bool IsPayslipReleaseDay
    {
        get
        {
            var day = _state.CurrentCompany?.CustomSettings != null
                && PayrollPolicy.FromSettings(_state.CurrentCompany.CustomSettings).PayslipReleaseDay > 0
                ? PayrollPolicy.FromSettings(_state.CurrentCompany.CustomSettings).PayslipReleaseDay
                : 0;
            return day > 0 && DateTime.Today.Day == day;
        }
    }

    public string PayslipReleaseHint
    {
        get
        {
            var settings = _state.CurrentCompany?.CustomSettings;
            if (settings == null) return "";
            var releaseDay = PayrollPolicy.FromSettings(settings).PayslipReleaseDay;
            if (releaseDay <= 0) return "";
            return IsPayslipReleaseDay
                ? $"Today (day {releaseDay}) is your payslip release day — tap Release All when ready."
                : $"Payslip release day: {releaseDay}th of each month.";
        }
    }

    public bool ShowPayslipReleaseHint => !string.IsNullOrEmpty(PayslipReleaseHint);

    public HrPaymentsViewModel(IStorageService storage, IExportService export, TimesheetStateService state, StepUpVerificationService stepUp)
    {
        _storage = storage;
        _export = export;
        _stepUp = stepUp;
        _state = state;
        Title = "Payroll";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            _all = await _storage.GetPaymentsAsync(companyId);

            var employees = await _storage.GetEmployeesAsync(companyId);
            _employeeNames = employees.ToDictionary(e => e.Id, e => e.FullName);
            _employeeMap = employees.ToDictionary(e => e.Id, e => e);
            _periodLocks = await _storage.GetPayrollPeriodLocksAsync(companyId);

            TotalPending = _all.Where(p => p.Status == PaymentStatus.Pending).Sum(p => p.GrossPay);
            TotalApproved = _all.Where(p => p.Status == PaymentStatus.Approved).Sum(p => p.GrossPay);

            UpdatePeriodLockState();
            ApplyFilter();
            await TryAutoReleasePayslipsAsync();
        });
    }

    private void UpdatePeriodLockState()
    {
        var from = DateOnly.FromDateTime(DateFrom);
        var to = DateOnly.FromDateTime(DateTo);
        IsCurrentPeriodLocked = PayrollPeriodLockHelper.IsLocked(_periodLocks, _state.CurrentEmployee!.CompanyId, from, to);
        PeriodLockLabel = IsCurrentPeriodLocked
            ? $"Period {from:dd MMM} – {to:dd MMM yyyy} is locked"
            : "";
    }

    private async Task TryAutoReleasePayslipsAsync()
    {
        if (_autoReleaseAttempted || !IsPayslipReleaseDay) return;
        var settings = _state.CurrentCompany?.CustomSettings;
        if (settings == null) return;
        var policy = PayrollPolicy.FromSettings(settings);
        if (!policy.AutoReleasePayslipsOnReleaseDay) return;

        _autoReleaseAttempted = true;
        var releasable = Payments.Where(p => p.CanReleaseToEmployee).ToList();
        if (releasable.Count == 0) return;

        foreach (var display in releasable)
        {
            await _storage.SharePayslipWithEmployeeAsync(display.Payment.Id);
            display.Payment.SharedWithEmployee = true;
            PayrollAuditHelper.Append(display.Payment, "auto-released on release day", "system");
            await _storage.UpdatePaymentAsync(display.Payment);
        }
        ApplyFilter();
    }

    partial void OnStatusFilterChanged(string value) { PageIndex = 0; ApplyFilter(); }
    partial void OnSearchTextChanged(string value) { PageIndex = 0; ApplyFilter(); }
    partial void OnPageIndexChanged(int value) => ApplyFilter();
    partial void OnSortColumnChanged(string value) => NotifySortHeaders();
    partial void OnSortAscendingChanged(bool value) => NotifySortHeaders();
    partial void OnDateFromChanged(DateTime value)
    {
        UpdatePeriodLockState();
        ApplyFilter();
    }

    partial void OnDateToChanged(DateTime value)
    {
        UpdatePeriodLockState();
        ApplyFilter();
    }
    partial void OnPaymentsChanged(ObservableCollection<PaymentDisplay> value)
    {
        OnPropertyChanged(nameof(HasPendingPayments));
        OnPropertyChanged(nameof(HasReleasablePayslips));
    }

    private void NotifySortHeaders()
    {
        OnPropertyChanged(nameof(EmployeeHeaderLabel));
        OnPropertyChanged(nameof(PeriodHeaderLabel));
        OnPropertyChanged(nameof(GrossHeaderLabel));
        OnPropertyChanged(nameof(NetHeaderLabel));
        OnPropertyChanged(nameof(StatusHeaderLabel));
        PageIndex = 0;
        ApplyFilter();
    }

    private string FormatHeader(string label, string key) =>
        SortColumn == key ? label + (SortAscending ? " ▲" : " ▼") : label;

    private IEnumerable<PaymentDisplay> BuildDisplays()
    {
        var from = DateOnly.FromDateTime(DateFrom);
        var to = DateOnly.FromDateTime(DateTo);
        return _all
            .Where(p => p.PeriodStart >= from && p.PeriodEnd <= to)
            .Select(p => new PaymentDisplay(p, _employeeNames.GetValueOrDefault(p.EmployeeId, "Unknown")));
    }

    private void ApplyFilter()
    {
        var result = TableQuery.Apply(new TableQueryOptions<PaymentDisplay>
        {
            Source = BuildDisplays(),
            Predicate = StatusFilter != "all" ? d => d.Payment.StatusRaw == StatusFilter : null,
            SearchText = SearchText,
            MatchesSearch = (d, q) => d.EmployeeName.Contains(q, StringComparison.OrdinalIgnoreCase),
            SortKey = SortColumn,
            SortAscending = SortAscending,
            SortSelectors = new Dictionary<string, Func<PaymentDisplay, IComparable>>(StringComparer.OrdinalIgnoreCase)
            {
                ["employee"] = d => d.EmployeeName,
                ["period"] = d => d.Payment.PeriodStart,
                ["gross"] = d => d.Payment.GrossPay,
                ["net"] = d => d.Payment.NetPay,
                ["status"] = d => d.Payment.StatusRaw,
            },
            PageIndex = PageIndex,
            PageSize = PageSize,
        });

        Payments = new ObservableCollection<PaymentDisplay>(result.Page);
        PageIndex = result.PageIndex;
        PageSummary = result.PageSummary;
        CanGoPrevious = result.CanGoPrevious;
        CanGoNext = result.CanGoNext;
        OnPropertyChanged(nameof(HasPendingPayments));
        OnPropertyChanged(nameof(HasReleasablePayslips));
    }

    [RelayCommand]
    private void ToggleSort(string column)
    {
        if (string.Equals(SortColumn, column, StringComparison.OrdinalIgnoreCase))
            SortAscending = !SortAscending;
        else
        {
            SortColumn = column;
            SortAscending = column is "employee" or "status";
        }
        PageIndex = 0;
    }

    [RelayCommand]
    private void PreviousPage()
    {
        if (CanGoPrevious) PageIndex--;
    }

    [RelayCommand]
    private void NextPage()
    {
        if (CanGoNext) PageIndex++;
    }

    [RelayCommand]
    private async Task OpenPayrollSettingsAsync()
        => await ShellNavigation.GoToAsync(nameof(HrPayrollSettingsPage));

    [RelayCommand]
    private async Task ApproveAsync(PaymentDisplay display)
    {
        var payment = display.Payment;
        await RunAsync(async () =>
        {
            PayrollAuditHelper.Append(payment, "approved", _state.CurrentEmployee?.FullName);
            await _stepUp.ExecuteAsync(async () =>
                await _storage.ApprovePaymentRunAsync(payment.CompanyId, payment.Id));
            payment.StatusRaw = "approved";
            TotalPending -= payment.GrossPay;
            TotalApproved += payment.GrossPay;
            ApplyFilter();
        });
    }

    [RelayCommand]
    private async Task BulkApproveAsync()
    {
        var pending = Payments.Where(p => p.Payment.StatusRaw == "pending").ToList();
        if (pending.Count == 0)
        {
            await Shell.Current.DisplayAlert("Nothing to approve", "No pending payslips in the current filter.", "OK");
            return;
        }

        var confirm = await Shell.Current.DisplayAlert(
            "Bulk Approve",
            $"Approve {pending.Count} pending payslip(s)?",
            "Approve All", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            foreach (var display in pending)
            {
                PayrollAuditHelper.Append(display.Payment, "bulk approved", _state.CurrentEmployee?.FullName);
                await _stepUp.ExecuteAsync(async () =>
                    await _storage.ApprovePaymentRunAsync(display.Payment.CompanyId, display.Payment.Id));
                display.Payment.StatusRaw = "approved";
            }
            TotalPending = _all.Where(p => p.Status == PaymentStatus.Pending).Sum(p => p.GrossPay);
            TotalApproved = _all.Where(p => p.Status == PaymentStatus.Approved).Sum(p => p.GrossPay);
            ApplyFilter();
        });
    }

    [RelayCommand]
    private async Task RejectAsync(PaymentDisplay display)
    {
        var payment = display.Payment;
        await RunAsync(async () =>
        {
            await _storage.RejectPaymentRunAsync(payment.CompanyId, payment.Id);
            payment.StatusRaw = "rejected";
            ApplyFilter();
        });
    }

    [RelayCommand]
    private async Task ExportAsync()
    {
        await _export.ExportToCsvAsync("payments.csv",
            ["Employee", "Period", "Pay Basis", "Regular Hrs", "OT Hrs", "Gross Pay", "Deductions", "Net Pay", "Status"],
            Payments.Select(d => new[]
            {
                d.EmployeeName,
                d.Payment.PeriodLabel,
                d.Payment.PayBasisLabel,
                d.Payment.RegularHours.ToString("F2"),
                d.Payment.OvertimeHours.ToString("F2"),
                d.Payment.GrossPay.ToString("F2"),
                d.Payment.Deductions.ToString("F2"),
                d.Payment.NetPay.ToString("F2"),
                d.Payment.StatusRaw
            }));
    }

    [RelayCommand]
    private async Task ExportRegisterAsync()
    {
        var rows = PayrollRegisterExporter.BuildRows(
            Payments.Select(d => d.Payment),
            _employeeMap);
        if (rows.Count == 0)
        {
            await Shell.Current.DisplayAlert("No data", "No payslips in the current filter.", "OK");
            return;
        }

        await _export.ExportToCsvAsync("payroll_register.csv", PayrollRegisterExporter.Headers, rows);
    }

    [RelayCommand]
    private async Task ExportIrp5Async()
    {
        var (tyStart, _) = PayrollYtdHelper.TaxYearFor(DateOnly.FromDateTime(DateTo));
        var employeeData = _employeeMap.Values.Select(emp =>
        {
            var payslips = _all
                .Where(p => p.EmployeeId == emp.Id && p.StatusRaw != "rejected")
                .Select(PayrollYtdService.ToRow)
                .ToList();
            return (emp.Id, emp.FullName, emp.IdNumber, emp.TaxNumber, (IReadOnlyList<PayrollYtdPayslipRow>)payslips);
        });

        var records = Irp5RecordBuilder.BuildForTaxYear(tyStart.Year, employeeData);
        if (records.Count == 0)
        {
            await Shell.Current.DisplayAlert("No data", "No payslip history for the tax year.", "OK");
            return;
        }

        await _export.ExportToCsvAsync(
            $"irp5_summary_{tyStart.Year}.csv",
            ["Employee", "ID Number", "Tax Number", "YTD Gross", "YTD PAYE", "YTD UIF", "YTD Net", "Payslips"],
            Irp5RecordBuilder.ToCsvRows(records));
    }

    [RelayCommand]
    private async Task ExportBankCsvAsync()
    {
        var format = await Shell.Current.DisplayActionSheet(
            "Bank file format", "Cancel", null, "Generic CSV", "FNB", "ABSA", "Standard Bank");
        if (string.IsNullOrEmpty(format) || format == "Cancel") return;

        var formatKey = format switch
        {
            "FNB" => "fnb",
            "ABSA" => "absa",
            "Standard Bank" => "standard_bank",
            _ => "generic"
        };

        var approved = Payments
            .Where(d => d.Payment.StatusRaw is "approved" or "paid" && d.Payment.NetPay > 0)
            .ToList();
        if (approved.Count == 0)
        {
            await Shell.Current.DisplayAlert("No payments", "No approved/paid payslips to export.", "OK");
            return;
        }

        var bankRows = new List<BankPaymentRow>();
        foreach (var d in approved)
        {
            if (!_employeeMap.TryGetValue(d.Payment.EmployeeId, out var emp)) continue;
            if (string.IsNullOrWhiteSpace(emp.BankAccount)) continue;
            bankRows.Add(new BankPaymentRow(
                emp.FullName,
                emp.BankName ?? "",
                emp.BankBranchCode ?? "",
                emp.BankAccount ?? "",
                d.Payment.NetPay,
                d.Payment.PeriodLabel,
                emp.IdNumber));
        }

        if (bankRows.Count == 0)
        {
            await Shell.Current.DisplayAlert("No banking details", "Approved payslips have no employee bank accounts on file.", "OK");
            return;
        }

        var (headers, rows) = BankPaymentFileFormatter.Format(formatKey, bankRows);
        await _export.ExportToCsvAsync($"bank_payments_{formatKey}.csv", headers, rows);
    }

    [RelayCommand]
    private async Task LockPeriodAsync()
    {
        var from = DateOnly.FromDateTime(DateFrom);
        var to = DateOnly.FromDateTime(DateTo);
        if (IsCurrentPeriodLocked)
        {
            await Shell.Current.DisplayAlert("Already locked", PeriodLockLabel, "OK");
            return;
        }

        var confirm = await Shell.Current.DisplayAlert(
            "Lock Payroll Period",
            $"Lock {from:dd MMM} – {to:dd MMM yyyy}? No recalculations or new drafts for this period.",
            "Lock", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var periodLock = new PayrollPeriodLock
            {
                CompanyId = companyId,
                PeriodStart = from,
                PeriodEnd = to,
                LockedBy = _state.CurrentEmployee?.Id
            };
            await _storage.LockPayrollPeriodAsync(periodLock);
            _periodLocks.Add(periodLock);
            UpdatePeriodLockState();
        });
    }

    [RelayCommand]
    private void SetFilter(string filter) => StatusFilter = filter;

    [RelayCommand]
    private async Task OpenPayslipAsync(PaymentDisplay display)
    {
        await ShellNavigation.GoToAsync($"HrPayslipDetailPage?PaymentId={display.Payment.Id}");
    }

    [RelayCommand]
    private async Task ReleaseToEmployeeAsync(PaymentDisplay display)
    {
        if (!display.CanReleaseToEmployee) return;
        var confirm = await Shell.Current.DisplayAlert(
            "Show Payslip",
            $"Make {display.EmployeeName}'s payslip visible in their app?",
            "Show", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.SharePayslipWithEmployeeAsync(display.Payment.Id);
            display.Payment.SharedWithEmployee = true;
            PayrollAuditHelper.Append(display.Payment, "released to employee", _state.CurrentEmployee?.FullName);
            await _storage.UpdatePaymentAsync(display.Payment);
            ApplyFilter();
        });
    }

    [RelayCommand]
    private async Task BulkReleaseToEmployeesAsync()
    {
        var releasable = Payments.Where(p => p.CanReleaseToEmployee).ToList();
        if (releasable.Count == 0)
        {
            await Shell.Current.DisplayAlert("Nothing to release",
                "No approved/paid payslips waiting to be shown to employees.", "OK");
            return;
        }

        var confirm = await Shell.Current.DisplayAlert(
            "Release Payslips",
            $"Show {releasable.Count} payslip(s) to employees? They will appear in My Payslips.",
            "Release All", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            foreach (var display in releasable)
            {
                await _storage.SharePayslipWithEmployeeAsync(display.Payment.Id);
                display.Payment.SharedWithEmployee = true;
                PayrollAuditHelper.Append(display.Payment, "released to employee", _state.CurrentEmployee?.FullName);
                await _storage.UpdatePaymentAsync(display.Payment);
            }
            ApplyFilter();
            await Shell.Current.DisplayAlert("Done",
                $"{releasable.Count} payslip(s) are now visible to employees.", "OK");
        });
    }

    [RelayCommand]
    private async Task GeneratePayrollAsync()
    {
        if (IsCurrentPeriodLocked)
        {
            await Shell.Current.DisplayAlert("Period locked", "Unlock or choose a different date range before generating.", "OK");
            return;
        }

        var companyId = _state.CurrentEmployee!.CompanyId;
        var today = DateOnly.FromDateTime(DateTime.Today);
        var monthStart = new DateOnly(today.Year, today.Month, 1);

        var employees = await _storage.GetEmployeesAsync(companyId);
        var existingIds = _all
            .Where(p => p.PeriodStart == monthStart && p.PeriodEnd == today && p.StatusRaw != "rejected")
            .Select(p => p.EmployeeId)
            .ToHashSet();

        var preview = PayrollReadinessHelper.BuildPreview(employees, monthStart, today, existingIds);
        var summary = new StringBuilder();
        summary.AppendLine($"Ready to pay: {preview.ReadyCount}");
        if (preview.MissingRatesCount > 0) summary.AppendLine($"Missing rates: {preview.MissingRatesCount}");
        if (preview.MissingShiftCount > 0) summary.AppendLine($"Missing shift template: {preview.MissingShiftCount}");
        if (preview.MissingBankCount > 0) summary.AppendLine($"Missing banking: {preview.MissingBankCount}");
        if (preview.DuplicateCount > 0) summary.AppendLine($"Already generated: {preview.DuplicateCount}");
        if (preview.NotInPeriodCount > 0) summary.AppendLine($"Not in period (join/leave): {preview.NotInPeriodCount}");
        if (preview.ContractorCount > 0) summary.AppendLine($"Contractors (review stat deductions): {preview.ContractorCount}");
        summary.AppendLine();
        summary.AppendLine($"Generate draft payslips for {monthStart:dd MMM} – {today:dd MMM yyyy}?");

        var confirm = await Shell.Current.DisplayAlert("Payroll Checklist", summary.ToString(), "Generate", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var employees = await _storage.GetEmployeesAsync(companyId);
            var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();

            var result = await PayrollGenerationHelper.GenerateAsync(
                _storage, companyId, monthStart, today,
                employees, _all, settings, _state.CurrentEmployee?.FullName);

            var msg = $"Created {result.Created} draft payslip(s).";
            if (result.SkippedDuplicate > 0) msg += $"\n{result.SkippedDuplicate} skipped — already exists for this period.";
            if (result.SkippedIneligible > 0) msg += $"\n{result.SkippedIneligible} skipped — not eligible or outside employment dates.";
            await Shell.Current.DisplayAlert("Done", msg, "OK");
            await LoadAsync();
        });
    }
}
