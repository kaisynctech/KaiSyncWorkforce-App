using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(EmployeeId), "EmployeeId")]
[QueryProperty(nameof(EmployeeName), "EmployeeName")]
public partial class HrApplyLeaveViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _employeeId = "";
    [ObservableProperty] private string _employeeName = "";
    [ObservableProperty] private string _leaveType = "Annual Leave";
    [ObservableProperty] private DateTime _startDate = DateTime.Today;
    [ObservableProperty] private DateTime _endDate = DateTime.Today;
    [ObservableProperty] private string _reason = "";
    [ObservableProperty] private double _totalDays = 1;

    public List<string> LeaveTypes { get; } = LeavePolicy.TypeKeys.ToList();

    public HrApplyLeaveViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Apply Leave";
    }

    partial void OnStartDateChanged(DateTime value) => RecalcDays();
    partial void OnEndDateChanged(DateTime value) => RecalcDays();

    private void RecalcDays()
    {
        if (EndDate < StartDate)
            EndDate = StartDate;
        var start = DateOnly.FromDateTime(StartDate);
        var end = DateOnly.FromDateTime(EndDate);
        TotalDays = Math.Max(1, (end.DayNumber - start.DayNumber) + 1.0);
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (string.IsNullOrWhiteSpace(EmployeeId))
        {
            ErrorMessage = "Employee not set.";
            return;
        }

        if (string.IsNullOrWhiteSpace(Reason))
        {
            ErrorMessage = "Please enter a reason for the leave.";
            return;
        }

        await RunAsync(async () =>
        {
            var start = DateOnly.FromDateTime(StartDate);
            var end = DateOnly.FromDateTime(EndDate);
            var companyId = _state.CurrentEmployee!.CompanyId;

            var request = new LeaveRequest
            {
                EmployeeId = Guid.Parse(EmployeeId),
                LeaveType = LeaveType,
                StartDate = start,
                EndDate = end,
                TotalDays = TotalDays,
                Reason = Reason,
                StatusRaw = "pending",
                CompanyId = companyId
            };

            await _storage.CreateLeaveRequestAsync(request);
            await ShellNavigation.GoToAsync("..");
        });
    }
}
