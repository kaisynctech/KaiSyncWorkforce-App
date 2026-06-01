using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrResidentsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Resident> _residents = [];
    [ObservableProperty] private ObservableCollection<Site> _sites = [];
    [ObservableProperty] private ObservableCollection<Unit> _units = [];
    [ObservableProperty] private ObservableCollection<ComplianceEntry> _compliance = [];
    [ObservableProperty] private Site? _selectedSite;
    [ObservableProperty] private string _activeTab = "residents";

    public bool ShowResidents => ActiveTab == "residents";
    public bool ShowUnits => ActiveTab == "units";
    public bool ShowCompliance => ActiveTab == "compliance";

    partial void OnActiveTabChanged(string value)
    {
        OnPropertyChanged(nameof(ShowResidents));
        OnPropertyChanged(nameof(ShowUnits));
        OnPropertyChanged(nameof(ShowCompliance));
    }

    public HrResidentsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Residents";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var sites = await _storage.GetSitesAsync(companyId);
            Sites = new ObservableCollection<Site>(sites);
        });
    }

    partial void OnSelectedSiteChanged(Site? value)
    {
        if (value == null) return;
        _ = LoadResidentsAsync(value.Id);
    }

    private async Task LoadResidentsAsync(Guid siteId)
    {
        var residents = await _storage.GetResidentsAsync(siteId);
        Residents = new ObservableCollection<Resident>(residents);

        var units = await _storage.GetUnitsAsync(siteId);
        Units = new ObservableCollection<Unit>(units.OrderBy(u => u.UnitNumber));

        var companyId = _state.CurrentEmployee!.CompanyId;
        var compliance = await _storage.GetComplianceEntriesAsync(companyId);
        Compliance = new ObservableCollection<ComplianceEntry>(
            compliance.Where(c => c.SiteId == siteId).OrderBy(c => c.ExpiryDate));
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private async Task CreateUnitAsync()
    {
        if (SelectedSite == null)
        {
            await Shell.Current.DisplayAlert("No Site", "Select a site first.", "OK");
            return;
        }

        var number = await Shell.Current.DisplayPromptAsync("New Unit", "Unit number:", "Create", "Cancel");
        if (string.IsNullOrWhiteSpace(number)) return;

        var type = await Shell.Current.DisplayPromptAsync("New Unit", "Type (e.g. Apartment, Office):", "Next", "Skip");

        await RunAsync(async () =>
        {
            var unit = new Unit
            {
                SiteId = SelectedSite.Id,
                UnitNumber = number.Trim(),
                UnitType = string.IsNullOrWhiteSpace(type) ? null : type.Trim(),
                CompanyId = _state.CurrentEmployee!.CompanyId
            };
            await _storage.CreateUnitAsync(unit);
            await LoadResidentsAsync(SelectedSite.Id);
        });
    }

    [RelayCommand]
    private async Task EditResidentAsync(Resident resident)
    {
        var name = await Shell.Current.DisplayPromptAsync("Edit Resident", "First name:", "OK", "Cancel",
            initialValue: resident.Name);
        if (name == null) return;

        var surname = await Shell.Current.DisplayPromptAsync("Edit Resident", "Last name:", "OK", "Cancel",
            initialValue: resident.Surname);
        if (surname == null) return;

        var phone = await Shell.Current.DisplayPromptAsync("Edit Resident", "Phone:", "OK", "Cancel",
            initialValue: resident.Phone ?? "", keyboard: Keyboard.Telephone);

        await RunAsync(async () =>
        {
            resident.Name = name.Trim();
            resident.Surname = surname.Trim();
            resident.Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
            await _storage.UpdateResidentAsync(resident);
            if (SelectedSite != null)
                await LoadResidentsAsync(SelectedSite.Id);
        });
    }

    [RelayCommand]
    private async Task CreateResidentAsync()
    {
        if (SelectedSite == null)
        {
            await Shell.Current.DisplayAlert("No Site", "Select a site first.", "OK");
            return;
        }

        var name = await Shell.Current.DisplayPromptAsync("Add Resident", "First name:", "Next", "Cancel");
        if (string.IsNullOrWhiteSpace(name)) return;

        var surname = await Shell.Current.DisplayPromptAsync("Add Resident", "Last name:", "Next", "Cancel");
        if (surname == null) return;

        var phone = await Shell.Current.DisplayPromptAsync("Add Resident", "Phone (optional):", "Next", "Skip",
            keyboard: Keyboard.Telephone);

        await RunAsync(async () =>
        {
            var resident = new Resident
            {
                Id = Guid.NewGuid(),
                SiteId = SelectedSite.Id,
                Name = name.Trim(),
                Surname = surname.Trim(),
                Phone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim(),
                MoveInDate = DateOnly.FromDateTime(DateTime.Today),
                CompanyId = _state.CurrentEmployee!.CompanyId
            };
            await _storage.CreateResidentAsync(resident);
            await LoadResidentsAsync(SelectedSite.Id);
        });
    }
}
