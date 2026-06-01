using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(TemplateId), "TemplateId")]
public partial class HrCreateTimeTemplateViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _templateId = "";

    [ObservableProperty] private string _name = "";
    [ObservableProperty] private TimeSpan _startTime = new TimeSpan(8, 0, 0);
    [ObservableProperty] private TimeSpan _endTime = new TimeSpan(17, 0, 0);
    [ObservableProperty] private ObservableCollection<BreakSlot> _breaks = [];

    private EmployeeShiftTemplate? _existingTemplate;

    public EmployeeShiftTemplate? ExistingTemplate
    {
        get => _existingTemplate;
        set
        {
            _existingTemplate = value;
            if (value != null)
            {
                Name = value.Name;
                StartTime = value.StartTime.ToTimeSpan();
                EndTime = value.EndTime.ToTimeSpan();

                // Populate from saved breaks list, or create one entry from the legacy total
                if (value.Breaks.Count > 0)
                    Breaks = new ObservableCollection<BreakSlot>(value.Breaks.Select(b => new BreakSlot { Label = b.Label, Minutes = b.Minutes }));
                else if (value.BreakMinutes > 0)
                    Breaks = [new BreakSlot { Label = "Break", Minutes = value.BreakMinutes }];
                else
                    Breaks = [];

                Title = "Edit Time Template";
            }
            RefreshPreview();
        }
    }

    public string PaidHoursPreview
    {
        get
        {
            var span = EndTime > StartTime
                ? EndTime - StartTime
                : TimeSpan.FromHours(24) - StartTime + EndTime;
            var totalBreak = Breaks.Sum(b => b.Minutes);
            var paid = Math.Max(0, span.TotalHours - totalBreak / 60.0);
            var breakLine = Breaks.Count == 0
                ? "no breaks"
                : string.Join(" + ", Breaks.Select(b => $"{b.Label} {b.Minutes}m"));
            return $"{paid:F1}h paid  ({breakLine})";
        }
    }

    public bool HasBreaks => Breaks.Count > 0;

    partial void OnStartTimeChanged(TimeSpan value) => RefreshPreview();
    partial void OnEndTimeChanged(TimeSpan value) => RefreshPreview();
    partial void OnBreaksChanged(ObservableCollection<BreakSlot> value)
    {
        RefreshPreview();
        OnPropertyChanged(nameof(HasBreaks));
    }

    private void RefreshPreview() => OnPropertyChanged(nameof(PaidHoursPreview));

    public HrCreateTimeTemplateViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "New Time Template";
    }

    public async Task LoadAsync()
    {
        if (NavigationParameterBag.TryGet<EmployeeShiftTemplate>("Template", out var fromBag) && fromBag != null)
        {
            ExistingTemplate = fromBag;
            return;
        }

        if (!Guid.TryParse(TemplateId, out var id))
            return;

        var companyId = _state.CurrentCompany?.Id;
        if (companyId == null) return;

        await RunAsync(async () =>
        {
            var template = (await _storage.GetShiftTemplatesAsync(companyId.Value))
                .FirstOrDefault(t => t.Id == id);
            if (template != null)
                ExistingTemplate = template;
        });
    }

    [RelayCommand]
    private async Task AddBreakAsync()
    {
        var label = await Shell.Current.DisplayPromptAsync(
            "Add Break", "Break name (e.g. Lunch, Tea Break):", "Next", "Cancel", "Lunch");
        if (string.IsNullOrWhiteSpace(label)) return;

        var minsStr = await Shell.Current.DisplayPromptAsync(
            "Add Break", $"Duration of '{label.Trim()}' in minutes:", "Add", "Cancel", "30",
            keyboard: Keyboard.Numeric);
        if (!int.TryParse(minsStr, out var mins) || mins <= 0) return;

        Breaks.Add(new BreakSlot { Label = label.Trim(), Minutes = mins });
        RefreshPreview();
        OnPropertyChanged(nameof(HasBreaks));
    }

    [RelayCommand]
    private void RemoveBreak(BreakSlot slot)
    {
        Breaks.Remove(slot);
        RefreshPreview();
        OnPropertyChanged(nameof(HasBreaks));
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            ErrorMessage = "Template name is required.";
            return;
        }

        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (companyId == null) return;

        await RunAsync(async () =>
        {
            var start = TimeOnly.FromTimeSpan(StartTime);
            var end = TimeOnly.FromTimeSpan(EndTime);
            var breaksList = Breaks.ToList();
            var totalBreak = breaksList.Sum(b => b.Minutes);

            if (_existingTemplate == null)
            {
                var existing = await _storage.GetShiftTemplatesAsync(companyId.Value);
                var template = new EmployeeShiftTemplate
                {
                    CompanyId = companyId.Value,
                    Name = Name.Trim(),
                    StartTime = start,
                    EndTime = end,
                    BreakMinutes = totalBreak,
                    Breaks = breaksList
                };
                var created = await _storage.CreateShiftTemplateAsync(template);
                if (existing.Count == 0)
                    await _storage.SetDefaultShiftTemplateAsync(companyId.Value, created.Id);
            }
            else
            {
                _existingTemplate.Name = Name.Trim();
                _existingTemplate.StartTime = start;
                _existingTemplate.EndTime = end;
                _existingTemplate.BreakMinutes = totalBreak;
                _existingTemplate.Breaks = breaksList;
                await _storage.UpdateShiftTemplateAsync(_existingTemplate);
            }
            await ShellNavigation.GoToAsync("..");
        });
    }
}
