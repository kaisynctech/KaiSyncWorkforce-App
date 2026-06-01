using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrInventoryViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<InventoryItem> _items = [];
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private bool _showLowStockOnly;
    private List<InventoryItem> _all = [];

    public HrInventoryViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export = export;
        _state = state;
        Title = "Inventory";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _all = await _storage.GetInventoryItemsAsync(_state.CurrentEmployee!.CompanyId);
            ApplyFilter();
        });
    }

    partial void OnSearchTextChanged(string v) => ApplyFilter();
    partial void OnShowLowStockOnlyChanged(bool v) => ApplyFilter();

    private void ApplyFilter()
    {
        var f = _all.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(SearchText))
            f = f.Where(i =>
                i.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (i.Sku?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (i.Supplier?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));
        if (ShowLowStockOnly)
            f = f.Where(i => i.NeedsReorder);
        Items = new ObservableCollection<InventoryItem>(f.OrderBy(i => i.Name));
    }

    [RelayCommand]
    private async Task CreateItemAsync()
        => await ShellNavigation.GoToAsync($"{nameof(HrInventoryDetailPage)}?ItemId=new");

    [RelayCommand]
    private async Task OpenItemAsync(InventoryItem item)
        => await ShellNavigation.GoToAsync($"{nameof(HrInventoryDetailPage)}?ItemId={item.Id}");

    [RelayCommand]
    private async Task GoToSuppliersAsync()
        => await ShellNavigation.GoToAsync(nameof(HrSuppliersPage));

    [RelayCommand]
    private async Task ExportAsync()
    {
        await _export.ExportToCsvAsync("inventory.csv",
            ["Name", "SKU", "Supplier", "Qty", "Unit", "Unit Cost", "Stock Value", "Low Stock"],
            _all.Select(i => new[]
            {
                i.Name, i.Sku ?? "", i.SupplierDisplay,
                i.QuantityOnHand.ToString("F2"), i.UnitOfMeasure,
                i.UnitCost.ToString("F2"), i.StockValue.ToString("F2"),
                i.NeedsReorder ? "Yes" : "No"
            }));
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
