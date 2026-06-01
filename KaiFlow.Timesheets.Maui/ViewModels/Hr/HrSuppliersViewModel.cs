using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrSuppliersViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Contractor> _suppliers = [];
    [ObservableProperty] private string _searchText = "";
    private List<Contractor> _all = [];

    public HrSuppliersViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Suppliers";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var all = await _storage.GetContractorsAsync(_state.CurrentEmployee!.CompanyId);
            _all = all.Where(c => PartnerKinds.IsSupplierKind(c.PartnerKindRaw)).OrderBy(c => c.Name).ToList();
            ApplySearch();
        });
    }

    partial void OnSearchTextChanged(string value) => ApplySearch();

    private void ApplySearch()
    {
        var filtered = string.IsNullOrWhiteSpace(SearchText)
            ? _all
            : _all.Where(c =>
                c.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (c.ContactPerson?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Phone?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));
        Suppliers = new ObservableCollection<Contractor>(filtered);
    }

    [RelayCommand]
    private async Task CreateAsync()
        => await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}?ContractorId=new&PartnerKind={PartnerKinds.Supplier}");

    [RelayCommand]
    private async Task OpenAsync(Contractor c)
        => await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}?ContractorId={c.Id}&PartnerKind={Uri.EscapeDataString(c.PartnerKindRaw)}");

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
