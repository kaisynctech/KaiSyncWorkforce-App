using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrPayrollSettingsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private Company? _company;

    // Pay calculation & time inputs
    [ObservableProperty] private double _defaultHourlyRate;
    [ObservableProperty] private double _overtimeMultiplier = 1.5;
    [ObservableProperty] private int _overtimeThresholdHours = 8;
    [ObservableProperty] private int _lateThresholdMinutes = 30;
    [ObservableProperty] private int _otStartAfterMinutes = 30;
    [ObservableProperty] private bool _deductAbsentFromPay;
    [ObservableProperty] private string _payrollDefaultPayBasis = "monthly_salary";
    [ObservableProperty] private bool _salaryIgnoreAttendanceDeductions = true;
    [ObservableProperty] private bool _allowOvertimeForSalary = true;
    [ObservableProperty] private bool _paySalaryOnPublicHolidays = true;
    [ObservableProperty] private bool _payHourlyOnPublicHolidays;
    [ObservableProperty] private bool _payFullSalaryForMidMonthJoiners;

    // Penalties
    [ObservableProperty] private string _absentPenaltyMode = "none";
    [ObservableProperty] private int _absentPenaltyThreshold = 5;
    [ObservableProperty] private double _absentPenaltyDeductDays = 1;
    [ObservableProperty] private string _latePenaltyMode = "none";
    [ObservableProperty] private int _latePenaltyThreshold = 3;
    [ObservableProperty] private double _latePenaltyDeductHours = 2;
    [ObservableProperty] private string _earlyPenaltyMode = "none";
    [ObservableProperty] private int _earlyPenaltyThreshold = 3;
    [ObservableProperty] private double _earlyPenaltyDeductHours = 2;

    // Statutory & tax
    [ObservableProperty] private bool _uifEnabled = true;
    [ObservableProperty] private double _uifRatePercent = 1.0;
    [ObservableProperty] private double _uifCeilingMonthly = 17712;
    [ObservableProperty] private bool _payeEnabled = true;
    [ObservableProperty] private double _defaultPayeRatePercent = 25;
    [ObservableProperty] private bool _useSarsTaxTables;

    // Payslip release
    [ObservableProperty] private int _payslipReleaseDay;
    [ObservableProperty] private bool _autoReleasePayslipsOnReleaseDay;
    [ObservableProperty] private string _publicHolidaysText = "";

    public List<string> PayBasisOptions { get; } = ["monthly_salary", "hourly", "daily"];
    public List<string> PenaltyModeOptions { get; } = ["none", "per_day", "per_occurrence", "threshold"];

    public HrPayrollSettingsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Payroll Settings";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            Company = await _storage.GetCurrentCompanyAsync(companyId) ?? _state.CurrentCompany;
            if (Company == null) return;

            var s = Company.CustomSettings;
            if (s.TryGetValue("default_hourly_rate", out var dhr) && double.TryParse(dhr?.ToString(), out var dhrDbl))
                DefaultHourlyRate = dhrDbl;
            if (s.TryGetValue("overtime_multiplier", out var otm) && double.TryParse(otm?.ToString(), out var otmDbl))
                OvertimeMultiplier = otmDbl;
            if (s.TryGetValue("overtime_threshold_hours", out var oth) && int.TryParse(oth?.ToString(), out var othInt))
                OvertimeThresholdHours = othInt;
            if (s.TryGetValue("late_threshold_minutes", out var ltm) && int.TryParse(ltm?.ToString(), out var ltmInt))
                LateThresholdMinutes = ltmInt;
            if (s.TryGetValue("ot_start_after_minutes", out var otm2) && int.TryParse(otm2?.ToString(), out var otm2Int))
                OtStartAfterMinutes = otm2Int;
            if (s.TryGetValue("deduct_absent_from_pay", out var daf) && bool.TryParse(daf?.ToString(), out var dafBool))
                DeductAbsentFromPay = dafBool;

            var payroll = PayrollPolicy.FromSettings(s);
            PayrollDefaultPayBasis = payroll.DefaultPayBasis;
            SalaryIgnoreAttendanceDeductions = payroll.SalaryIgnoreAttendanceDeductions;
            AbsentPenaltyMode = payroll.AbsentPenalty.Mode;
            AbsentPenaltyThreshold = payroll.AbsentPenalty.ThresholdCount;
            AbsentPenaltyDeductDays = payroll.AbsentPenalty.DeductDays;
            LatePenaltyMode = payroll.LatePenalty.Mode;
            LatePenaltyThreshold = payroll.LatePenalty.ThresholdCount;
            LatePenaltyDeductHours = payroll.LatePenalty.DeductHours;
            EarlyPenaltyMode = payroll.EarlyPenalty.Mode;
            EarlyPenaltyThreshold = payroll.EarlyPenalty.ThresholdCount;
            EarlyPenaltyDeductHours = payroll.EarlyPenalty.DeductHours;
            UifEnabled = payroll.Statutory.UifEnabled;
            UifRatePercent = payroll.Statutory.UifRatePercent;
            UifCeilingMonthly = payroll.Statutory.UifCeilingMonthly;
            PayeEnabled = payroll.Statutory.PayeEnabled;
            DefaultPayeRatePercent = payroll.Statutory.DefaultPayeRatePercent;
            UseSarsTaxTables = payroll.Statutory.UseSarsTaxTables;
            AllowOvertimeForSalary = payroll.AllowOvertimeForSalary;
            PaySalaryOnPublicHolidays = payroll.PaySalaryOnPublicHolidays;
            PayHourlyOnPublicHolidays = payroll.PayHourlyOnPublicHolidays;
            PayFullSalaryForMidMonthJoiners = payroll.PayFullSalaryForMidMonthJoiners;
            PayslipReleaseDay = payroll.PayslipReleaseDay;
            AutoReleasePayslipsOnReleaseDay = payroll.AutoReleasePayslipsOnReleaseDay;
            PublicHolidaysText = string.Join(", ", payroll.PublicHolidays.Select(d => d.ToString("yyyy-MM-dd")));
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (Company == null) return;
        await RunAsync(async () =>
        {
            Company.CustomSettings["default_hourly_rate"] = DefaultHourlyRate;
            Company.CustomSettings["overtime_multiplier"] = OvertimeMultiplier;
            Company.CustomSettings["overtime_threshold_hours"] = OvertimeThresholdHours;
            Company.CustomSettings["late_threshold_minutes"] = LateThresholdMinutes;
            Company.CustomSettings["ot_start_after_minutes"] = OtStartAfterMinutes;
            Company.CustomSettings["deduct_absent_from_pay"] = DeductAbsentFromPay;

            var payroll = new PayrollPolicy
            {
                DefaultPayBasis = PayrollDefaultPayBasis,
                SalaryIgnoreAttendanceDeductions = SalaryIgnoreAttendanceDeductions,
                AbsentPenalty = new PenaltyPolicy
                {
                    Mode = AbsentPenaltyMode,
                    ThresholdCount = AbsentPenaltyThreshold,
                    DeductDays = AbsentPenaltyDeductDays,
                    ApplyTo = "all"
                },
                LatePenalty = new PenaltyPolicy
                {
                    Mode = LatePenaltyMode,
                    ThresholdCount = LatePenaltyThreshold,
                    DeductHours = LatePenaltyDeductHours,
                    ApplyTo = "all"
                },
                EarlyPenalty = new PenaltyPolicy
                {
                    Mode = EarlyPenaltyMode,
                    ThresholdCount = EarlyPenaltyThreshold,
                    DeductHours = EarlyPenaltyDeductHours,
                    ApplyTo = "all"
                },
                Statutory = new StatutoryPolicy
                {
                    UifEnabled = UifEnabled,
                    UifRatePercent = UifRatePercent,
                    UifCeilingMonthly = UifCeilingMonthly,
                    PayeEnabled = PayeEnabled,
                    DefaultPayeRatePercent = DefaultPayeRatePercent,
                    UseSarsTaxTables = UseSarsTaxTables
                },
                AllowOvertimeForSalary = AllowOvertimeForSalary,
                PaySalaryOnPublicHolidays = PaySalaryOnPublicHolidays,
                PayHourlyOnPublicHolidays = PayHourlyOnPublicHolidays,
                PayFullSalaryForMidMonthJoiners = PayFullSalaryForMidMonthJoiners,
                PayslipReleaseDay = Math.Clamp(PayslipReleaseDay, 0, 28),
                AutoReleasePayslipsOnReleaseDay = AutoReleasePayslipsOnReleaseDay,
                PublicHolidays = PublicHolidaysText
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(s => DateOnly.TryParse(s, out var d) ? d : (DateOnly?)null)
                    .Where(d => d.HasValue)
                    .Select(d => d!.Value)
                    .ToList()
            };
            payroll.WriteTo(Company.CustomSettings);

            var updated = await _storage.UpdateCompanyAsync(Company);
            _state.SetCompany(updated);
            Company = updated;
            await Shell.Current.DisplayAlert("Saved", "Payroll settings saved.", "OK");
        });
    }

    [RelayCommand]
    private async Task GoToShiftTemplatesAsync()
        => await ShellNavigation.GoToAsync(nameof(HrShiftTemplatesPage));
}
