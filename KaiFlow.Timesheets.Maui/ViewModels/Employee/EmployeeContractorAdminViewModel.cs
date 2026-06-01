using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class EmployeeContractorAdminViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private Contractor? _myContractor;
    [ObservableProperty] private ObservableCollection<Contractor> _linkedContractors = [];
    [ObservableProperty] private bool _hasProfile;

    public EmployeeContractorAdminViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Contractor Profile";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var linked = await _storage.GetLinkedContractorsForEmployeeAsync(employee.CompanyId, employee.Id);

            LinkedContractors = new ObservableCollection<Contractor>(linked);
            MyContractor = linked.FirstOrDefault();
            HasProfile = linked.Count > 0;
        });
    }

    [RelayCommand]
    private async Task CallContactAsync(Contractor contractor)
    {
        if (string.IsNullOrWhiteSpace(contractor.Phone)) return;
        await Launcher.Default.OpenAsync(new Uri($"tel:{contractor.Phone}"));
    }

    [RelayCommand]
    private async Task EmailContactAsync(Contractor contractor)
    {
        if (string.IsNullOrWhiteSpace(contractor.Email)) return;
        await Launcher.Default.OpenAsync(new Uri($"mailto:{contractor.Email}"));
    }
}
