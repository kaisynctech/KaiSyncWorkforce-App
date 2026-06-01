using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyShiftsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<CalendarEvent> _shifts = [];
    [ObservableProperty] private DateTime _selectedDate = DateTime.Today;

    public MyShiftsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "My Shifts";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var from = DateOnly.FromDateTime(DateTime.Today.AddDays(-7));
            var to = DateOnly.FromDateTime(DateTime.Today.AddDays(30));
            var events = await _storage.GetCalendarEventsAsync(employee.CompanyId, from, to, employee.Id);
            Shifts = new ObservableCollection<CalendarEvent>(events);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task AcceptShiftAsync(CalendarEvent shift)
        => await RespondAsync(shift, "accepted");

    [RelayCommand]
    private async Task DeclineShiftAsync(CalendarEvent shift)
        => await RespondAsync(shift, "declined");

    private async Task RespondAsync(CalendarEvent shift, string response)
    {
        var employee = _state.CurrentEmployee!;
        await RunAsync(async () =>
        {
            shift.AttendanceResponses[employee.Id.ToString()] = response;
            await _storage.UpdateCalendarEventAttendanceAsync(
                employee.CompanyId, employee.Id, shift.Id, response);
            var idx = Shifts.IndexOf(shift);
            if (idx >= 0) { Shifts.RemoveAt(idx); Shifts.Insert(idx, shift); }
        });
    }
}
