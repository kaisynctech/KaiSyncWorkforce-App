using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Payroll;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrCreateEmployeeViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly IFeatureAccessService _features;

    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string _surname = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _phone = "";
    [ObservableProperty] private string _position = "";
    [ObservableProperty] private string _idNumber = "";
    [ObservableProperty] private string _employmentType = "permanent";
    [ObservableProperty] private string _accessLevel = "employee";
    [ObservableProperty] private string _workerType = "employee";
    [ObservableProperty] private DateTime _employmentDate = DateTime.Today;
    [ObservableProperty] private double _hourlyRate;
    [ObservableProperty] private double _dailyRate;
    [ObservableProperty] private double _monthlySalary;
    [ObservableProperty] private string _payBasis = "";
    [ObservableProperty] private bool _useCustomPayBasis;
    [ObservableProperty] private string _payeRatePercentText = "";
    [ObservableProperty] private bool _uifExempt;
    [ObservableProperty] private double _medicalAidDeduction;
    [ObservableProperty] private double _pensionDeduction;
    [ObservableProperty] private double _unionDeduction;
    [ObservableProperty] private int _workDaysWeekly = 5;
    [ObservableProperty] private double _dailyHours = 8.0;
    [ObservableProperty] private bool _sendInvite = true;
    [ObservableProperty] private ObservableCollection<Branch> _branches = new();
    [ObservableProperty] private Branch? _selectedBranch;
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
        if (value != null)
            DailyHours = value.PaidHours;
    }

    public List<string> EmploymentTypes { get; } = ["permanent", "part-time", "contract", "student"];
    public List<string> AccessLevels { get; } = ["employee", "manager", "admin", "hr_admin", "owner"];
    public List<string> WorkerTypes { get; } = ["employee", "contractor", "subcontractor"];
    public List<string> PayBasisOptions { get; } = ["", "monthly_salary", "hourly", "daily"];

    public bool UsesAutomaticMonthlyPay => MonthlySalary > 0 && !UseCustomPayBasis;
    public string PayBasisDisplay => UsesAutomaticMonthlyPay
        ? "Monthly salary (automatic)"
        : string.IsNullOrWhiteSpace(PayBasis) ? "Auto from employment type" : PayBasis.Replace('_', ' ');

    partial void OnEmploymentTypeChanged(string value) => ApplyPayDefaults();
    partial void OnWorkerTypeChanged(string value) => ApplyPayDefaults();

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
        else if (value)
            ApplyPayDefaults();
        OnPropertyChanged(nameof(UsesAutomaticMonthlyPay));
        OnPropertyChanged(nameof(PayBasisDisplay));
    }

    private void ApplyPayDefaults()
    {
        var defaults = new EmployeePayrollDefaults();
        EmploymentPayrollDefaults.ApplyForEmploymentType(EmploymentType, WorkerType, defaults);
        if (!UseCustomPayBasis)
        {
            if (MonthlySalary > 0)
                PayBasis = KaiFlow.Payroll.PayBasis.MonthlySalary;
            else if (string.IsNullOrWhiteSpace(PayBasis))
                PayBasis = defaults.PayBasis;
        }
        UifExempt = defaults.UifExempt;
    }

    public HrCreateEmployeeViewModel(IStorageService storage, TimesheetStateService state, IFeatureAccessService features)
    {
        _storage = storage;
        _state = state;
        _features = features;
        Title = "New Employee";
    }

    public async Task LoadAsync()
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        await _features.RefreshAsync(companyId);
        if (!Branches.Any())
        {
            var branches = await _storage.GetBranchesAsync(companyId);
            Branches = new ObservableCollection<Branch>(branches);
            var templates = await _storage.GetShiftTemplatesAsync(companyId);
            ShiftTemplates = new ObservableCollection<EmployeeShiftTemplate>(templates);
            ApplyPayDefaults();
        }

        await LoadManagerOptionsAsync(companyId);
    }

    private async Task LoadManagerOptionsAsync(Guid companyId)
    {
        var viewer = _state.CurrentEmployee!;
        var employees = await _storage.GetEmployeesAsync(companyId);
        var managers = employees
            .Where(e => e.IsActive && e.UserId.HasValue
                && e.AccessLevel is Models.AccessLevel.Manager or Models.AccessLevel.Admin
                    or Models.AccessLevel.HrAdmin or Models.AccessLevel.Owner)
            .OrderBy(e => e.FullName)
            .Select(ManagerOption.From)
            .ToList();

        var options = new List<ManagerOption> { ManagerOption.None };
        options.AddRange(managers);
        ManagerOptions = new ObservableCollection<ManagerOption>(options);

        if (SelectedManager == null)
        {
            if (viewer.IsFieldManager && viewer.UserId.HasValue)
                SelectedManager = managers.FirstOrDefault(m => m.ManagerUserId == viewer.UserId)
                    ?? ManagerOption.From(viewer);
            else
                SelectedManager = ManagerOption.None;
        }
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

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(Name) || string.IsNullOrWhiteSpace(Surname))
        {
            ErrorMessage = "Name and surname are required.";
            return;
        }

        RecalcRates();

        if (!_features.CanAddEmployee())
        {
            var sub = _features.CurrentSubscription;
            var limit = sub?.EmployeeLimit.ToString() ?? "your plan limit";
            ErrorMessage = $"Employee limit reached ({sub?.CurrentEmployeeCount}/{limit}). Upgrade your plan to add more.";
            await Shell.Current.DisplayAlert("Plan limit", ErrorMessage, "OK");
            return;
        }

        await RunAsync(async () =>
        {
            var employee = new Employee
            {
                Name = Name.Trim(),
                Surname = Surname.Trim(),
                Email = Email.Trim(),
                Phone = Phone.Trim(),
                Position = string.IsNullOrWhiteSpace(Position) ? null : Position.Trim(),
                Branch = SelectedBranch?.Name,
                IdNumber = string.IsNullOrWhiteSpace(IdNumber) ? null : IdNumber.Trim(),
                EmploymentTypeRaw = EmploymentType,
                WorkerTypeRaw = WorkerType,
                AccessLevelRaw = AccessLevel,
                EmploymentDate = DateOnly.FromDateTime(EmploymentDate),
                HourlyRate = HourlyRate,
                DailyRate = DailyRate,
                MonthlySalary = MonthlySalary,
                PayBasisRaw = MonthlySalary > 0 && !UseCustomPayBasis
                    ? KaiFlow.Payroll.PayBasis.MonthlySalary
                    : string.IsNullOrWhiteSpace(PayBasis) ? null : PayBasis,
                PayeRatePercent = double.TryParse(PayeRatePercentText, out var paye) ? paye : null,
                UifExempt = UifExempt,
                MedicalAidDeduction = MedicalAidDeduction,
                PensionDeduction = PensionDeduction,
                UnionDeduction = UnionDeduction,
                WorkDaysWeekly = WorkDaysWeekly,
                DailyHours = DailyHours,
                ShiftTemplateId = SelectedShiftTemplate?.Id,
                CompanyId = _state.CurrentEmployee!.CompanyId,
                ManagerUserId = ResolveManagerUserId()
            };

            await _storage.CreateEmployeeAsync(employee);
            await _features.RefreshAsync(employee.CompanyId);

            if (SendInvite && !string.IsNullOrWhiteSpace(employee.Email))
                await _storage.SendOtpAsync(employee.Email);

            await ShellNavigation.GoToAsync("..");
        });
    }

    private Guid? ResolveManagerUserId()
    {
        if (SelectedManager?.ManagerUserId is { } selected)
            return selected;

        var viewer = _state.CurrentEmployee!;
        if (viewer.IsFieldManager && viewer.UserId.HasValue)
            return viewer.UserId;

        return null;
    }
}
