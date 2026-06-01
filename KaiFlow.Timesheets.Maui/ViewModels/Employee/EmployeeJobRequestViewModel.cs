using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.ViewModels.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class EmployeeJobRequestViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string _selectedPriority = "medium";
    [ObservableProperty] private DateTime _scheduledStartDate = DateTime.Today;
    [ObservableProperty] private TimeSpan _scheduledStartTime = new(8, 0, 0);
    [ObservableProperty] private ObservableCollection<ManagerOption> _managerOptions = [];
    [ObservableProperty] private ManagerOption? _selectedManager;
    [ObservableProperty] private ObservableCollection<SelectableEmployee> _coworkerOptions = [];
    [ObservableProperty] private string _coworkerSearch = "";

    public string[] Priorities { get; } = ["none", "low", "medium", "high", "critical"];

    public IEnumerable<SelectableEmployee> FilteredCoworkers =>
        string.IsNullOrWhiteSpace(CoworkerSearch)
            ? CoworkerOptions
            : CoworkerOptions.Where(c =>
                c.Employee.FullName.Contains(CoworkerSearch, StringComparison.OrdinalIgnoreCase)
                || (c.Employee.Position?.Contains(CoworkerSearch, StringComparison.OrdinalIgnoreCase) ?? false));

    public EmployeeJobRequestViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Create Job";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var companyId = employee.CompanyId;

            var employees = await _storage.GetEmployeesAsync(companyId, employee.Id);
            var leadership = employees
                .Where(e => AssignableEmployeeRules.IsAssignableLeadership(e, employee.Id))
                .OrderBy(e => e.FullName)
                .Select(ManagerOption.From)
                .ToList();

            var options = new List<ManagerOption> { ManagerOption.None };
            options.AddRange(leadership);
            ManagerOptions = new ObservableCollection<ManagerOption>(options);

            var lineManager = employee.ManagerUserId.HasValue
                ? leadership.FirstOrDefault(m => m.ManagerUserId == employee.ManagerUserId)
                : null;
            SelectedManager = lineManager ?? ManagerOption.None;

            CoworkerOptions = new ObservableCollection<SelectableEmployee>(
                employees
                    .Where(e => AssignableEmployeeRules.IsAssignableCoworker(e, employee.Id))
                    .OrderBy(e => e.FullName)
                    .Select(e => new SelectableEmployee(e)));
        });
    }

    partial void OnCoworkerSearchChanged(string value) => OnPropertyChanged(nameof(FilteredCoworkers));

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (string.IsNullOrWhiteSpace(Title))
        {
            await Shell.Current.DisplayAlert("Required", "Please enter a job title.", "OK");
            return;
        }

        var employee = _state.CurrentEmployee!;
        await RunAsync(async () =>
        {
            var scheduledStart = ScheduledStartDate.Date + ScheduledStartTime;
            var teamIds = CoworkerOptions
                .Where(c => c.IsSelected)
                .Select(c => c.Employee.Id)
                .ToList();

            var request = new EmployeeCreateJobRequest
            {
                CompanyId = employee.CompanyId,
                CreatorEmployeeId = employee.Id,
                Title = Title.Trim(),
                Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim(),
                PriorityRaw = SelectedPriority,
                ScheduledStart = scheduledStart.ToUniversalTime(),
                ScheduledEnd = scheduledStart.AddHours(8).ToUniversalTime(),
                AssigneeEmployeeId = employee.Id,
                AssignedEmployeeIds = teamIds,
                NotifyManagerEmployeeId = SelectedManager?.EmployeeId,
                VisibilityRaw = SelectedManager?.EmployeeId is not null ? "restricted" : "inherit",
            };

            await _storage.EmployeeCreateJobAsync(request);

            await Shell.Current.DisplayAlert(
                "Job created",
                "Your job was saved and is visible to your team, managers, and HR.",
                "OK");

            await ShellNavigation.GoToAsync("..");
        });
    }
}
