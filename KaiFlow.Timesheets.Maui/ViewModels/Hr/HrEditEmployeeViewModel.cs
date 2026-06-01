using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(EmployeeId), "EmployeeId")]
public partial class HrEditEmployeeViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private Employee? _employee;
    private bool _loadingEmployee;
    private string? _originalBankAccount;
    private string? _originalBankName;
    private string? _originalBankBranchCode;

    [ObservableProperty] private string _employeeId = "";
    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string _surname = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _phone = "";
    [ObservableProperty] private string _position = "";
    [ObservableProperty] private string _branch = "";
    [ObservableProperty] private string _idNumber = "";
    [ObservableProperty] private string _bankAccount = "";
    [ObservableProperty] private string _bankName = "";
    [ObservableProperty] private string _bankBranchCode = "";
    [ObservableProperty] private string _employmentType = "permanent";
    [ObservableProperty] private string _accessLevel = "employee";
    [ObservableProperty] private DateTime _employmentDate = DateTime.Today;
    [ObservableProperty] private double _hourlyRate;
    [ObservableProperty] private double _dailyRate;
    [ObservableProperty] private double _monthlySalary;
    [ObservableProperty] private string _payBasis = "";
    [ObservableProperty] private bool _useCustomPayBasis;
    [ObservableProperty] private bool _payFullMonthlySalary;
    [ObservableProperty] private string _payeRatePercentText = "";
    [ObservableProperty] private string _payeFixedAmountText = "";
    [ObservableProperty] private string _uifRatePercentText = "";
    [ObservableProperty] private string _uifFixedAmountText = "";
    [ObservableProperty] private bool _uifExempt;
    [ObservableProperty] private string _terminationDateText = "";
    [ObservableProperty] private double _medicalAidDeduction;
    [ObservableProperty] private double _pensionDeduction;
    [ObservableProperty] private double _unionDeduction;
    [ObservableProperty] private string _taxNumber = "";
    [ObservableProperty] private string _payeReference = "";
    [ObservableProperty] private string _taxDirectiveNumber = "";
    [ObservableProperty] private string _taxDirectiveRateText = "";
    [ObservableProperty] private string _dateOfBirthText = "";
    [ObservableProperty] private string _costCenter = "";
    [ObservableProperty] private int _workDaysWeekly = 5;
    [ObservableProperty] private double _dailyHours = 8.0;
    [ObservableProperty] private bool _isActive = true;
    [ObservableProperty] private ObservableCollection<EmployeeShiftTemplate> _shiftTemplates = new();
    [ObservableProperty] private EmployeeShiftTemplate? _selectedShiftTemplate;
    [ObservableProperty] private ObservableCollection<ManagerOption> _managerOptions = [];
    [ObservableProperty] private ManagerOption? _selectedManager;

    public string ShiftTemplateSummary => SelectedShiftTemplate?.Summary ?? "";
    public bool HasShiftTemplateSummary => SelectedShiftTemplate != null;

    partial void OnSelectedShiftTemplateChanged(EmployeeShiftTemplate? value)
    {
        OnPropertyChanged(nameof(ShiftTemplateSummary));
        OnPropertyChanged(nameof(HasShiftTemplateSummary));
        if (value != null && !_loadingEmployee)
            DailyHours = value.PaidHours;
    }

    public List<string> EmploymentTypes { get; } = ["permanent", "part-time", "contract", "student"];
    public List<string> AccessLevels { get; } = ["employee", "manager", "admin", "hr_admin", "owner"];
    public List<string> PayBasisOptions { get; } = ["", "monthly_salary", "hourly", "daily"];

    public bool UsesAutomaticMonthlyPay => MonthlySalary > 0 && !UseCustomPayBasis;
    public string PayBasisDisplay => UsesAutomaticMonthlyPay
        ? "Monthly salary (automatic)"
        : string.IsNullOrWhiteSpace(PayBasis) ? "Auto from rates" : PayBasis.Replace('_', ' ');

    partial void OnMonthlySalaryChanged(double value)
    {
        RecalcRates();
        if (value > 0 && !UseCustomPayBasis)
            PayBasis = KaiFlow.Payroll.PayBasis.MonthlySalary;
        OnPropertyChanged(nameof(UsesAutomaticMonthlyPay));
        OnPropertyChanged(nameof(PayBasisDisplay));
    }

    partial void OnUseCustomPayBasisChanged(bool value)
    {
        if (!value && MonthlySalary > 0)
            PayBasis = KaiFlow.Payroll.PayBasis.MonthlySalary;
        OnPropertyChanged(nameof(UsesAutomaticMonthlyPay));
        OnPropertyChanged(nameof(PayBasisDisplay));
    }

    partial void OnPayBasisChanged(string value)
    {
        OnPropertyChanged(nameof(PayBasisDisplay));
    }

    partial void OnWorkDaysWeeklyChanged(int value) => RecalcRates();
    partial void OnDailyHoursChanged(double value) => RecalcRates();

    private void RecalcRates()
    {
        if (MonthlySalary <= 0 || WorkDaysWeekly <= 0 || DailyHours <= 0) return;
        var workDaysPerMonth = WorkDaysWeekly * 52.0 / 12.0;
        DailyRate = Math.Round(MonthlySalary / workDaysPerMonth, 2);
        HourlyRate = Math.Round(DailyRate / DailyHours, 2);
    }

    public HrEditEmployeeViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Edit Employee";
    }

    partial void OnEmployeeIdChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            MainThread.BeginInvokeOnMainThread(() => _ = LoadAsync());
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(EmployeeId, out var empGuid)) return;
        await RunAsync(async () =>
        {
            _employee = await _storage.GetEmployeeAsync(empGuid);
            if (_employee == null) return;

            _loadingEmployee = true;

            Name = _employee.Name;
            Surname = _employee.Surname;
            Email = _employee.Email ?? "";
            Phone = _employee.Phone ?? "";
            Position = _employee.Position ?? "";
            Branch = _employee.Branch ?? "";
            IdNumber = _employee.IdNumber ?? "";
            BankAccount = _employee.BankAccount ?? "";
            BankName = _employee.BankName ?? "";
            BankBranchCode = _employee.BankBranchCode ?? "";
            _originalBankAccount = _employee.BankAccount;
            _originalBankName = _employee.BankName;
            _originalBankBranchCode = _employee.BankBranchCode;
            EmploymentType = _employee.EmploymentTypeRaw;
            AccessLevel = _employee.AccessLevelRaw;
            EmploymentDate = _employee.EmploymentDate.HasValue
                ? _employee.EmploymentDate.Value.ToDateTime(TimeOnly.MinValue)
                : DateTime.Today;
            HourlyRate = _employee.HourlyRate;
            DailyRate = _employee.DailyRate;
            MonthlySalary = _employee.MonthlySalary;
            PayBasis = _employee.PayBasisRaw ?? "";
            UseCustomPayBasis = PayBasis is "hourly" or "daily";
            if (MonthlySalary > 0 && !UseCustomPayBasis)
                PayBasis = KaiFlow.Payroll.PayBasis.MonthlySalary;
            PayeRatePercentText = _employee.PayeRatePercent?.ToString("F1") ?? "";
            PayeFixedAmountText = _employee.PayeFixedAmount > 0 ? _employee.PayeFixedAmount.ToString("F2") : "";
            UifExempt = _employee.UifExempt;
            UifRatePercentText = _employee.UifRatePercent?.ToString("F2") ?? "";
            UifFixedAmountText = _employee.UifFixedAmount > 0 ? _employee.UifFixedAmount.ToString("F2") : "";
            TerminationDateText = _employee.TerminationDate?.ToString("yyyy-MM-dd") ?? "";
            MedicalAidDeduction = _employee.MedicalAidDeduction;
            PensionDeduction = _employee.PensionDeduction;
            UnionDeduction = _employee.UnionDeduction;
            PayFullMonthlySalary = _employee.PayFullMonthlySalary;
            TaxNumber = _employee.TaxNumber ?? "";
            PayeReference = _employee.PayeReference ?? "";
            TaxDirectiveNumber = _employee.TaxDirectiveNumber ?? "";
            TaxDirectiveRateText = _employee.TaxDirectiveRatePercent?.ToString("F1") ?? "";
            DateOfBirthText = _employee.DateOfBirth?.ToString("yyyy-MM-dd") ?? "";
            CostCenter = _employee.CostCenter ?? "";
            WorkDaysWeekly = _employee.WorkDaysWeekly;
            DailyHours = _employee.DailyHours;
            IsActive = _employee.IsActive;
            Title = _employee.FullName;

            var templates = await _storage.GetShiftTemplatesAsync(_employee.CompanyId);
            ShiftTemplates = new ObservableCollection<EmployeeShiftTemplate>(templates);
            SelectedShiftTemplate = templates.FirstOrDefault(t => t.Id == _employee.ShiftTemplateId);

            var allEmployees = await _storage.GetEmployeesAsync(_employee.CompanyId);
            var managers = allEmployees
                .Where(e => e.IsActive && e.UserId.HasValue
                    && e.AccessLevel is Models.AccessLevel.Manager or Models.AccessLevel.Admin
                        or Models.AccessLevel.HrAdmin or Models.AccessLevel.Owner)
                .OrderBy(e => e.FullName)
                .Select(ManagerOption.From)
                .ToList();
            var options = new List<ManagerOption> { ManagerOption.None };
            options.AddRange(managers);
            ManagerOptions = new ObservableCollection<ManagerOption>(options);
            SelectedManager = _employee.ManagerUserId.HasValue
                ? managers.FirstOrDefault(m => m.ManagerUserId == _employee.ManagerUserId)
                  ?? ManagerOption.None
                : ManagerOption.None;

            _loadingEmployee = false;
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (_employee == null) return;

        await RunAsync(async () =>
        {
            _employee.Name = Name.Trim();
            _employee.Surname = Surname.Trim();
            _employee.Email = Email.Trim();
            _employee.Phone = Phone.Trim();
            _employee.Position = string.IsNullOrWhiteSpace(Position) ? null : Position.Trim();
            _employee.Branch = string.IsNullOrWhiteSpace(Branch) ? null : Branch.Trim();
            _employee.IdNumber = string.IsNullOrWhiteSpace(IdNumber) ? null : IdNumber.Trim();
            _employee.BankAccount = string.IsNullOrWhiteSpace(BankAccount) ? null : BankAccount.Trim();
            _employee.BankName = string.IsNullOrWhiteSpace(BankName) ? null : BankName.Trim();
            _employee.BankBranchCode = string.IsNullOrWhiteSpace(BankBranchCode) ? null : BankBranchCode.Trim();

            var bankChanged =
                !string.Equals(_employee.BankAccount, _originalBankAccount, StringComparison.Ordinal)
                || !string.Equals(_employee.BankName, _originalBankName, StringComparison.Ordinal)
                || !string.Equals(_employee.BankBranchCode, _originalBankBranchCode, StringComparison.Ordinal);
            if (bankChanged)
            {
                _employee.BankDetailsUpdatedAt = DateTime.UtcNow;
                _employee.BankDetailsUpdatedBy = "hr";
            }

            _employee.EmploymentTypeRaw = EmploymentType;
            _employee.AccessLevelRaw = AccessLevel;
            _employee.EmploymentDate = DateOnly.FromDateTime(EmploymentDate);

            var salaryChanged = Math.Abs(_employee.MonthlySalary - MonthlySalary) > 0.01
                || Math.Abs(_employee.HourlyRate - HourlyRate) > 0.01
                || Math.Abs(_employee.DailyRate - DailyRate) > 0.01;

            _employee.HourlyRate = HourlyRate;
            _employee.DailyRate = DailyRate;
            _employee.MonthlySalary = MonthlySalary;
            if (MonthlySalary > 0 && !UseCustomPayBasis)
                _employee.PayBasisRaw = KaiFlow.Payroll.PayBasis.MonthlySalary;
            else
                _employee.PayBasisRaw = string.IsNullOrWhiteSpace(PayBasis) ? null : PayBasis;
            _employee.PayeRatePercent = double.TryParse(PayeRatePercentText, out var paye) ? paye : null;
            _employee.PayeFixedAmount = double.TryParse(PayeFixedAmountText, out var payeFixed) ? payeFixed : 0;
            _employee.UifExempt = UifExempt;
            _employee.UifRatePercent = double.TryParse(UifRatePercentText, out var uifRate) ? uifRate : null;
            _employee.UifFixedAmount = double.TryParse(UifFixedAmountText, out var uifFixed) ? uifFixed : 0;
            _employee.TerminationDate = DateOnly.TryParse(TerminationDateText, out var term)
                ? term
                : null;
            _employee.MedicalAidDeduction = MedicalAidDeduction;
            _employee.PensionDeduction = PensionDeduction;
            _employee.UnionDeduction = UnionDeduction;
            _employee.PayFullMonthlySalary = PayFullMonthlySalary;
            _employee.TaxNumber = string.IsNullOrWhiteSpace(TaxNumber) ? null : TaxNumber.Trim();
            _employee.PayeReference = string.IsNullOrWhiteSpace(PayeReference) ? null : PayeReference.Trim();
            _employee.TaxDirectiveNumber = string.IsNullOrWhiteSpace(TaxDirectiveNumber) ? null : TaxDirectiveNumber.Trim();
            _employee.TaxDirectiveRatePercent = double.TryParse(TaxDirectiveRateText, out var tdr) ? tdr : null;
            _employee.DateOfBirth = DateOnly.TryParse(DateOfBirthText, out var dob) ? dob : null;
            _employee.CostCenter = string.IsNullOrWhiteSpace(CostCenter) ? null : CostCenter.Trim();
            _employee.WorkDaysWeekly = WorkDaysWeekly;
            _employee.DailyHours = DailyHours;
            _employee.IsActive = IsActive;
            _employee.ShiftTemplateId = SelectedShiftTemplate?.Id;
            _employee.ManagerUserId = SelectedManager?.ManagerUserId;

            await _storage.UpdateEmployeeAsync(_employee);

            if (salaryChanged && MonthlySalary > 0)
            {
                await _storage.AddEmployeeSalaryHistoryAsync(new EmployeeSalaryHistory
                {
                    EmployeeId = _employee.Id,
                    CompanyId = _employee.CompanyId,
                    EffectiveDate = DateOnly.FromDateTime(DateTime.Today),
                    MonthlySalary = MonthlySalary,
                    HourlyRate = HourlyRate,
                    DailyRate = DailyRate,
                    Note = "Updated via HR edit employee"
                });
            }

            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task ArchiveAsync()
    {
        if (_employee == null) return;
        var confirm = await Shell.Current.DisplayAlert(
            "Archive Employee",
            $"Mark {_employee.FullName} as inactive? They will no longer be able to sign in.",
            "Archive", "Cancel");
        if (!confirm) return;
        await RunAsync(async () =>
        {
            _employee.IsActive = false;
            IsActive = false;
            await _storage.UpdateEmployeeAsync(_employee);
            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task SendInviteAsync()
    {
        if (_employee == null) return;
        if (string.IsNullOrWhiteSpace(_employee.Email))
        {
            ErrorMessage = "No email address on file for this employee.";
            return;
        }
        await RunAsync(async () =>
        {
            await _storage.SendOtpAsync(_employee.Email!);
            await Shell.Current.DisplayAlert("Invite Sent", $"Login link sent to {_employee.Email}.", "OK");
        });
    }
}
