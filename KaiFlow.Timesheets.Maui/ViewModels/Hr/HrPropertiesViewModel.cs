using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrPropertiesViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Site> _sites = [];
    [ObservableProperty] private ObservableCollection<ComplianceEntry> _expiringCompliance = [];

    public HrPropertiesViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Properties";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var sites = await _storage.GetSitesAsync(companyId);
            Sites = new ObservableCollection<Site>(sites);

            var compliance = await _storage.GetComplianceEntriesAsync(companyId);
            ExpiringCompliance = new ObservableCollection<ComplianceEntry>(
                compliance.Where(c => c.Status is ComplianceStatus.DueSoon or ComplianceStatus.Overdue));
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task CreateSiteAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync("New Property/Site", "Site name:", "Create", "Cancel", "e.g. Main Office");
        if (string.IsNullOrWhiteSpace(name)) return;

        var address = await Shell.Current.DisplayPromptAsync("New Property/Site", "Address (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var site = new Site
            {
                Name = name.Trim(),
                Address = string.IsNullOrWhiteSpace(address) ? null : address.Trim(),
                CompanyId = companyId
            };
            await _storage.CreateSiteAsync(site);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ViewSiteAsync(Site site)
    {
        if (site == null) return;
        await ShellNavigation.GoToAsync(nameof(Views.Hr.HrResidentsPage),
            new Dictionary<string, object> { ["siteId"] = site.Id.ToString() });
    }
}
