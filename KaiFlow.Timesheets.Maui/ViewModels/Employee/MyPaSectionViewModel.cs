using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

[QueryProperty(nameof(HrMode), "HrMode")]
public partial class MyPaSectionViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly IMyPaCalendarConnectService _calendarConnect;
    private List<PaTask> _allTasks = [];
    private List<MyPaCalendarEntry> _allEntries = [];

    [ObservableProperty] private string _hrMode = "false";
    [ObservableProperty] private ObservableCollection<PaTask> _tasks = [];
    [ObservableProperty] private ObservableCollection<MyPaCalendarEntry> _calendarEntries = [];
    [ObservableProperty] private ObservableCollection<MyPaCalendarEntry> _selectedDayEntries = [];
    [ObservableProperty] private ObservableCollection<MyPaMonthDay> _monthDays = [];
    [ObservableProperty] private ObservableCollection<MyPaMonthDay> _weekDays = [];
    [ObservableProperty] private ObservableCollection<PaTask> _upcomingReminders = [];
    [ObservableProperty] private ObservableCollection<MyPaBriefingItem> _briefingItems = [];
    [ObservableProperty] private ObservableCollection<MyPaSearchResult> _searchResults = [];
    [ObservableProperty] private ObservableCollection<MyPaTimelineSlot> _timelineSlots = [];
    [ObservableProperty] private ObservableCollection<MyPaManagerDigestLine> _managerDigest = [];
    [ObservableProperty] private ObservableCollection<EmployeeCalendarConnection> _calendarConnections = [];
    [ObservableProperty] private string _filterStatus = "all";
    [ObservableProperty] private string _activeTab = "today";
    [ObservableProperty] private string _calendarLayout = "month";
    [ObservableProperty] private string _searchQuery = "";
    [ObservableProperty] private int _openCount;
    [ObservableProperty] private int _overdueCount;
    [ObservableProperty] private int _dueTodayCount;
    [ObservableProperty] private int _meetingsTodayCount;
    [ObservableProperty] private int _completedTodayCount;
    [ObservableProperty] private ObservableCollection<MyPaCalendarEntry> _todayAgenda = [];
    [ObservableProperty] private bool _hasTodayAgenda;
    [ObservableProperty] private DateTime _calendarMonth = new(DateTime.Today.Year, DateTime.Today.Month, 1);
    [ObservableProperty] private DateTime _selectedDay = DateTime.Today;
    [ObservableProperty] private string? _syncMessage;
    [ObservableProperty] private bool _hasUpcomingReminders;
    [ObservableProperty] private bool _focusModeEnabled;
    [ObservableProperty] private bool _briefingEnabled = true;
    [ObservableProperty] private bool _hasSearchResults;
    [ObservableProperty] private bool _hasBriefingItems;
    [ObservableProperty] private string _googleConnectStatus = "Not connected";
    [ObservableProperty] private string _outlookConnectStatus = "Not connected";
    [ObservableProperty] private string _briefingDateLabel = DateTime.Today.ToString("dddd, d MMMM");

    public bool IsHrWorkspace => string.Equals(HrMode, "true", StringComparison.OrdinalIgnoreCase);
    public bool ShowToday => ActiveTab == "today";
    public bool ShowTasks => ActiveTab == "tasks";
    public bool ShowCalendar => ActiveTab == "calendar";
    public bool ShowSearch => ActiveTab == "search";
    public bool IsMonthLayout => CalendarLayout == "month";
    public bool IsWeekLayout => CalendarLayout == "week";
    public bool ShowManagerDigest => IsHrWorkspace && ManagerDigest.Count > 0;
    public string Subtitle => IsHrWorkspace
        ? "Operational planning and executive coordination for the company."
        : "Operational planning and executive coordination.";

    public string FocusModeSummary => FocusModeEnabled
        ? "On — showing only overdue, due-today and high-priority work."
        : "Hide low-priority tasks and surface only what needs action today.";

    public string TodayHeading => DateTime.Today.ToString("dddd, d MMMM");

    public IReadOnlyList<string> Filters { get; } = ["all", "todo", "in_progress", "overdue", "done"];

    partial void OnActiveTabChanged(string value)
    {
        OnPropertyChanged(nameof(ShowToday));
        OnPropertyChanged(nameof(ShowTasks));
        OnPropertyChanged(nameof(ShowCalendar));
        OnPropertyChanged(nameof(ShowSearch));
    }

    partial void OnHrModeChanged(string value)
    {
        Title = IsHrWorkspace ? "My PA workspace" : "My PA";
        OnPropertyChanged(nameof(IsHrWorkspace));
        OnPropertyChanged(nameof(Subtitle));
        OnPropertyChanged(nameof(ShowManagerDigest));
        _ = LoadAsync();
    }

    partial void OnSelectedDayChanged(DateTime value) => RefreshCalendarUi();
    partial void OnSearchQueryChanged(string value) => RunSearch();

    partial void OnFocusModeEnabledChanged(bool value)
    {
        ApplyTaskFilter();
        OnPropertyChanged(nameof(FocusModeSummary));
    }

    partial void OnCalendarMonthChanged(DateTime value)
    {
        RefreshCalendarUi();
        OnPropertyChanged(nameof(CalendarPeriodLabel));
    }

    partial void OnCalendarLayoutChanged(string value)
    {
        OnPropertyChanged(nameof(IsMonthLayout));
        OnPropertyChanged(nameof(IsWeekLayout));
        RefreshCalendarUi();
        OnPropertyChanged(nameof(CalendarPeriodLabel));
    }

    partial void OnCalendarEntriesChanged(ObservableCollection<MyPaCalendarEntry> value)
        => RefreshCalendarUi();

    public MyPaSectionViewModel(
        IStorageService storage,
        TimesheetStateService state,
        IMyPaCalendarConnectService calendarConnect)
    {
        _storage = storage;
        _state = state;
        _calendarConnect = calendarConnect;
        Title = "My PA";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee;
            if (employee == null)
            {
                ErrorMessage = "Sign in and select a company to use My PA.";
                return;
            }
            var companyId = employee.CompanyId;
            var ownerId = IsHrWorkspace ? (Guid?)null : employee.Id;

            var settings = await _storage.GetEmployeePaSettingsAsync(employee.Id, companyId);
            BriefingEnabled = settings.BriefingEnabled;
            FocusModeEnabled = settings.FocusModeEnabled;

            if (!IsHrWorkspace)
                await _storage.EnqueuePaTaskNotificationsAsync(companyId);

            var synced = await _storage.SyncOperationalPaTasksAsync(companyId, ownerId);
            if (synced > 0)
                SyncMessage = $"{synced} new item(s) added from jobs & projects.";

            var all = await _storage.GetPaTasksAsync(companyId, ownerId);
            _allTasks = all;
            var (open, overdue, dueToday) = MyPaHelper.Metrics(all);
            OpenCount = open;
            OverdueCount = overdue;
            DueTodayCount = dueToday;

            var today = DateTime.Today;
            CompletedTodayCount = all.Count(t => t.IsDone
                && ((t.CompletedAt?.Date ?? t.UpdatedAt.Date) == today));

            _allEntries = await _storage.GetMyPaCalendarEntriesMergedAsync(companyId, ownerId);
            CalendarEntries = new ObservableCollection<MyPaCalendarEntry>(_allEntries);

            MeetingsTodayCount = _allEntries.Count(e => e.Start.Date == today && e.Kind == "meeting");
            var agenda = MyPaHelper.EntriesForDayIncludingReminders(_allEntries, _allTasks, today);
            TodayAgenda = new ObservableCollection<MyPaCalendarEntry>(agenda);
            HasTodayAgenda = agenda.Count > 0;

            CalendarConnections = new ObservableCollection<EmployeeCalendarConnection>(
                await _storage.GetCalendarConnectionsAsync(employee.Id));
            UpdateConnectLabels();

            if (IsHrWorkspace)
            {
                var companyTasks = await _storage.GetPaTasksAsync(companyId, null);
                ManagerDigest = new ObservableCollection<MyPaManagerDigestLine>(
                    MyPaHelper.BuildManagerDigest(companyTasks));
            }
            else
                ManagerDigest = [];
            OnPropertyChanged(nameof(ShowManagerDigest));

            ApplyTaskFilter();
            RefreshBriefing();
            RefreshCalendarUi();
            RunSearch();
        });
    }

    private void ApplyTaskFilter()
    {
        var filtered = FocusModeEnabled
            ? MyPaHelper.FilterFocus(_allTasks)
            : MyPaHelper.FilterTasks(_allTasks, FilterStatus);
        Tasks = new ObservableCollection<PaTask>(filtered);
    }

    private void RefreshBriefing()
    {
        if (!BriefingEnabled)
        {
            BriefingItems = [];
            HasBriefingItems = false;
            return;
        }
        var items = MyPaHelper.BuildBriefing(_allTasks, _allEntries, DateTime.Today);
        BriefingItems = new ObservableCollection<MyPaBriefingItem>(items);
        HasBriefingItems = items.Count > 0;
        BriefingDateLabel = DateTime.Today.ToString("dddd, d MMMM");
    }

    private void RefreshCalendarUi()
    {
        MonthDays = new ObservableCollection<MyPaMonthDay>(
            MyPaHelper.BuildMonthGrid(CalendarMonth, SelectedDay, CalendarEntries, _allTasks));
        WeekDays = new ObservableCollection<MyPaMonthDay>(
            MyPaHelper.BuildWeekDays(SelectedDay, SelectedDay, CalendarEntries, _allTasks));
        SelectedDayEntries = new ObservableCollection<MyPaCalendarEntry>(
            MyPaHelper.EntriesForDayIncludingReminders(CalendarEntries, _allTasks, SelectedDay));
        TimelineSlots = new ObservableCollection<MyPaTimelineSlot>(
            MyPaHelper.BuildTimeline(SelectedDayEntries));
        UpcomingReminders = new ObservableCollection<PaTask>(MyPaHelper.UpcomingReminders(_allTasks));
        HasUpcomingReminders = UpcomingReminders.Count > 0;
    }

    private void RunSearch()
    {
        var results = MyPaHelper.Search(SearchQuery, _allTasks, _allEntries);
        SearchResults = new ObservableCollection<MyPaSearchResult>(results);
        HasSearchResults = results.Count > 0;
    }

    private void UpdateConnectLabels()
    {
        var g = CalendarConnections.FirstOrDefault(c => c.Provider == "google");
        var o = CalendarConnections.FirstOrDefault(c => c.Provider == "outlook");
        GoogleConnectStatus = g?.IsConnected == true
            ? $"Connected ? {g.CalendarLabel ?? "Google"}"
            : _calendarConnect.IsGoogleConfigured ? "Ready to connect" : "Set up OAuth client ID";
        OutlookConnectStatus = o?.IsConnected == true
            ? $"Connected ? {o.CalendarLabel ?? "Outlook"}"
            : _calendarConnect.IsOutlookConfigured ? "Ready to connect" : "Set up OAuth client ID";
    }

    private async Task SaveSettingsAsync()
    {
        var employee = _state.CurrentEmployee!;
        await _storage.SaveEmployeePaSettingsAsync(new EmployeePaSettings
        {
            EmployeeId = employee.Id,
            CompanyId = employee.CompanyId,
            BriefingEnabled = BriefingEnabled,
            FocusModeEnabled = FocusModeEnabled,
            ManagerDigestEnabled = true
        });
    }

    [RelayCommand]
    private async Task ToggleFocusModeAsync()
    {
        FocusModeEnabled = !FocusModeEnabled;
        ApplyTaskFilter();
        await SaveSettingsAsync();
    }

    [RelayCommand]
    private async Task ToggleBriefingAsync()
    {
        BriefingEnabled = !BriefingEnabled;
        RefreshBriefing();
        await SaveSettingsAsync();
    }

    [RelayCommand]
    private void SetCalendarLayout(string layout)
    {
        if (layout is "month" or "week") CalendarLayout = layout;
    }

    [RelayCommand]
    private async Task ConnectGoogleAsync()
    {
        var e = _state.CurrentEmployee;
        if (e == null) return;
        await _calendarConnect.ConnectGoogleAsync(e.Id, e.CompanyId);
        CalendarConnections = new ObservableCollection<EmployeeCalendarConnection>(
            await _storage.GetCalendarConnectionsAsync(e.Id));
        UpdateConnectLabels();
    }

    [RelayCommand]
    private async Task ConnectOutlookAsync()
    {
        var e = _state.CurrentEmployee;
        if (e == null) return;
        await _calendarConnect.ConnectOutlookAsync(e.Id, e.CompanyId);
        CalendarConnections = new ObservableCollection<EmployeeCalendarConnection>(
            await _storage.GetCalendarConnectionsAsync(e.Id));
        UpdateConnectLabels();
    }

    [RelayCommand]
    private async Task QuickAddAsync()
    {
        var title = await Shell.Current.DisplayPromptAsync("Quick add", "What do you need to do?", "Add", "Cancel");
        if (string.IsNullOrWhiteSpace(title)) return;
        var employee = _state.CurrentEmployee!;
        await RunAsync(async () =>
        {
            await _storage.EmployeeCreatePaTaskAsync(new PaTask
            {
                CompanyId = employee.CompanyId,
                Title = title.Trim(),
                QuickCapture = title.Trim(),
                DueAt = DateTime.Today.AddHours(DateTime.Now.Hour + 1),
                DueDate = DateOnly.FromDateTime(DateTime.Today),
                SourceType = "manual",
                PriorityRaw = "medium"
            }, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task QuickNoteVoiceAsync()
    {
        var text = await Shell.Current.DisplayPromptAsync(
            "Quick note",
            "Capture a thought (voice input when device supports it):",
            "Save",
            "Cancel");
        if (string.IsNullOrWhiteSpace(text)) return;

        var employee = _state.CurrentEmployee!;
        await RunAsync(async () =>
        {
            await _storage.EmployeeCreatePaTaskAsync(new PaTask
            {
                CompanyId = employee.CompanyId,
                Title = text.Length > 80 ? text[..80] + "?" : text,
                Notes = text,
                QuickCapture = text,
                DueAt = DateTime.Today.AddDays(1).AddHours(9),
                DueDate = DateOnly.FromDateTime(DateTime.Today.AddDays(1)),
                SourceType = "manual"
            }, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ApplyTemplateAsync()
    {
        if (!IsHrWorkspace) return;
        var templates = await _storage.GetPaTaskTemplatesAsync(_state.CurrentEmployee!.CompanyId);
        if (templates.Count == 0)
        {
            await Shell.Current.DisplayAlert("Templates", "No HR templates found for this company.", "OK");
            return;
        }
        var pick = await Shell.Current.DisplayActionSheet(
            "Apply template", "Cancel", null, templates.Select(t => t.Title).ToArray());
        var template = templates.FirstOrDefault(t => t.Title == pick);
        if (template == null) return;
        var employee = _state.CurrentEmployee!;
        var draft = MyPaHelper.DraftFromTemplate(template, employee.CompanyId, employee.Id);
        await RunAsync(async () =>
        {
            await _storage.EmployeeCreatePaTaskAsync(draft, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task NewTaskAsync()
        => await ShellNavigation.GoToAsync($"{nameof(Views.Employee.MyPaTaskEditorPage)}?HrMode={HrMode}");

    [RelayCommand]
    private async Task PlanDayAsync()
        => await ShellNavigation.GoToAsync(
            $"{nameof(Views.Employee.MyPaTaskEditorPage)}?HrMode={HrMode}&PresetDay={SelectedDay:yyyy-MM-dd}");

    [RelayCommand]
    private async Task EditTaskAsync(PaTask? task)
    {
        if (task == null) return;
        await ShellNavigation.GoToAsync(
            $"{nameof(Views.Employee.MyPaTaskEditorPage)}?TaskId={task.Id}&HrMode={HrMode}");
    }

    [RelayCommand]
    private async Task OpenBriefingItemAsync(MyPaBriefingItem? item)
    {
        if (item?.Task != null) await EditTaskAsync(item.Task);
        else if (item?.Entry != null) await OpenCalendarEntryAsync(item.Entry);
    }

    [RelayCommand]
    private async Task OpenSearchResultAsync(MyPaSearchResult? result)
    {
        if (result?.Task != null) await EditTaskAsync(result.Task);
        else if (result?.Entry != null) await OpenCalendarEntryAsync(result.Entry);
    }

    [RelayCommand]
    private async Task OpenLinkedAsync(PaTask? task)
    {
        if (task == null) return;
        if (task.LinkedTypeRaw == "job" && Guid.TryParse(task.LinkedId, out var jobId))
            await ShellNavigation.GoToAsync(nameof(Views.Employee.JobCardPage),
                new Dictionary<string, object> { ["JobId"] = jobId.ToString() });
        else if (task.LinkedTypeRaw == "deal" && Guid.TryParse(task.LinkedId, out var dealId))
            await ShellNavigation.GoToAsync(nameof(Views.Hr.HrProjectDetailPage),
                new Dictionary<string, object> { ["DealId"] = dealId.ToString() });
    }

    [RelayCommand]
    private async Task RescheduleEntryAsync(MyPaCalendarEntry? entry)
    {
        if (entry?.Task == null || !entry.CanReschedule) return;
        var dateStr = await Shell.Current.DisplayPromptAsync("Move to date", "YYYY-MM-DD:", "OK", "Cancel",
            initialValue: entry.Start.ToString("yyyy-MM-dd"));
        if (dateStr == null || !DateOnly.TryParse(dateStr.Trim(), out var newDate)) return;
        var timeStr = await Shell.Current.DisplayPromptAsync("Time", "HH:mm (24h):", "OK", "Cancel",
            initialValue: entry.Start.ToString("HH:mm"));
        if (timeStr == null || !TimeSpan.TryParse(timeStr.Trim(), out var ts)) return;
        var newWhen = newDate.ToDateTime(TimeOnly.FromTimeSpan(ts));
        var task = entry.Task;
        var conflicts = MyPaHelper.FindConflicts(newWhen, newWhen.AddHours(1), CalendarEntries, _allTasks, task.Id);
        if (conflicts.Count > 0
            && !await Shell.Current.DisplayAlert("Conflict", string.Join("\n", conflicts) + "\n\nContinue?", "Yes", "No"))
            return;

        await RunAsync(async () =>
        {
            switch (entry.Kind)
            {
                case "meeting": task.MeetingAt = newWhen; break;
                case "reminder": task.RemindAt = newWhen; break;
                default:
                    task.DueAt = newWhen;
                    task.DueDate = newDate;
                    break;
            }
            task.UpdatedAt = DateTime.UtcNow;
            var employee = _state.CurrentEmployee!;
            await _storage.UpdatePaTaskAsync(task, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ExportCalendarAsync()
    {
        try
        {
            List<MyPaCalendarEntry> range;
            if (IsWeekLayout)
            {
                var start = MyPaHelper.StartOfWeekMonday(SelectedDay);
                range = MyPaHelper.EntriesInRange(CalendarEntries, _allTasks, start, start.AddDays(6));
            }
            else
            {
                var start = CalendarMonth;
                range = MyPaHelper.EntriesInRange(CalendarEntries, _allTasks, start, start.AddMonths(1).AddDays(-1));
            }
            if (range.Count == 0)
            {
                await Shell.Current.DisplayAlert("Export", "No events in this period.", "OK");
                return;
            }
            var path = Path.Combine(FileSystem.CacheDirectory, $"my-pa-{DateTime.Now:yyyyMMdd-HHmm}.ics");
            await File.WriteAllTextAsync(path, MyPaHelper.BuildIcsCalendar(range));
            await Share.Default.RequestAsync(new ShareFileRequest
            {
                Title = "Export My PA",
                File = new ShareFile(path, "text/calendar")
            });
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Export failed", ex.Message, "OK");
        }
    }

    [RelayCommand]
    private async Task OpenCalendarEntryAsync(MyPaCalendarEntry? entry)
    {
        if (entry == null) return;
        if (entry.LinkedJobId is { } jobId)
        {
            await ShellNavigation.GoToAsync(nameof(Views.Employee.JobCardPage),
                new Dictionary<string, object> { ["JobId"] = jobId.ToString() });
            return;
        }
        if (entry.LinkedDealId is { } dealId)
        {
            await ShellNavigation.GoToAsync(nameof(Views.Hr.HrProjectDetailPage),
                new Dictionary<string, object> { ["DealId"] = dealId.ToString() });
            return;
        }
        if (entry.Task != null) await EditTaskAsync(entry.Task);
    }

    [RelayCommand]
    private async Task CompleteTaskAsync(PaTask? task)
    {
        if (task == null) return;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            await _storage.UpdatePaTaskStatusAsync(task, "done", employee.Id);
            var next = MyPaHelper.SpawnNextRecurrence(task);
            if (next != null)
                await _storage.EmployeeCreatePaTaskAsync(next, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task SnoozeTaskAsync(PaTask? task)
    {
        if (task == null) return;
        var pick = await Shell.Current.DisplayActionSheet(
            "Snooze until", "Cancel", null, "Later today", "Tomorrow 9am", "Next Monday", "2 hours");
        if (pick == null || pick == "Cancel") return;
        var preset = pick switch
        {
            "Later today" => "later_today",
            "Tomorrow 9am" => "tomorrow_9",
            "Next Monday" => "next_monday",
            _ => "2h"
        };
        var until = MyPaHelper.SnoozeUntil(preset);
        await RunAsync(async () =>
        {
            task.StatusRaw = "snoozed";
            task.SnoozedUntil = until;
            var employee = _state.CurrentEmployee!;
            await _storage.UpdatePaTaskAsync(task, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task DeleteTaskAsync(PaTask? task)
    {
        if (task == null) return;
        if (!task.IsSystemGenerated
            && !await Shell.Current.DisplayAlert("Delete", $"Delete '{task.Title}'?", "Delete", "Cancel"))
            return;
        if (task.IsSystemGenerated
            && !await Shell.Current.DisplayAlert("Remove", "Remove from your list?", "Remove", "Cancel"))
            return;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            await _storage.DeletePaTaskAsync(employee.CompanyId, task.Id, employee.Id);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private async Task SetFilterAsync(string status)
    {
        FilterStatus = status;
        FocusModeEnabled = false;
        ApplyTaskFilter();
    }

    [RelayCommand]
    private void SelectDay(DateTime day)
    {
        SelectedDay = day.Date;
        if (day.Month != CalendarMonth.Month || day.Year != CalendarMonth.Year)
            CalendarMonth = new DateTime(day.Year, day.Month, 1);
        ActiveTab = "calendar";
    }

    [RelayCommand]
    private void SelectMonthDay(MyPaMonthDay? cell)
    {
        if (cell == null || cell.IsPlaceholder) return;
        SelectedDay = cell.Date;
        RefreshCalendarUi();
    }

    [RelayCommand]
    private void GoToToday()
    {
        CalendarMonth = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        SelectedDay = DateTime.Today;
        OnPropertyChanged(nameof(CalendarPeriodLabel));
    }

    [RelayCommand]
    private void PrevPeriod()
    {
        if (IsWeekLayout) SelectedDay = SelectedDay.AddDays(-7);
        else CalendarMonth = CalendarMonth.AddMonths(-1);
        OnPropertyChanged(nameof(CalendarPeriodLabel));
    }

    [RelayCommand]
    private void NextPeriod()
    {
        if (IsWeekLayout) SelectedDay = SelectedDay.AddDays(7);
        else CalendarMonth = CalendarMonth.AddMonths(1);
        OnPropertyChanged(nameof(CalendarPeriodLabel));
    }

    public string CalendarPeriodLabel => IsWeekLayout
        ? MyPaHelper.WeekRangeLabel(SelectedDay)
        : CalendarMonth.ToString("MMMM yyyy");

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
