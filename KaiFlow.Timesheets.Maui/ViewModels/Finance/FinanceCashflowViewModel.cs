using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Finance;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class FinanceCashflowViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private Guid _companyId;

    [ObservableProperty] private ObservableCollection<FinanceTransaction> _transactions = [];
    [ObservableProperty] private string _directionFilter = "all";
    [ObservableProperty] private decimal _moneyIn;
    [ObservableProperty] private decimal _moneyOut;
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(NetCashflowColor))]
    private decimal _netCashflow;
    [ObservableProperty] private DateTime _fromDate = DateTime.Today.AddMonths(-3);
    [ObservableProperty] private DateTime _toDate = DateTime.Today;

    private List<FinanceTransaction> _all = [];

    public FinanceCashflowViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Cashflow";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _companyId = _state.CurrentEmployee!.CompanyId;
            _all = await _storage.GetFinanceTransactionsAsync(
                _companyId, DateOnly.FromDateTime(FromDate), DateOnly.FromDateTime(ToDate));

            MoneyIn = VatCalculator.RoundFinancialValues(_all.Where(t => t.IsIncoming).Sum(t => t.TotalAmount));
            MoneyOut = VatCalculator.RoundFinancialValues(_all.Where(t => !t.IsIncoming).Sum(t => t.TotalAmount));
            NetCashflow = VatCalculator.RoundFinancialValues(MoneyIn - MoneyOut);
            ApplyFilter();
        });
    }

    partial void OnDirectionFilterChanged(string value) => ApplyFilter();
    partial void OnFromDateChanged(DateTime value) => _ = LoadAsync();
    partial void OnToDateChanged(DateTime value) => _ = LoadAsync();

    private void ApplyFilter()
    {
        IEnumerable<FinanceTransaction> q = _all;
        q = DirectionFilter switch
        {
            "in" => q.Where(t => t.IsIncoming),
            "out" => q.Where(t => !t.IsIncoming),
            _ => q
        };
        Transactions = new ObservableCollection<FinanceTransaction>(q);
    }

    [RelayCommand] private void SelectDirection(string direction) => DirectionFilter = direction;
    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();

    public string NetCashflowColor => NetCashflow < 0 ? "#DC2626" : "#16A34A";
}
