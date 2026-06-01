using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrClientsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Client> _clients = [];
    [ObservableProperty] private string _searchText = "";
    private List<Client> _all = [];

    public HrClientsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Clients";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _all = await _storage.GetClientsAsync(_state.CurrentEmployee!.CompanyId);
            ApplySearch();
        });
    }

    partial void OnSearchTextChanged(string value) => ApplySearch();

    private void ApplySearch()
    {
        var f = string.IsNullOrWhiteSpace(SearchText)
            ? _all
            : _all.Where(c =>
                c.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (c.ClientCode?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.ContactPerson?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Email?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Phone?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));
        Clients = new ObservableCollection<Client>(f.ToList());
        OnPropertyChanged(nameof(Clients));
    }

    [RelayCommand]
    private async Task AddClientAsync()
        => await ShellNavigation.GoToAsync(nameof(ClientDetailPage),
            new Dictionary<string, object> { ["ClientId"] = "new" });

    [RelayCommand]
    private async Task OpenClientAsync(Client client)
        => await ShellNavigation.GoToAsync(nameof(ClientDetailPage),
            new Dictionary<string, object> { ["ClientId"] = client.Id.ToString() });

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
