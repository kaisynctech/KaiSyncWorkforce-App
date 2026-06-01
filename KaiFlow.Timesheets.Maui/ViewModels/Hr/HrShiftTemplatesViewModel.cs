using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrShiftTemplatesViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<EmployeeShiftTemplate> _templates = [];

    public HrShiftTemplatesViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Time Templates";
    }

    public async Task LoadAsync()
    {
        var companyId = _state.CurrentCompany?.Id;
        if (companyId == null) return;
        await RunAsync(async () =>
        {
            var list = await _storage.GetShiftTemplatesAsync(companyId.Value);
            Templates = new ObservableCollection<EmployeeShiftTemplate>(list);
        });
    }

    [RelayCommand]
    private async Task AddTemplateAsync()
        => await ShellNavigation.GoToAsync(nameof(HrCreateTimeTemplatePage));

    [RelayCommand]
    private async Task EditTemplateAsync(EmployeeShiftTemplate template)
    {
        if (template == null) return;
        await ShellNavigation.GoToAsync($"{nameof(HrCreateTimeTemplatePage)}?TemplateId={template.Id}");
    }

    [RelayCommand]
    private async Task DeleteTemplateAsync(EmployeeShiftTemplate template)
    {
        var confirm = await Shell.Current.DisplayAlert("Delete Template",
            $"Delete '{template.Name}'? Employees assigned to this template will have no shift template.", "Delete", "Cancel");
        if (!confirm) return;
        await RunAsync(async () =>
        {
            await _storage.DeleteShiftTemplateAsync(template.Id, template.CompanyId);
            Templates.Remove(template);
        });
    }

    [RelayCommand]
    private async Task SetDefaultTemplateAsync(EmployeeShiftTemplate template)
    {
        if (template == null || template.IsDefault) return;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
            if (companyId == null) return;
            await _storage.SetDefaultShiftTemplateAsync(companyId.Value, template.Id);
            var list = await _storage.GetShiftTemplatesAsync(companyId.Value);
            Templates = new ObservableCollection<EmployeeShiftTemplate>(list);
        });
    }
}
