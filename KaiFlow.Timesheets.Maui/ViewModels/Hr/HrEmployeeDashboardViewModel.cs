using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(EmployeeId), "EmployeeId")]
public partial class HrEmployeeDashboardViewModel : BaseViewModel, IDisposable
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly ILocationService _location;
    private readonly TimesheetStateService _state;
    private readonly RealtimeService _realtime;
    private readonly IPermissionsService _permissions;
    private bool _punchRefreshInFlight;

    // Core state
    [ObservableProperty] private string _employeeId = "";
    [ObservableProperty] private Employee? _employee;
    [ObservableProperty] private bool _isProfileLoading;
    [ObservableProperty] private PayrollReadinessInfo? _payrollReadiness;

    public bool HasEmployee => Employee != null;
    public bool CanSeePayroll => _permissions.Can(PermissionKeys.PaymentsViewPayroll);
    public bool CanSeePayrollReadiness => CanSeePayroll && PayrollReadiness != null;
    [ObservableProperty] private ObservableCollection<PunchSession> _sessions = [];
    [ObservableProperty] private ObservableCollection<LeaveRequest> _leaveRequests = [];
    [ObservableProperty] private ObservableCollection<LeaveBalance> _leaveBalances = [];
    [ObservableProperty] private ObservableCollection<PaymentApproval> _payments = [];

    // KPI cards — always current month
    [ObservableProperty] private double _totalHoursThisMonth;
    [ObservableProperty] private double _totalPayThisMonth;
    [ObservableProperty] private int _totalPunchesThisMonth;

    // Tab state
    [ObservableProperty] private string _selectedTab = "overview";
    [ObservableProperty] private bool _isOverviewTab = true;
    [ObservableProperty] private bool _isPaymentsTab;
    [ObservableProperty] private bool _isLeaveTab;
    [ObservableProperty] private bool _isDocumentsTab;

    // Documents
    [ObservableProperty] private ObservableCollection<EmployeeDocument> _documents = [];

    // Attendance filter
    [ObservableProperty] private string _attendancePeriod = "month";
    [ObservableProperty] private DateTime _attendanceFrom = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] private DateTime _attendanceTo = DateTime.Today;
    [ObservableProperty] private bool _showCustomRange;

    // Attendance section totals (change with filter)
    [ObservableProperty] private double _attendanceTotalHours;
    [ObservableProperty] private double _attendanceTotalPay;
    [ObservableProperty] private int _attendanceSessions;
    [ObservableProperty] private int _attendanceDaysWorked;

    [RelayCommand]
    private void SetTab(string tab)
    {
        SelectedTab = tab;
        IsOverviewTab  = tab == "overview";
        IsPaymentsTab  = tab == "payments";
        IsLeaveTab     = tab == "leave";
        IsDocumentsTab = tab == "documents";

        if (tab == "documents")
            _ = LoadDocumentsAsync();
    }

    partial void OnAttendancePeriodChanged(string value)
    {
        ShowCustomRange = value == "custom";
        if (value != "custom")
            _ = LoadAttendanceAsync();
    }

    public HrEmployeeDashboardViewModel(
        IStorageService storage, IExportService export, ILocationService location,
        TimesheetStateService state, RealtimeService realtime,
        IPermissionsService permissions)
    {
        _storage  = storage;
        _export   = export;
        _location = location;
        _state    = state;
        _realtime = realtime;
        _permissions = permissions;
        Title = "Employee Profile";
        _realtime.PunchChanged += OnPunchChanged;
    }

    partial void OnEmployeeChanged(Employee? value)
    {
        OnPropertyChanged(nameof(HasEmployee));
        OnPropertyChanged(nameof(CanSeePayrollReadiness));
    }

    partial void OnPayrollReadinessChanged(PayrollReadinessInfo? value)
        => OnPropertyChanged(nameof(CanSeePayrollReadiness));

    partial void OnEmployeeIdChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            MainThread.BeginInvokeOnMainThread(() => _ = LoadAsync());
    }

    public void Dispose() => _realtime.PunchChanged -= OnPunchChanged;

    private void OnPunchChanged(object? sender, EventArgs e)
        => MainThread.BeginInvokeOnMainThread(() => _ = HandlePunchChangedAsync());

    private async Task HandlePunchChangedAsync()
    {
        if (Employee == null || _punchRefreshInFlight) return;
        _punchRefreshInFlight = true;
        try
        {
            await LoadAsync();
        }
        catch { /* non-critical refresh */ }
        finally
        {
            _punchRefreshInFlight = false;
        }
    }

    public async Task LoadAsync()
    {
        if (string.IsNullOrWhiteSpace(EmployeeId)) return;
        if (!Guid.TryParse(EmployeeId, out var id)) return;

        IsProfileLoading = true;
        OnPropertyChanged(nameof(HasEmployee));
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _permissions.RefreshAsync(companyId, _state.CurrentEmployee!);
            OnPropertyChanged(nameof(CanSeePayroll));
            OnPropertyChanged(nameof(CanSeePayrollReadiness));

            Employee = await _storage.GetEmployeeAsync(id);
            if (Employee == null)
            {
                ErrorMessage = "Employee not found or you do not have access.";
                return;
            }

            Title = Employee.FullName;
            if (CanSeePayroll)
                PayrollReadiness = PayrollReadinessHelper.Assess(Employee);
            else
                PayrollReadiness = null;

            var today = DateOnly.FromDateTime(DateTime.Today);
            var monthStart = new DateOnly(today.Year, today.Month, 1);

            // Month punches for KPI cards
            var punches = await _storage.GetPunchesAsync(companyId, monthStart, today, id);
            var built = await BuildSessionsAsync(punches, Employee, monthStart, today);
            Sessions = new ObservableCollection<PunchSession>(built);
            TotalHoursThisMonth = built.Sum(s => s.TotalHours);
            TotalPayThisMonth = built.Sum(s => s.TotalPay);
            TotalPunchesThisMonth = built.Count;

            // Seed attendance section totals from the same month data
            AttendanceTotalHours = TotalHoursThisMonth;
            AttendanceTotalPay = TotalPayThisMonth;
            AttendanceSessions = TotalPunchesThisMonth;
            AttendanceDaysWorked = built.Select(s => s.ClockIn.Date).Distinct().Count();

            var leave = await _storage.GetLeaveRequestsAsync(companyId, id);
            LeaveRequests = new ObservableCollection<LeaveRequest>(leave);
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeLeaveBalances(leave));

            var payments = await _storage.GetPaymentsAsync(companyId);
            if (CanSeePayroll)
            {
                Payments = new ObservableCollection<PaymentApproval>(
                    payments.Where(p => p.EmployeeId == id).OrderByDescending(p => p.PeriodEnd));
            }
            else
            {
                Payments = [];
            }
        });

        IsProfileLoading = false;
        OnPropertyChanged(nameof(HasEmployee));
        OnPropertyChanged(nameof(CanSeePayrollReadiness));
    }

    [RelayCommand]
    private void SetAttendancePeriod(string period) => AttendancePeriod = period;

    [RelayCommand]
    private async Task ApplyCustomRangeAsync() => await LoadAttendanceAsync();

    private async Task LoadAttendanceAsync()
    {
        if (Employee == null) return;

        var today = DateOnly.FromDateTime(DateTime.Today);
        DateOnly from, to;

        switch (AttendancePeriod)
        {
            case "today":
                from = to = today;
                break;
            case "week":
                var offset = (int)DateTime.Today.DayOfWeek;
                from = today.AddDays(-offset);
                to = today;
                break;
            case "custom":
                from = DateOnly.FromDateTime(AttendanceFrom);
                to = DateOnly.FromDateTime(AttendanceTo);
                if (to < from) to = from;
                break;
            default: // month
                from = new DateOnly(today.Year, today.Month, 1);
                to = today;
                break;
        }

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var punches = await _storage.GetPunchesAsync(companyId, from, to, Employee.Id);
            var built = await BuildSessionsAsync(punches, Employee, from, to);
            Sessions = new ObservableCollection<PunchSession>(built);
            AttendanceTotalHours = built.Sum(s => s.TotalHours);
            AttendanceTotalPay = built.Sum(s => s.TotalPay);
            AttendanceSessions = built.Count;
            AttendanceDaysWorked = built.Select(s => s.ClockIn.Date).Distinct().Count();
        });
    }

    [RelayCommand]
    private async Task ApproveLeaveAsync(LeaveRequest request)
    {
        await RunAsync(async () =>
        {
            await _storage.UpdateLeaveStatusAsync(request.Id, "approved");
            request.StatusRaw = "approved";
            var idx = LeaveRequests.IndexOf(request);
            if (idx >= 0) LeaveRequests[idx] = request;
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeLeaveBalances(LeaveRequests.ToList()));
        });
    }

    [RelayCommand]
    private async Task RejectLeaveAsync(LeaveRequest request)
    {
        var note = await Shell.Current.DisplayPromptAsync("Reject Leave", "Reason (optional):", "Reject", "Cancel", "");
        if (note == null) return;
        await RunAsync(async () =>
        {
            await _storage.UpdateLeaveStatusAsync(request.Id, "declined", note);
            request.StatusRaw = "declined";
            var idx = LeaveRequests.IndexOf(request);
            if (idx >= 0) LeaveRequests[idx] = request;
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeLeaveBalances(LeaveRequests.ToList()));
        });
    }

    [RelayCommand]
    private async Task ApplyLeaveAsync()
    {
        if (Employee == null) return;
        await ShellNavigation.GoToAsync(nameof(HrApplyLeavePage),
            new Dictionary<string, object>
            {
                ["EmployeeId"] = Employee.Id.ToString(),
                ["EmployeeName"] = Employee.FullName
            });
    }

    [RelayCommand]
    private async Task GoToEditAsync()
    {
        if (Employee == null) return;
        await ShellNavigation.GoToAsync(nameof(HrEditEmployeePage),
            new Dictionary<string, object> { ["EmployeeId"] = Employee.Id.ToString() });
    }

    [RelayCommand]
    private async Task GeneratePaymentAsync()
    {
        if (Employee == null) return;

        var today = DateOnly.FromDateTime(DateTime.Today);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var companyId = _state.CurrentEmployee!.CompanyId;

        var allPayments = await _storage.GetPaymentsAsync(companyId);
        var alreadyExists = allPayments.Any(p =>
            p.EmployeeId == Employee.Id
            && p.PeriodStart == monthStart
            && p.PeriodEnd == today
            && p.StatusRaw != "rejected");

        if (alreadyExists)
        {
            await Shell.Current.DisplayAlert("Already generated",
                $"A payslip for {Employee.FullName} already exists for {monthStart:dd MMM} – {today:dd MMM yyyy}.",
                "OK");
            return;
        }

        var readiness = PayrollReadinessHelper.Assess(Employee);
        if (!PayrollReadinessHelper.IsEligibleForPayroll(Employee))
        {
            await Shell.Current.DisplayAlert("Cannot generate",
                string.Join("\n", readiness.Issues), "OK");
            return;
        }

        var salaryHint = Employee.MonthlySalary > 0
            ? $"\nMonthly salary: R{Employee.MonthlySalary:N2}"
            : "";
        var confirm = await Shell.Current.DisplayAlert(
            "Generate Payslip",
            $"Create draft payslip for {Employee.FullName}?\nPeriod: {monthStart:dd MMM} – {today:dd MMM yyyy}{salaryHint}",
            "Generate", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
            var result = await PayrollGenerationHelper.GenerateAsync(
                _storage, companyId, monthStart, today,
                [Employee], allPayments, settings, _state.CurrentEmployee?.FullName,
                onlyEmployeeIds: [Employee.Id]);

            if (result.Created == 0)
            {
                var reason = result.SkippedDuplicate > 0
                    ? "A payslip already exists for this period."
                    : "Employee is not eligible for this pay period (check employment dates and rates).";
                await Shell.Current.DisplayAlert("Not generated", reason, "OK");
                return;
            }

            await Shell.Current.DisplayAlert("Done",
                $"Draft payslip created for {Employee.FullName}.", "OK");

            var payments = await _storage.GetPaymentsAsync(companyId);
            Payments = new ObservableCollection<PaymentApproval>(
                payments.Where(p => p.EmployeeId == Employee.Id).OrderByDescending(p => p.PeriodEnd));
        });
    }

    [RelayCommand]
    private async Task OpenPayslipAsync(PaymentApproval payment)
    {
        if (payment == null) return;
        await ShellNavigation.GoToAsync($"HrPayslipDetailPage?PaymentId={payment.Id}");
    }

    [RelayCommand]
    private async Task ShowPayslipToEmployeeAsync(PaymentApproval payment)
    {
        if (payment == null || !payment.CanReleaseToEmployee || Employee == null) return;

        var confirm = await Shell.Current.DisplayAlert(
            "Show Payslip",
            $"Make this payslip visible to {Employee.FullName} in their app?",
            "Show", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.SharePayslipWithEmployeeAsync(payment.Id);
            payment.SharedWithEmployee = true;
            PayrollAuditHelper.Append(payment, "released to employee", _state.CurrentEmployee?.FullName);
            await _storage.UpdatePaymentAsync(payment);
            OnPropertyChanged(nameof(Payments));
        });
    }

    private async Task<List<PunchSession>> BuildSessionsAsync(
        List<TimePunch> punches,
        Employee? employee,
        DateOnly from,
        DateOnly to)
    {
        await BackfillAddressesAsync(punches);
        var companyId = _state.CurrentEmployee!.CompanyId;
        var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
        int lateMin = settings.TryGetValue("late_threshold_minutes", out var l) && int.TryParse(l?.ToString(), out var li) ? li : 30;
        int otMin   = settings.TryGetValue("ot_start_after_minutes",  out var o) && int.TryParse(o?.ToString(), out var oi) ? oi : 30;

        var empMap = employee != null
            ? new Dictionary<Guid, Employee> { [employee.Id] = employee }
            : new Dictionary<Guid, Employee>();

        Dictionary<Guid, EmployeeShiftTemplate>? tmplMap = null;
        EmployeeShiftTemplate? template = null;
        if (employee?.ShiftTemplateId is Guid templateId)
        {
            var templates = await _storage.GetShiftTemplatesAsync(companyId);
            tmplMap = templates.ToDictionary(t => t.Id, t => t);
            tmplMap.TryGetValue(templateId, out template);
        }

        var sessions = PunchSession.Build(punches, empMap, tmplMap, lateMin, otMin);
        if (employee != null)
        {
            var absences = await _storage.GetDailyAbsencesRangeAsync(companyId, from, to, employee.Id);
            var leave = await _storage.GetLeaveRequestsAsync(companyId, employee.Id);
            sessions = AttendanceCalendarHelper.MergeNonWorkDays(
                sessions, absences, leave, employee, from, to, lateMin, otMin, template);
        }

        return sessions;
    }

    private static List<LeaveBalance> ComputeLeaveBalances(List<LeaveRequest> allRequests)
    {
        var thisYear = DateTime.Today.Year;
        var thisYearRequests = allRequests.Where(r => r.StartDate.Year == thisYear).ToList();

        return LeavePolicy.Types.Select(t =>
        {
            var forType = thisYearRequests.Where(r =>
                r.LeaveType.Equals(t.Key, StringComparison.OrdinalIgnoreCase)).ToList();
            var taken = forType.Where(r => r.IsApproved).Sum(r => r.TotalDays);
            var pending = forType.Where(r => r.IsPending).Sum(r => r.TotalDays);
            return new LeaveBalance(t.Key, t.Label, t.Color, t.AnnualDays, taken, pending);
        }).ToList();
    }

    private async Task BackfillAddressesAsync(List<TimePunch> punches)
    {
        foreach (var p in punches.Where(p => string.IsNullOrEmpty(p.Address) && p.Latitude.HasValue))
        {
            var addr = await _location.ReverseGeocodeAsync(p.Latitude!.Value, p.Longitude!.Value);
            if (string.IsNullOrEmpty(addr)) continue;
            p.Address = addr;
            try { await _storage.UpdatePunchAddressAsync(p.Id, addr); } catch { }
        }
    }

    // ─── Documents ────────────────────────────────────────────────────────────

    private async Task FetchDocumentsAsync()
    {
        if (Employee == null) return;
        var docs = await _storage.GetEmployeeDocumentsAsync(Employee.CompanyId, Employee.Id);
        Documents = new ObservableCollection<EmployeeDocument>(docs);
    }

    private async Task LoadDocumentsAsync()
    {
        await RunAsync(FetchDocumentsAsync);
    }

    [RelayCommand]
    private async Task UploadDocumentAsync()
    {
        if (Employee == null) return;

        var (docType, docName) = await EmployeeDocumentTypes.PickTypeAndNameAsync(
            "Document Name", "Upload");
        if (docType == null || docName == null) return;

        try
        {
            var file = await EmployeeDocumentTypes.PickFileAsync("Select document file");
            if (file == null) return;

            await RunAsync(async () =>
            {
                await _storage.UploadEmployeeDocumentAsync(
                    Employee.CompanyId, Employee.Id, file, docType, docName, "hr");
                await FetchDocumentsAsync();
            });
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Upload failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task OpenDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try
        {
            await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Could not open document: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task DownloadDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try
        {
            await _export.DeliverRemoteFileAsync(doc.FileUrl, doc.DocumentName);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Download failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task ReplaceDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null) return;

        var docName = await Shell.Current.DisplayPromptAsync(
            "Replace Document",
            $"Select a new file for \"{doc.DocumentName}\". You can update the label if needed:",
            "Continue", "Cancel",
            initialValue: doc.DocumentName);
        if (string.IsNullOrWhiteSpace(docName)) return;

        try
        {
            var file = await EmployeeDocumentTypes.PickFileAsync("Select replacement file");
            if (file == null) return;

            await RunAsync(async () =>
            {
                await _storage.ReplaceEmployeeDocumentAsync(doc, file, doc.DocumentType, docName.Trim(), "hr");
                await FetchDocumentsAsync();
            });
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Update failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task DeleteDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null) return;
        var confirm = await Shell.Current.DisplayAlert("Delete Document",
            $"Remove \"{doc.DocumentName}\"?", "Delete", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.DeleteEmployeeDocumentAsync(doc);
            Documents.Remove(doc);
        });
    }
}
