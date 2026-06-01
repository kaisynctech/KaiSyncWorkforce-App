using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrAssetsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Asset> _assets = [];
    [ObservableProperty] private int _warrantyExpiringSoon;

    public HrAssetsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Assets";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var all = await _storage.GetAssetsAsync(_state.CurrentEmployee!.CompanyId);
            Assets = new ObservableCollection<Asset>(all.OrderBy(a => a.AssetType));
            WarrantyExpiringSoon = all.Count(a =>
                a.WarrantyExpires.HasValue &&
                a.WarrantyExpires.Value >= DateOnly.FromDateTime(DateTime.Today) &&
                a.WarrantyExpires.Value <= DateOnly.FromDateTime(DateTime.Today.AddDays(30)));
        });
    }

    [RelayCommand]
    private async Task CreateAssetAsync()
    {
        var label = await Shell.Current.DisplayPromptAsync("Add Asset", "Asset label/name:", "Next", "Cancel");
        if (string.IsNullOrWhiteSpace(label)) return;

        var assetType = await Shell.Current.DisplayPromptAsync("Add Asset", "Asset type (e.g. Pump, HVAC):", "Add", "Cancel");
        if (string.IsNullOrWhiteSpace(assetType)) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var asset = new Asset
            {
                Id = Guid.NewGuid(),
                Label = label.Trim(),
                AssetType = assetType.Trim(),
                StatusRaw = "active",
                CompanyId = companyId
            };
            await _storage.CreateAssetAsync(asset);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task EditAssetAsync(Asset asset)
    {
        var status = await Shell.Current.DisplayActionSheet(
            $"Asset: {asset.DisplayName}", "Cancel", null,
            "Set Active", "Set Under Maintenance", "Set Retired");
        if (status == null || status == "Cancel") return;

        var newStatus = status switch
        {
            "Set Active" => "active",
            "Set Under Maintenance" => "maintenance",
            "Set Retired" => "retired",
            _ => asset.StatusRaw
        };

        await RunAsync(async () =>
        {
            asset.StatusRaw = newStatus;
            await _storage.UpdateAssetAsync(asset);
            OnPropertyChanged(nameof(Assets));
        });
    }

    [RelayCommand]
    private async Task DeleteAssetAsync(Asset asset)
    {
        var confirm = await Shell.Current.DisplayAlert("Delete Asset", $"Delete '{asset.DisplayName}'?", "Delete", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.UpdateAssetAsync(new Asset { Id = asset.Id, StatusRaw = "retired", CompanyId = asset.CompanyId });
            Assets.Remove(asset);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
