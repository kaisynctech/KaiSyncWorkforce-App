using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Employee;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class PaperlessViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<WorkflowFormTemplate> _templates = [];
    [ObservableProperty] private ObservableCollection<WorkflowFormSubmission> _submissions = [];

    public PaperlessViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Forms";
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var templates = await _storage.GetFormTemplatesAsync(companyId);
            Templates = new ObservableCollection<WorkflowFormTemplate>(
                templates.Where(t => t.IsActive).OrderBy(t => t.Name));

            var submissions = await _storage.GetFormSubmissionsAsync(companyId);
            Submissions = new ObservableCollection<WorkflowFormSubmission>(
                submissions.OrderByDescending(s => s.SubmittedAt).Take(20));
        });
    }

    [RelayCommand]
    private async Task FillFormAsync(WorkflowFormTemplate template)
        => await ShellNavigation.GoToAsync(nameof(FormFillPage),
            new Dictionary<string, object> { ["TemplateId"] = template.Id.ToString() });
}
