using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

[QueryProperty(nameof(TemplateId), "TemplateId")]
public partial class FormFillViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _templateId = "";
    [ObservableProperty] private WorkflowFormTemplate? _template;
    [ObservableProperty] private ObservableCollection<FormFieldEntry> _fieldEntries = [];

    public FormFillViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Fill Form";
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(TemplateId, out var id)) return;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var templates = await _storage.GetFormTemplatesAsync(companyId);
            Template = templates.FirstOrDefault(t => t.Id == id);
            if (Template != null)
            {
                Title = Template.Name;
                FieldEntries = new ObservableCollection<FormFieldEntry>(
                    Template.Fields.Select(f => new FormFieldEntry(f)));
            }
        });
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (Template == null) return;

        var requiredMissing = FieldEntries
            .Where(f => f.Field.IsRequired && string.IsNullOrWhiteSpace(f.Value) && !f.BoolValue)
            .Select(f => f.Field.Label)
            .ToList();

        if (requiredMissing.Any())
        {
            ErrorMessage = $"Required: {string.Join(", ", requiredMissing)}";
            return;
        }

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var data = FieldEntries.ToDictionary(
                f => f.Field.Key,
                f => f.GetValue());

            var submission = new WorkflowFormSubmission
            {
                TemplateId = Template.Id,
                SubmittedBy = employee.Id,
                Data = data.ToDictionary(kv => kv.Key, kv => (object)kv.Value),
                CompanyId = employee.CompanyId,
                SubmittedAt = DateTime.UtcNow
            };

            await _storage.SubmitFormAsync(submission);
            await Shell.Current.DisplayAlert("Submitted", $"Form '{Template.Name}' submitted successfully.", "OK");
            await ShellNavigation.GoToAsync("..");
        });
    }
}
