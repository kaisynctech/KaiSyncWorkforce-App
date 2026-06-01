using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Finance;

public partial class FinanceInvoicesViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<FinanceInvoice> _invoices = [];
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private string _statusFilter = "all";

    // Header summary
    [ObservableProperty] private decimal _outstandingTotal;
    [ObservableProperty] private decimal _overdueTotal;
    [ObservableProperty] private int _draftCount;

    // Table sort + pagination
    [ObservableProperty] private string _sortColumn = "issue";
    [ObservableProperty] private bool _sortAscending;
    [ObservableProperty] private int _pageIndex;
    [ObservableProperty] private int _pageSize = 25;
    [ObservableProperty] private string _pageSummary = "";
    [ObservableProperty] private bool _canGoPrevious;
    [ObservableProperty] private bool _canGoNext;

    private List<FinanceInvoice> _all = [];

    public FinanceInvoicesViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Invoices";
    }

    public string InvoiceHeaderLabel => FormatHeader("Invoice #", "number");
    public string IssueHeaderLabel => FormatHeader("Issued", "issue");
    public string DueHeaderLabel => FormatHeader("Due", "due");
    public string TotalHeaderLabel => FormatHeader("Total", "total");
    public string BalanceHeaderLabel => FormatHeader("Balance", "balance");
    public string StatusHeaderLabel => FormatHeader("Status", "status");

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            _all = await _storage.GetFinanceInvoicesAsync(_state.CurrentEmployee!.CompanyId);
            OutstandingTotal = _all.Where(i => i.IsOutstanding).Sum(i => i.BalanceDue);
            OverdueTotal = _all.Where(i => i.StatusRaw == "overdue").Sum(i => i.BalanceDue);
            DraftCount = _all.Count(i => i.StatusRaw == "draft");
            ApplyFilters();
        });
    }

    partial void OnSearchTextChanged(string value) { PageIndex = 0; ApplyFilters(); }
    partial void OnStatusFilterChanged(string value) { PageIndex = 0; ApplyFilters(); }
    partial void OnPageIndexChanged(int value) => ApplyFilters();
    partial void OnSortColumnChanged(string value) => NotifySortHeaders();
    partial void OnSortAscendingChanged(bool value) => NotifySortHeaders();

    private void NotifySortHeaders()
    {
        OnPropertyChanged(nameof(InvoiceHeaderLabel));
        OnPropertyChanged(nameof(IssueHeaderLabel));
        OnPropertyChanged(nameof(DueHeaderLabel));
        OnPropertyChanged(nameof(TotalHeaderLabel));
        OnPropertyChanged(nameof(BalanceHeaderLabel));
        OnPropertyChanged(nameof(StatusHeaderLabel));
        ApplyFilters();
    }

    private void ApplyFilters()
    {
        var result = TableQuery.Apply(new TableQueryOptions<FinanceInvoice>
        {
            Source = _all,
            SearchText = SearchText,
            MatchesSearch = (i, q) =>
                (i.InvoiceNumber?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)
                || (i.Notes?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false),
            Predicate = StatusFilter switch
            {
                "outstanding" => i => i.IsOutstanding,
                "paid" => i => i.StatusRaw == "paid",
                "overdue" => i => i.StatusRaw == "overdue",
                "draft" => i => i.StatusRaw == "draft",
                _ => null
            },
            SortKey = SortColumn,
            SortAscending = SortAscending,
            SortSelectors = new Dictionary<string, Func<FinanceInvoice, IComparable>>(StringComparer.OrdinalIgnoreCase)
            {
                ["number"] = i => i.InvoiceNumber ?? "",
                ["issue"] = i => i.IssueDate,
                ["due"] = i => i.DueDate ?? DateOnly.MaxValue,
                ["total"] = i => i.TotalAmount,
                ["balance"] = i => i.BalanceDue,
                ["status"] = i => i.StatusRaw,
            },
            PageIndex = PageIndex,
            PageSize = PageSize,
        });

        Invoices = new ObservableCollection<FinanceInvoice>(result.Page);
        PageIndex = result.PageIndex;
        PageSummary = result.PageSummary;
        CanGoPrevious = result.CanGoPrevious;
        CanGoNext = result.CanGoNext;
    }

    private string FormatHeader(string label, string key) =>
        SortColumn == key ? label + (SortAscending ? " ▲" : " ▼") : label;

    [RelayCommand] private void SelectStatus(string status) => StatusFilter = status;
    [RelayCommand] private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private void ToggleSort(string column)
    {
        if (string.Equals(SortColumn, column, StringComparison.OrdinalIgnoreCase))
            SortAscending = !SortAscending;
        else
        {
            SortColumn = column;
            SortAscending = column is "number" or "status";
        }
        PageIndex = 0;
    }

    [RelayCommand]
    private void PreviousPage()
    {
        if (CanGoPrevious)
            PageIndex--;
    }

    [RelayCommand]
    private void NextPage()
    {
        if (CanGoNext)
            PageIndex++;
    }

    [RelayCommand]
    private async Task NewInvoiceAsync()
        => await ShellNavigation.GoToAsync($"{FinanceRoutes.InvoiceDetail}?InvoiceId=new");

    [RelayCommand]
    private async Task OpenAsync(FinanceInvoice invoice)
    {
        if (invoice == null) return;
        await ShellNavigation.GoToAsync($"{FinanceRoutes.InvoiceDetail}?InvoiceId={invoice.Id}");
    }
}
