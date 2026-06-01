using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using Newtonsoft.Json;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(PaymentId), "PaymentId")]
public partial class HrPayslipDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _paymentId = "";
    [ObservableProperty] private PaymentApproval? _payment;
    [ObservableProperty] private string _employeeName = "";
    [ObservableProperty] private bool _isSharedWithEmployee;
    [ObservableProperty] private bool _payFullBaseSalary;
    [ObservableProperty] private bool _waivePenalties;
    [ObservableProperty] private string _manualPayeOverrideText = "";
    [ObservableProperty] private string _manualAdjustmentText = "0";
    [ObservableProperty] private string _adjustmentNote = "";
    [ObservableProperty] private string _bonusAmountText = "0";
    [ObservableProperty] private string _bonusNote = "";
    [ObservableProperty] private ObservableCollection<PayrollLineItem> _earningsLines = [];
    [ObservableProperty] private ObservableCollection<PayrollLineItem> _deductionLines = [];
    [ObservableProperty] private ObservableCollection<PayrollAuditEntry> _auditEntries = [];
    [ObservableProperty] private string? _policySnapshotSummary;
    [ObservableProperty] private PayrollYtdTotals? _ytdTotals;
    [ObservableProperty] private bool _isPeriodLocked;

    public bool HasEarningsLines => EarningsLines.Count > 0;
    public bool HasDeductionLines => DeductionLines.Count > 0;
    public bool HasAuditEntries => AuditEntries.Count > 0;
    public bool HasPolicySnapshot => !string.IsNullOrWhiteSpace(PolicySnapshotSummary);
    public bool HasYtd => YtdTotals != null;
    public bool CanRecalculate => Payment?.CanEditOverrides == true && !IsPeriodLocked;

    partial void OnEarningsLinesChanged(ObservableCollection<PayrollLineItem> value)
    {
        OnPropertyChanged(nameof(HasEarningsLines));
    }

    partial void OnDeductionLinesChanged(ObservableCollection<PayrollLineItem> value)
    {
        OnPropertyChanged(nameof(HasDeductionLines));
    }

    partial void OnAuditEntriesChanged(ObservableCollection<PayrollAuditEntry> value)
    {
        OnPropertyChanged(nameof(HasAuditEntries));
    }

    partial void OnPolicySnapshotSummaryChanged(string? value)
    {
        OnPropertyChanged(nameof(HasPolicySnapshot));
    }

    partial void OnYtdTotalsChanged(PayrollYtdTotals? value)
    {
        OnPropertyChanged(nameof(HasYtd));
    }

    partial void OnIsPeriodLockedChanged(bool value)
    {
        OnPropertyChanged(nameof(CanRecalculate));
        OnPropertyChanged(nameof(CanEditOverrides));
    }

    public bool CanApprove          => Payment?.StatusRaw == "pending";
    public bool CanMarkPaid         => Payment?.StatusRaw == "approved";
    public bool CanReject           => Payment?.StatusRaw is "pending" or "approved";
    public bool CanSendToEmployee   => Payment != null && !IsSharedWithEmployee;
    public bool CanEditOverrides    => Payment?.CanEditOverrides == true && !IsPeriodLocked;
    private string CompanyName      => _state.CurrentCompany?.Name ?? "KaiSync";

    public HrPayslipDetailViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export  = export;
        _state   = state;
        Title = "Payslip Detail";
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(PaymentId, out var id)) return;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var all = await _storage.GetPaymentsAsync(companyId);
            Payment = all.FirstOrDefault(p => p.Id == id);

            if (Payment != null)
            {
                var employees = await _storage.GetEmployeesAsync(companyId);
                EmployeeName = employees.FirstOrDefault(e => e.Id == Payment.EmployeeId)?.FullName ?? "Unknown";
                Title = $"Payslip – {EmployeeName}";
                IsSharedWithEmployee = Payment.SharedWithEmployee;

                var locks = await _storage.GetPayrollPeriodLocksAsync(companyId);
                IsPeriodLocked = PayrollPeriodLockHelper.IsLocked(
                    locks, companyId, Payment.PeriodStart, Payment.PeriodEnd);

                PayFullBaseSalary = Payment.PayFullBaseSalary;
                WaivePenalties = Payment.WaivePenalties;
                ManualPayeOverrideText = Payment.ManualPayeOverride?.ToString("F2") ?? "";
                ManualAdjustmentText = Payment.ManualAdjustment.ToString("F2");
                AdjustmentNote = Payment.AdjustmentNote ?? "";
                BonusAmountText = Payment.BonusAmount.ToString("F2");
                BonusNote = Payment.BonusNote ?? "";
                EarningsLines = new ObservableCollection<PayrollLineItem>(Payment.EarningsLines);
                DeductionLines = new ObservableCollection<PayrollLineItem>(Payment.DeductionLines);
                AuditEntries = new ObservableCollection<PayrollAuditEntry>(PayrollAuditHelper.Read(Payment));
                PolicySnapshotSummary = FormatPolicySnapshot(Payment.PolicySnapshotJson);
                YtdTotals = Payment.YtdTotals;
            }

            RefreshActionVisibility();
        });
    }

    private void RefreshActionVisibility()
    {
        OnPropertyChanged(nameof(CanApprove));
        OnPropertyChanged(nameof(CanMarkPaid));
        OnPropertyChanged(nameof(CanReject));
        OnPropertyChanged(nameof(CanSendToEmployee));
        OnPropertyChanged(nameof(CanEditOverrides));
        OnPropertyChanged(nameof(CanRecalculate));
    }

    [RelayCommand]
    private async Task RecalculateAsync()
    {
        if (Payment == null || IsPeriodLocked) return;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var allPayments = await _storage.GetPaymentsAsync(companyId);
            var employees = await _storage.GetEmployeesAsync(companyId);
            var emp = employees.FirstOrDefault(e => e.Id == Payment.EmployeeId);
            if (emp == null) return;

            var templates = await _storage.GetShiftTemplatesAsync(companyId);
            var templateMap = templates.ToDictionary(t => t.Id, t => t);
            var punches = await _storage.GetPunchesAsync(companyId, Payment.PeriodStart, Payment.PeriodEnd, emp.Id);
            var leave = await _storage.GetLeaveRequestsAsync(companyId, emp.Id);
            var absences = await _storage.GetDailyAbsencesRangeAsync(companyId, Payment.PeriodStart, Payment.PeriodEnd, emp.Id);
            var salaryHistory = PayrollCalculationHelper.ToSalaryHistoryEntries(
                await _storage.GetEmployeeSalaryHistoryAsync(companyId, emp.Id));

            var settings = _state.CurrentCompany?.CustomSettings ?? new Dictionary<string, object>();
            var policy = PayrollPolicy.FromSettings(settings);
            var (_, _, companyOtMult) = PayrollCalculationHelper.ReadTimingSettings(settings);
            int lateMin = settings.TryGetValue("late_threshold_minutes", out var lv) && int.TryParse(lv?.ToString(), out var li) ? li : 30;
            int otMin   = settings.TryGetValue("ot_start_after_minutes",  out var ov) && int.TryParse(ov?.ToString(), out var oi) ? oi : 30;

            EmployeeShiftTemplate? tmpl = null;
            if (emp.ShiftTemplateId.HasValue)
                templateMap.TryGetValue(emp.ShiftTemplateId.Value, out tmpl);
            var dailyHours = tmpl?.PaidHours ?? emp.DailyHours;

            var sessions = PunchSession.Build(punches, new Dictionary<Guid, Employee> { [emp.Id] = emp }, templateMap, lateMin, otMin)
                .Where(s => !s.IsOpen)
                .Select(PayrollMapper.ToSnapshot)
                .ToList();

            double? manualPaye = double.TryParse(ManualPayeOverrideText, out var mp) ? mp : null;
            double.TryParse(ManualAdjustmentText, out var manualAdj);
            double.TryParse(BonusAmountText, out var bonusAmount);

            Payment.PayFullBaseSalary = PayFullBaseSalary;
            Payment.WaivePenalties = WaivePenalties;
            Payment.ManualPayeOverride = manualPaye;
            Payment.ManualAdjustment = manualAdj;
            Payment.AdjustmentNote = string.IsNullOrWhiteSpace(AdjustmentNote) ? null : AdjustmentNote.Trim();
            Payment.BonusAmount = bonusAmount;
            Payment.BonusNote = string.IsNullOrWhiteSpace(BonusNote) ? null : BonusNote.Trim();

            var overrides = PayrollMapper.ToOverrides(Payment);
            var priorYtd = PayrollCalculationHelper.BuildPriorYtd(
                allPayments, emp.Id, Payment.PeriodEnd, Payment.Id);

            var result = PayrollCalculator.Calculate(PayrollCalculationHelper.BuildInput(
                emp,
                policy,
                Payment.PeriodStart,
                Payment.PeriodEnd,
                sessions,
                leave.Select(PayrollMapper.ToSnapshot).ToList(),
                absences.Select(PayrollMapper.ToSnapshot).ToList(),
                dailyHours,
                companyOtMult,
                overrides,
                priorYtd,
                salaryHistory));

            if (result == null)
            {
                ErrorMessage = "Could not calculate payslip for this employment period.";
                return;
            }

            PayrollMapper.ApplyResult(Payment, result);
            Payment.Version++;
            PayrollAuditHelper.Append(Payment, $"recalculated (v{Payment.Version})", _state.CurrentEmployee?.FullName);
            PayrollEmployeePersistence.ApplyPayslipToEmployee(emp, Payment);
            await _storage.UpdateEmployeeAsync(emp);
            Payment = await _storage.UpdatePaymentAsync(Payment);

            EarningsLines = new ObservableCollection<PayrollLineItem>(Payment.EarningsLines);
            DeductionLines = new ObservableCollection<PayrollLineItem>(Payment.DeductionLines);
            AuditEntries = new ObservableCollection<PayrollAuditEntry>(PayrollAuditHelper.Read(Payment));
            YtdTotals = Payment.YtdTotals;
            OnPropertyChanged(nameof(Payment));
        });
    }

    private static string? FormatPolicySnapshot(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var policy = JsonConvert.DeserializeObject<PayrollPolicy>(json);
            if (policy == null) return null;

            var parts = new List<string>
            {
                $"Default pay basis: {policy.DefaultPayBasis}",
                policy.SalaryIgnoreAttendanceDeductions ? "Salary ignores attendance penalties" : "Salary attendance penalties apply",
                policy.AllowOvertimeForSalary ? "OT allowed for salary" : "OT disabled for salary"
            };

            if (policy.AbsentPenalty.Mode != "none")
                parts.Add($"Absent penalty: {policy.AbsentPenalty.Mode}");
            if (policy.LatePenalty.Mode != "none")
                parts.Add($"Late penalty: {policy.LatePenalty.Mode}");
            if (policy.Statutory.UifEnabled)
                parts.Add($"UIF {policy.Statutory.UifRatePercent}%");
            if (policy.Statutory.PayeEnabled)
                parts.Add(policy.Statutory.UseSarsTaxTables
                    ? "PAYE via SARS tables"
                    : $"PAYE default {policy.Statutory.DefaultPayeRatePercent}%");
            if (policy.PublicHolidays.Count > 0)
                parts.Add($"{policy.PublicHolidays.Count} public holiday(s) configured");

            return string.Join(" · ", parts);
        }
        catch
        {
            return null;
        }
    }

    [RelayCommand]
    private async Task DownloadPdfAsync()
    {
        if (Payment == null) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Payslip PDF");
        if (downloadToDevice == null) return;
        await RunAsync(async () =>
            await _export.ExportPayslipPdfAsync(Payment, EmployeeName, CompanyName, downloadToDevice: downloadToDevice.Value));
    }

    [RelayCommand]
    private async Task SendToEmployeeAsync()
    {
        if (Payment == null) return;
        var confirm = await Shell.Current.DisplayAlert("Send to Employee",
            $"Share this payslip with {EmployeeName}? They will see it in their Payslips section.",
            "Send", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.SharePayslipWithEmployeeAsync(Payment.Id);
            Payment.SharedWithEmployee = true;
            IsSharedWithEmployee = true;
            RefreshActionVisibility();
        });
    }

    [RelayCommand]
    private async Task ApproveAsync()
    {
        if (Payment == null) return;
        var confirm = await Shell.Current.DisplayAlert("Approve Payslip",
            $"Approve {EmployeeName}'s payslip of R{Payment.NetPay:N2} net?", "Approve", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var employees = await _storage.GetEmployeesAsync(companyId);
            var emp = employees.FirstOrDefault(e => e.Id == Payment!.EmployeeId);
            if (emp != null)
            {
                PayrollEmployeePersistence.ApplyPayslipToEmployee(emp, Payment);
                await _storage.UpdateEmployeeAsync(emp);
            }

            await _storage.UpdatePaymentStatusAsync(Payment!.Id, "approved");
            Payment.StatusRaw = "approved";
            OnPropertyChanged(nameof(Payment));
            RefreshActionVisibility();
        });
    }

    [RelayCommand]
    private async Task MarkPaidAsync()
    {
        if (Payment == null) return;
        var confirm = await Shell.Current.DisplayAlert("Mark as Paid",
            "Mark this payslip as paid?", "Mark Paid", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.UpdatePaymentStatusAsync(Payment.Id, "paid");
            Payment.StatusRaw = "paid";
            Payment.PaidAt = DateTime.UtcNow;
            OnPropertyChanged(nameof(Payment));
            RefreshActionVisibility();
        });
    }

    [RelayCommand]
    private async Task RejectAsync()
    {
        if (Payment == null) return;
        var confirm = await Shell.Current.DisplayAlert("Reject Payslip",
            "Reject this payslip?", "Reject", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.UpdatePaymentStatusAsync(Payment.Id, "rejected");
            Payment.StatusRaw = "rejected";
            OnPropertyChanged(nameof(Payment));
            RefreshActionVisibility();
        });
    }
}
