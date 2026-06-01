using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

[QueryProperty(nameof(TaskId), "TaskId")]
[QueryProperty(nameof(HrMode), "HrMode")]
[QueryProperty(nameof(PresetDay), "PresetDay")]
public partial class MyPaTaskEditorViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _taskId = "";
    [ObservableProperty] private string _hrMode = "false";
    [ObservableProperty] private string _presetDay = "";
    [ObservableProperty] private string _taskTitle = "";
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private string _priority = "medium";
    [ObservableProperty] private string _linkedType = "none";
    [ObservableProperty] private string? _linkedId;
    [ObservableProperty] private string? _linkedLabel;
    [ObservableProperty] private string _recurrence = "none";
    [ObservableProperty] private string _meetingWith = "";
    [ObservableProperty] private string _meetingMinutes = "";
    [ObservableProperty] private string _meetingFollowUp = "";
    [ObservableProperty] private DateTime? _dueAt;
    [ObservableProperty] private DateTime? _remindAt;
    [ObservableProperty] private DateTime? _meetingAt;
    [ObservableProperty] private ObservableCollection<MyPaLinkOption> _linkOptions = [];
    [ObservableProperty] private MyPaLinkOption? _selectedLink;
    [ObservableProperty] private ObservableCollection<Employee> _assignees = [];
    [ObservableProperty] private Employee? _selectedAssignee;
    [ObservableProperty] private string? _conflictWarning;

    public bool IsEdit => Guid.TryParse(TaskId, out _);
    public bool ShowAssignee => IsHrWorkspace;
    public bool ShowLinkPicker => LinkedType is "client" or "job" or "deal";
    public bool ShowMeetingFields => LinkedType == "meeting";

    public IReadOnlyList<string> Priorities { get; } = ["low", "medium", "high", "urgent"];
    public IReadOnlyList<string> LinkTypes { get; } = ["none", "client", "job", "deal", "meeting"];
    public IReadOnlyList<string> RecurrenceOptions { get; } = ["none", "daily", "weekly", "monthly"];

    public MyPaTaskEditorViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "New task";
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(TaskId, out var id))
        {
            Title = "New task";
            if (DateOnly.TryParse(PresetDay.Trim(), out var preset))
                DueAt = preset.ToDateTime(new TimeOnly(9, 0));
            else
                DueAt ??= DateTime.Today.AddDays(1).AddHours(9);
            await LoadAssigneesAsync();
            return;
        }

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var scopeId = IsHrWorkspace ? (Guid?)null : employee.Id;
            var task = (await _storage.GetPaTasksAsync(employee.CompanyId, scopeId))
                .FirstOrDefault(t => t.Id == id);
            if (task == null)
            {
                ErrorMessage = "Task not found.";
                return;
            }

            Title = "Edit task";
            ApplyFromTask(task);
            await LoadLinkOptionsAsync();
            await LoadAssigneesAsync();
            if (task.AssignedEmployeeId.HasValue)
                SelectedAssignee = Assignees.FirstOrDefault(e => e.Id == task.AssignedEmployeeId);
        });
    }

    private async Task LoadAssigneesAsync()
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        var list = IsHrWorkspace
            ? await _storage.GetEmployeesAsync(companyId)
            : await _storage.GetEmployeesAsync(companyId, _state.CurrentEmployee!.Id);
        Assignees = new ObservableCollection<Employee>(list.OrderBy(e => e.FullName));
    }

    private async Task RefreshConflictsAsync()
    {
        var when = MeetingAt ?? DueAt ?? RemindAt;
        if (!when.HasValue)
        {
            ConflictWarning = null;
            return;
        }
        var employee = _state.CurrentEmployee!;
        var entries = await _storage.GetMyPaCalendarEntriesMergedAsync(employee.CompanyId, employee.Id);
        var tasks = await _storage.GetPaTasksAsync(employee.CompanyId, employee.Id);
        Guid? exclude = Guid.TryParse(TaskId, out var id) ? id : null;
        var conflicts = MyPaHelper.FindConflicts(when.Value, when.Value.AddHours(1), entries, tasks, exclude);
        ConflictWarning = conflicts.Count > 0 ? "Conflicts: " + string.Join("; ", conflicts) : null;
    }

    private bool IsHrWorkspace => string.Equals(HrMode, "true", StringComparison.OrdinalIgnoreCase);

    private void ApplyFromTask(PaTask task)
    {
        TaskTitle = task.Title;
        Notes = task.Notes ?? task.Description ?? "";
        Priority = task.PriorityRaw;
        LinkedType = task.LinkedTypeRaw;
        LinkedId = task.LinkedId;
        LinkedLabel = task.LinkedLabel;
        Recurrence = task.RecurrencePattern;
        MeetingWith = task.MeetingWith ?? "";
        MeetingMinutes = task.MeetingMinutes ?? "";
        MeetingFollowUp = task.MeetingFollowUp ?? "";
        DueAt = task.EffectiveDue;
        RemindAt = task.RemindAt;
        MeetingAt = task.MeetingAt;
    }

    partial void OnLinkedTypeChanged(string value)
    {
        OnPropertyChanged(nameof(ShowLinkPicker));
        OnPropertyChanged(nameof(ShowMeetingFields));
        _ = LoadLinkOptionsAsync();
    }

    private async Task LoadLinkOptionsAsync()
    {
        if (!ShowLinkPicker)
        {
            LinkOptions = [];
            SelectedLink = null;
            return;
        }

        var companyId = _state.CurrentEmployee!.CompanyId;
        var options = await _storage.GetPaLinkOptionsAsync(companyId, LinkedType);
        LinkOptions = new ObservableCollection<MyPaLinkOption>(options);
        SelectedLink = options.FirstOrDefault(o => o.Id == LinkedId)
            ?? (LinkedLabel != null ? options.FirstOrDefault(o => o.Label == LinkedLabel) : null);
    }

    [RelayCommand]
    private async Task PickDueAsync()
    {
        var date = await Shell.Current.DisplayPromptAsync("Due date", "YYYY-MM-DD:", "OK", "Cancel",
            initialValue: (DueAt ?? DateTime.Today.AddDays(1)).ToString("yyyy-MM-dd"));
        if (date == null || !DateOnly.TryParse(date.Trim(), out var d)) return;
        var time = await Shell.Current.DisplayPromptAsync("Due time", "HH:mm (24h):", "OK", "Cancel",
            initialValue: (DueAt ?? DateTime.Today.AddHours(9)).ToString("HH:mm"));
        if (time == null) return;
        if (TimeSpan.TryParse(time.Trim(), out var ts))
        {
            DueAt = d.ToDateTime(TimeOnly.FromTimeSpan(ts));
            await RefreshConflictsAsync();
        }
    }

    [RelayCommand]
    private async Task PickRemindAsync()
    {
        var date = await Shell.Current.DisplayPromptAsync("Reminder date", "YYYY-MM-DD:", "OK", "Cancel",
            initialValue: DateTime.Today.ToString("yyyy-MM-dd"));
        if (date == null || !DateOnly.TryParse(date.Trim(), out var d)) return;
        var time = await Shell.Current.DisplayPromptAsync("Reminder time", "HH:mm:", "OK", "Cancel", initialValue: "08:00");
        if (time == null || !TimeSpan.TryParse(time.Trim(), out var ts)) return;
        RemindAt = d.ToDateTime(TimeOnly.FromTimeSpan(ts));
    }

    [RelayCommand]
    private async Task PickMeetingAsync()
    {
        var date = await Shell.Current.DisplayPromptAsync("Meeting date", "YYYY-MM-DD:", "OK", "Cancel",
            initialValue: DateTime.Today.ToString("yyyy-MM-dd"));
        if (date == null || !DateOnly.TryParse(date.Trim(), out var d)) return;
        var time = await Shell.Current.DisplayPromptAsync("Meeting time", "HH:mm:", "OK", "Cancel", initialValue: "10:00");
        if (time == null || !TimeSpan.TryParse(time.Trim(), out var ts)) return;
        MeetingAt = d.ToDateTime(TimeOnly.FromTimeSpan(ts));
        await RefreshConflictsAsync();
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(TaskTitle))
        {
            await Shell.Current.DisplayAlert("Required", "Task title is required.", "OK");
            return;
        }

        var employee = _state.CurrentEmployee!;
        var draft = new PaTask
        {
            CompanyId = employee.CompanyId,
            Title = TaskTitle.Trim(),
            Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim(),
            Description = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim(),
            PriorityRaw = Priority,
            LinkedTypeRaw = LinkedType,
            LinkedId = SelectedLink?.Id ?? LinkedId,
            LinkedLabel = SelectedLink?.Label ?? LinkedLabel,
            RecurrencePattern = Recurrence,
            MeetingWith = string.IsNullOrWhiteSpace(MeetingWith) ? null : MeetingWith.Trim(),
            MeetingAt = MeetingAt,
            MeetingMinutes = string.IsNullOrWhiteSpace(MeetingMinutes) ? null : MeetingMinutes.Trim(),
            MeetingFollowUp = string.IsNullOrWhiteSpace(MeetingFollowUp) ? null : MeetingFollowUp.Trim(),
            DueAt = DueAt,
            DueDate = DueAt.HasValue ? DateOnly.FromDateTime(DueAt.Value) : null,
            RemindAt = RemindAt
        };

        if (!string.IsNullOrEmpty(ConflictWarning)
            && !await Shell.Current.DisplayAlert("Schedule conflict", ConflictWarning + "\n\nSave anyway?", "Save", "Cancel"))
            return;

        await RunAsync(async () =>
        {
            if (SelectedAssignee != null && SelectedAssignee.Id != employee.Id)
            {
                draft.AssignedEmployeeId = SelectedAssignee.Id;
                draft.DelegatedByEmployeeId = employee.Id;
            }

            if (IsEdit && Guid.TryParse(TaskId, out var id))
            {
                var scopeId = IsHrWorkspace ? (Guid?)null : employee.Id;
                var existing = (await _storage.GetPaTasksAsync(employee.CompanyId, scopeId))
                    .FirstOrDefault(t => t.Id == id);
                if (existing == null)
                {
                    await Shell.Current.DisplayAlert("Not found", "Task could not be loaded.", "OK");
                    return;
                }
                var wasAssignee = existing.AssignedEmployeeId;
                existing.Title = draft.Title;
                existing.Notes = draft.Notes;
                existing.Description = draft.Description;
                existing.PriorityRaw = draft.PriorityRaw;
                existing.LinkedTypeRaw = draft.LinkedTypeRaw;
                existing.LinkedId = draft.LinkedId;
                existing.LinkedLabel = draft.LinkedLabel;
                existing.RecurrencePattern = draft.RecurrencePattern;
                existing.MeetingWith = draft.MeetingWith;
                existing.MeetingAt = draft.MeetingAt;
                existing.MeetingMinutes = draft.MeetingMinutes;
                existing.MeetingFollowUp = draft.MeetingFollowUp;
                existing.DueAt = draft.DueAt;
                existing.DueDate = draft.DueDate;
                existing.RemindAt = draft.RemindAt;
                existing.AssignedEmployeeId = draft.AssignedEmployeeId ?? existing.AssignedEmployeeId;
                existing.DelegatedByEmployeeId = draft.DelegatedByEmployeeId ?? existing.DelegatedByEmployeeId;
                existing.UpdatedAt = DateTime.UtcNow;
                await _storage.UpdatePaTaskAsync(existing, employee.Id);
                if (draft.AssignedEmployeeId.HasValue && draft.AssignedEmployeeId != wasAssignee)
                    await _storage.NotifyPaTaskDelegatedAsync(employee.CompanyId, draft.AssignedEmployeeId.Value, draft.Title, employee.Id);
            }
            else
            {
                var created = await _storage.EmployeeCreatePaTaskAsync(draft, employee.Id);
                if (draft.AssignedEmployeeId.HasValue && draft.AssignedEmployeeId != employee.Id)
                    await _storage.NotifyPaTaskDelegatedAsync(employee.CompanyId, draft.AssignedEmployeeId.Value, created.Title, employee.Id);
            }

            await ShellNavigation.GoToAsync("..");
        });
    }
}
