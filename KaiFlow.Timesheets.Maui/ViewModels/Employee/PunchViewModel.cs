using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class PunchViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly ILocationService _location;
    private readonly IOfflineQueueService _offlineQueue;
    private readonly TimesheetStateService _state;
    private readonly IBranchGeofenceService _geofence;

    [ObservableProperty] private bool _isClockedIn;
    [ObservableProperty] private string _clockButtonLabel = "Clock In";
    [ObservableProperty] private string _currentAddress = "Getting location...";
    [ObservableProperty] private Job? _selectedJob;
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private double? _currentLatitude;
    [ObservableProperty] private double? _currentLongitude;
    [ObservableProperty] private ObservableCollection<TimePunch> _punchHistory = [];
    [ObservableProperty] private ObservableCollection<Job> _availableJobs = [];
    [ObservableProperty] private string _locationStatus = "";
    [ObservableProperty] private bool _isWithinRadius = true;
    [ObservableProperty] private bool _hasMissedSignOut;
    [ObservableProperty] private bool _isOnLeave;
    [ObservableProperty] private bool _isAbsentToday;
    [ObservableProperty] private TimePunch? _lastPunch;
    [ObservableProperty] private DateTime _filterFrom = DateTime.Today.AddDays(-14);
    [ObservableProperty] private DateTime _filterTo = DateTime.Today;

    private List<TimePunch> _allPunches = [];

    public bool IsOutsideRadius  => !IsWithinRadius && !IsClockedIn;
    public bool ShowLeaveWarning => IsOnLeave && !IsClockedIn;
    public bool CanReportAbsent  => !IsClockedIn && !IsOnLeave && !IsAbsentToday;

    partial void OnIsWithinRadiusChanged(bool value) => OnPropertyChanged(nameof(IsOutsideRadius));
    partial void OnIsOnLeaveChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowLeaveWarning));
        OnPropertyChanged(nameof(CanReportAbsent));
    }
    partial void OnIsAbsentTodayChanged(bool value) => OnPropertyChanged(nameof(CanReportAbsent));
    partial void OnIsClockedInChanged(bool value)
    {
        OnPropertyChanged(nameof(IsOutsideRadius));
        OnPropertyChanged(nameof(ShowLeaveWarning));
        OnPropertyChanged(nameof(CanReportAbsent));
    }

    public PunchViewModel(
        IStorageService storage,
        ILocationService location,
        IOfflineQueueService offlineQueue,
        TimesheetStateService state,
        IBranchGeofenceService geofence)
    {
        _storage = storage;
        _location = location;
        _offlineQueue = offlineQueue;
        _state = state;
        _geofence = geofence;
        Title = "Time Clock";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            LastPunch = await _storage.GetLastPunchAsync(employee.Id);
            IsClockedIn = LastPunch?.PunchType == PunchType.In;
            ClockButtonLabel = IsClockedIn ? "Clock Out" : "Clock In";

            HasMissedSignOut = IsClockedIn && LastPunch != null &&
                DateOnly.FromDateTime(LastPunch.DateTime) < DateOnly.FromDateTime(DateTime.Today);

            var from = DateOnly.FromDateTime(FilterFrom);
            var to = DateOnly.FromDateTime(FilterTo);
            _allPunches = await _storage.GetPunchesAsync(employee.CompanyId, from, to, employee.Id);
            PunchHistory = new ObservableCollection<TimePunch>(_allPunches.OrderByDescending(p => p.DateTime));

            var jobs = await _storage.GetJobsAsync(employee.CompanyId, employee.Id);
            AvailableJobs = new ObservableCollection<Job>(jobs.Where(j => j.IsOpen));

            IsOnLeave = await _storage.IsOnLeaveTodayAsync(employee.CompanyId, employee.Id);

            var today = DateOnly.FromDateTime(DateTime.Today);
            var absences = await _storage.GetDailyAbsencesAsync(employee.CompanyId, today, employee.Id);
            IsAbsentToday = absences.Any();

            await RefreshLocationAsync();
        });
    }

    [RelayCommand]
    private async Task ApplyDateFilterAsync()
    {
        if (FilterFrom > FilterTo) return;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var from = DateOnly.FromDateTime(FilterFrom);
            var to = DateOnly.FromDateTime(FilterTo);
            _allPunches = await _storage.GetPunchesAsync(employee.CompanyId, from, to, employee.Id);
            PunchHistory = new ObservableCollection<TimePunch>(_allPunches.OrderByDescending(p => p.DateTime));
        });
    }

    [RelayCommand]
    private async Task RefreshLocationAsync()
    {
        LocationStatus = "Acquiring GPS...";
        var pos = await _location.GetCurrentPositionAsync(highAccuracy: true);
        if (pos != null)
        {
            CurrentLatitude = pos.Latitude;
            CurrentLongitude = pos.Longitude;
            CurrentAddress = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude) ?? "Unknown location";
            LocationStatus = pos.Accuracy.HasValue ? $"±{pos.Accuracy:F0}m" : "";
        }
        else
        {
            CurrentAddress = "Location unavailable";
            LocationStatus = "GPS unavailable";
        }

        await CheckGeofenceAsync();
    }

    private async Task CheckGeofenceAsync()
    {
        var employee = _state.CurrentEmployee;
        var company = _state.CurrentCompany;
        if (employee == null || company == null)
        {
            IsWithinRadius = true;
            return;
        }

        var status = await _geofence.GetStatusAsync(
            employee, company, CurrentLatitude, CurrentLongitude);
        IsWithinRadius = !status.EnforcementActive || status.IsWithinRadius;
        LocationStatus = status.DisplayMessage;
    }

    [RelayCommand]
    private async Task RecoverMissedSignOutAsync()
    {
        if (LastPunch == null) return;

        var lastDate = LastPunch.DateTime;
        var input = await Shell.Current.DisplayPromptAsync(
            "Missed Sign-Out Recovery",
            $"You signed in on {lastDate:dd MMM yyyy} at {lastDate:HH:mm} and may have forgotten to sign out.\n\nEnter sign-out time (HH:mm):",
            "Record Sign-Out", "Cancel",
            placeholder: $"{lastDate:HH:mm}",
            keyboard: Keyboard.Text);

        if (input == null) return;

        DateTime signOutTime;
        if (TimeSpan.TryParse(input.Trim(), out var ts))
            signOutTime = lastDate.Date + ts;
        else
            signOutTime = lastDate.Date.AddHours(17); // default to 5pm

        if (signOutTime <= lastDate)
            signOutTime = lastDate.AddHours(8);

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var punch = new TimePunch
            {
                Id = Guid.NewGuid(),
                EmployeeId = employee.Id,
                TypeRaw = "out",
                DateTime = signOutTime.ToUniversalTime(),
                Notes = "Missed sign-out recovery",
                CompanyId = employee.CompanyId
            };
            await _storage.InsertPunchAsync(punch);
            IsClockedIn = false;
            ClockButtonLabel = "Clock In";
            HasMissedSignOut = false;
            PunchHistory.Insert(0, punch);
        });
    }

    [RelayCommand]
    private async Task PunchAsync()
    {
        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        if (!IsClockedIn && IsOnLeave)
        {
            await Shell.Current.DisplayAlert(
                "On Leave Today",
                "You are on approved leave today and cannot clock in.",
                "OK");
            return;
        }

        if (!IsClockedIn && IsAbsentToday)
        {
            await Shell.Current.DisplayAlert(
                "Marked Absent",
                "You are marked absent today and cannot clock in.",
                "OK");
            return;
        }

        if (!IsClockedIn && !IsWithinRadius)
        {
            var company = _state.CurrentCompany ?? await _storage.GetCurrentCompanyAsync(employee.CompanyId);
            if (company != null)
            {
                var check = await _geofence.ValidateClockInAsync(
                    employee, company, CurrentLatitude, CurrentLongitude);
                if (!check.IsAllowed)
                {
                    await Shell.Current.DisplayAlert("Cannot Clock In", check.BlockReason!, "OK");
                    return;
                }
            }
        }

        if (!IsClockedIn && SelectedJob == null)
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var todayPunches = _allPunches
                .Where(p => DateOnly.FromDateTime(p.DateTime.ToLocalTime()) == today)
                .ToList();
            var todaySessions = PunchSession.Build(todayPunches);
            if (todaySessions.Any(s => !s.IsOpen && !s.JobId.HasValue))
            {
                var proceed = await Shell.Current.DisplayAlert(
                    "Already Signed In Today",
                    "You have already completed a shift today. Are you sure you want to clock in again?",
                    "Clock In", "Cancel");
                if (!proceed) return;
            }
        }

        await RunAsync(async () =>
        {
            var punch = new TimePunch
            {
                Id = Guid.NewGuid(),
                EmployeeId = employee.Id,
                TypeRaw = IsClockedIn ? "out" : "in",
                DateTime = DateTime.UtcNow,
                Latitude = CurrentLatitude,
                Longitude = CurrentLongitude,
                Address = CurrentAddress,
                JobId = SelectedJob?.Id,
                Notes = Notes,
                CompanyId = employee.CompanyId
            };

            try
            {
                await _storage.InsertPunchAsync(punch);
            }
            catch
            {
                await _offlineQueue.EnqueuePunchAsync(punch);
            }

            _state.SetLastPunch(punch);
            IsClockedIn = !IsClockedIn;
            ClockButtonLabel = IsClockedIn ? "Clock Out" : "Clock In";
            HasMissedSignOut = false;
            Notes = "";
            PunchHistory.Insert(0, punch);

            await Shell.Current.DisplayAlert(
                IsClockedIn ? "Clocked In" : "Clocked Out",
                $"{punch.DateTime.ToLocalTime():HH:mm} — {CurrentAddress}",
                "OK");
        });
    }

    [RelayCommand]
    private async Task ReportAbsentAsync()
    {
        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        var reason = await Shell.Current.DisplayActionSheet(
            "Report Absence", "Cancel", null,
            "Sick", "Personal", "Emergency", "Other");
        if (reason == null || reason == "Cancel") return;

        var note = await Shell.Current.DisplayPromptAsync(
            "Absence Note (optional)",
            "Add a note for your absence:",
            "Save", "Skip", placeholder: "e.g. doctor's appointment");

        await RunAsync(async () =>
        {
            var absence = new DailyAbsence
            {
                Id         = Guid.NewGuid(),
                CompanyId  = employee.CompanyId,
                EmployeeId = employee.Id,
                Date       = DateOnly.FromDateTime(DateTime.Today),
                Reason     = reason.ToLower(),
                Note       = string.IsNullOrWhiteSpace(note) ? null : note
            };
            await _storage.ReportAbsenceAsync(absence);
            IsAbsentToday = true;
        });
    }
}
