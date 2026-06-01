using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(ItemId), "ItemId")]
public partial class HrInventoryDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _itemId = "";
    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string _sku = "";
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string _unitOfMeasure = "each";
    [ObservableProperty] private string _unitCostText = "0";
    [ObservableProperty] private string _sellingPriceText = "0";
    [ObservableProperty] private string _quantityOnHandText = "0";
    [ObservableProperty] private string _reorderLevelText = "0";
    [ObservableProperty] private bool _isActive = true;
    [ObservableProperty] private ObservableCollection<Contractor> _suppliers = [];
    [ObservableProperty] private Contractor? _selectedSupplier;

    public bool IsNew =>
        string.IsNullOrWhiteSpace(ItemId) ||
        ItemId.Equals("new", StringComparison.OrdinalIgnoreCase) ||
        !Guid.TryParse(ItemId, out var id) ||
        id == Guid.Empty;

    public string StockValuePreview
    {
        get
        {
            double.TryParse(QuantityOnHandText, out var q);
            double.TryParse(UnitCostText, out var c);
            return $"R{q * c:N2}";
        }
    }

    public HrInventoryDetailViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Inventory item";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var allPartners = await _storage.GetContractorsAsync(companyId);
            Suppliers = new ObservableCollection<Contractor>(
                allPartners.Where(c => PartnerKinds.IsSupplierKind(c.PartnerKindRaw)).OrderBy(c => c.Name));

            if (IsNew)
            {
                Title = "New inventory item";
                return;
            }

            if (!Guid.TryParse(ItemId, out var itemGuid)) return;
            var item = await _storage.GetInventoryItemAsync(itemGuid);
            if (item == null) return;

            Title = item.Name;
            Name = item.Name;
            Sku = item.Sku ?? "";
            Description = item.Description ?? "";
            UnitOfMeasure = item.UnitOfMeasure;
            UnitCostText = item.UnitCost.ToString("F2");
            SellingPriceText = item.SellingPrice.ToString("F2");
            QuantityOnHandText = item.QuantityOnHand.ToString("F2");
            ReorderLevelText = item.ReorderLevel.ToString("F2");
            IsActive = item.IsActive;
            SelectedSupplier = item.SupplierContractorId.HasValue
                ? Suppliers.FirstOrDefault(s => s.Id == item.SupplierContractorId)
                : Suppliers.FirstOrDefault(s => s.Name == item.Supplier);
            OnPropertyChanged(nameof(StockValuePreview));
        });
    }

    partial void OnUnitCostTextChanged(string value) => OnPropertyChanged(nameof(StockValuePreview));
    partial void OnQuantityOnHandTextChanged(string value) => OnPropertyChanged(nameof(StockValuePreview));

    [RelayCommand]
    private async Task AddSupplierAsync()
    {
        await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}?ContractorId=new&PartnerKind={PartnerKinds.Supplier}");
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            await Shell.Current.DisplayAlertAsync("Required", "Item name is required.", "OK");
            return;
        }

        double.TryParse(UnitCostText, out var unitCost);
        double.TryParse(SellingPriceText, out var sell);
        double.TryParse(QuantityOnHandText, out var qty);
        double.TryParse(ReorderLevelText, out var reorder);

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var supplierName = SelectedSupplier?.Name;

            if (IsNew)
            {
                var created = await _storage.CreateInventoryItemAsync(new InventoryItem
                {
                    CompanyId = companyId,
                    Name = Name.Trim(),
                    Sku = string.IsNullOrWhiteSpace(Sku) ? null : Sku.Trim(),
                    Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim(),
                    UnitOfMeasure = string.IsNullOrWhiteSpace(UnitOfMeasure) ? "each" : UnitOfMeasure.Trim(),
                    UnitCost = unitCost,
                    SellingPrice = sell,
                    QuantityOnHand = qty,
                    ReorderLevel = reorder,
                    Supplier = supplierName,
                    SupplierContractorId = SelectedSupplier?.Id,
                    IsActive = IsActive
                });
                ItemId = created.Id.ToString();
            }
            else if (Guid.TryParse(ItemId, out var itemGuid))
            {
                var item = await _storage.GetInventoryItemAsync(itemGuid);
                if (item == null) return;
                item.Name = Name.Trim();
                item.Sku = string.IsNullOrWhiteSpace(Sku) ? null : Sku.Trim();
                item.Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim();
                item.UnitOfMeasure = string.IsNullOrWhiteSpace(UnitOfMeasure) ? "each" : UnitOfMeasure.Trim();
                item.UnitCost = unitCost;
                item.SellingPrice = sell;
                item.QuantityOnHand = qty;
                item.ReorderLevel = reorder;
                item.Supplier = supplierName;
                item.SupplierContractorId = SelectedSupplier?.Id;
                item.IsActive = IsActive;
                await _storage.UpdateInventoryItemAsync(item);
            }

            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task AllocateToJobAsync()
    {
        if (IsNew)
        {
            await Shell.Current.DisplayAlertAsync("Save first", "Save this item before allocating to a job.", "OK");
            return;
        }

        if (!Guid.TryParse(ItemId, out var itemGuid)) return;
        var item = await _storage.GetInventoryItemAsync(itemGuid);
        if (item == null) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        var jobs = (await _storage.GetJobsAsync(companyId)).Where(j => j.IsOpen).ToList();
        if (jobs.Count == 0)
        {
            await Shell.Current.DisplayAlertAsync("Jobs", "No open jobs to allocate to.", "OK");
            return;
        }

        var names = jobs.Select(j => j.Title).ToArray();
        var chosen = await Shell.Current.DisplayActionSheetAsync("Allocate to job", "Cancel", null, names);
        if (chosen == null || chosen == "Cancel") return;
        var job = jobs.FirstOrDefault(j => j.Title == chosen);
        if (job == null) return;

        var qtyStr = await Shell.Current.DisplayPromptAsync(
            "Quantity", $"How many {item.Name}?", keyboard: Keyboard.Numeric, initialValue: "1");
        if (!double.TryParse(qtyStr, out var qty) || qty <= 0) return;

        await RunAsync(async () =>
        {
            // Single atomic, row-locked allocation (insert usage + decrement stock in one tx).
            var updated = await _storage.AllocateInventoryToJobAsync(
                companyId, job.Id, _state.CurrentEmployee!.Id, item.Id, qty, item.UnitCost);

            if (updated != null)
                QuantityOnHandText = updated.QuantityOnHand.ToString("F2");
            await Shell.Current.DisplayAlertAsync("Allocated", $"{qty:N1} × {item.Name} added to job.", "OK");
        });
    }
}
