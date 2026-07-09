using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrContractorsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<Contractor> _contractors = [];
    [ObservableProperty] private string _searchText = "";
    [ObservableProperty] private string _statusFilter = "active"; // "active" | "inactive" | "all"
    private List<Contractor> _all = [];

    // ── Phase 2D.3: Sub-tabs (Contractors | Activity/Actions) ────────────────

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsContractorsSubTab), nameof(IsActivitySubTab))]
    private string _contractorsSubTab = "contractors";

    public bool IsContractorsSubTab => _contractorsSubTab == "contractors";
    public bool IsActivitySubTab    => _contractorsSubTab == "activity";

    // ── Phase 2D.3: Contractor Action Centre ─────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasActionItems), nameof(PendingQuotesCount),
                               nameof(PendingBankingCount), nameof(PendingDocumentsCount),
                               nameof(ExpiringDocumentsCount))]
    private ObservableCollection<ContractorActionItem> _actionItems = [];

    public bool HasActionItems         => ActionItems.Count > 0;
    public int  PendingQuotesCount     => ActionItems.Count(a => a.ActionType == "quote_pending");
    public int  PendingBankingCount    => ActionItems.Count(a => a.ActionType == "banking_pending");
    public int  PendingDocumentsCount  => ActionItems.Count(a => a.ActionType == "document_pending");
    public int  ExpiringDocumentsCount => ActionItems.Count(a => a.ActionType == "document_expiring");

    public string PendingQuotesLabel     => PendingQuotesCount     > 0 ? PendingQuotesCount.ToString()     : "—";
    public string PendingBankingLabel    => PendingBankingCount    > 0 ? PendingBankingCount.ToString()    : "—";
    public string PendingDocumentsLabel  => PendingDocumentsCount  > 0 ? PendingDocumentsCount.ToString()  : "—";
    public string ExpiringDocumentsLabel => ExpiringDocumentsCount > 0 ? ExpiringDocumentsCount.ToString() : "—";

    public string ActionCentreCountLabel => ActionItems.Count switch
    {
        0 => "No pending actions",
        1 => "1 item requires attention",
        _ => $"{ActionItems.Count} items require attention"
    };

    /// <summary>Section A header with inline count (Polish item 3).</summary>
    public string NeedsApprovalHeader => ActionItems.Count > 0
        ? $"NEEDS APPROVAL / ACTION  ({ActionItems.Count})"
        : "NEEDS APPROVAL / ACTION";

    // ── Collapsible Section A (Polish item 3) ─────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(NeedsApprovalChevron))]
    private bool _isNeedsApprovalExpanded = true;

    public string NeedsApprovalChevron => _isNeedsApprovalExpanded ? "▲" : "▼";

    // ── Activity feed (Section B of Activity tab) ─────────────────────────────
    [ObservableProperty]
    private ObservableCollection<ContractorActivityEvent> _activityItems = [];
    [ObservableProperty]
    private ObservableCollection<ContractorActivityEvent> _filteredActivityItems = [];
    [ObservableProperty] private string _activityFilter = "All";
    [ObservableProperty] private bool   _activityLoading;

    public IReadOnlyList<string> ActivityFilterOptions { get; } =
        ["All", "Quotes", "Banking", "Profile", "Other"];

    partial void OnActivityFilterChanged(string _)  => ApplyActivityFilter();
    partial void OnActivityItemsChanged(ObservableCollection<ContractorActivityEvent> _)
        => ApplyActivityFilter();

    private void ApplyActivityFilter()
    {
        var filtered = ActivityFilter switch
        {
            "Quotes"  => _activityItems.Where(a => a.EventType == "quotes"),
            "Banking" => _activityItems.Where(a => a.EventType == "banking"),
            "Profile" => _activityItems.Where(a => a.EventType == "profile"),
            "Other"   => _activityItems.Where(a => a.EventType == "other"),
            _         => _activityItems.AsEnumerable(),
        };
        FilteredActivityItems = new ObservableCollection<ContractorActivityEvent>(filtered);
    }

    // Computed for filter chip highlight bindings
    public bool IsActiveFilter   => StatusFilter == "active";
    public bool IsInactiveFilter => StatusFilter == "inactive";
    public bool IsAllFilter      => StatusFilter == "all";

    public HrContractorsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Contractors";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            // Load contractors list and action items in parallel
            var contractorsTask   = _storage.GetContractorsAsync(companyId);
            var actionItemsTask   = _storage.GetContractorActionItemsAsync(companyId);
            await Task.WhenAll(contractorsTask, actionItemsTask);

            _all = contractorsTask.Result
                .Where(c => PartnerKinds.IsContractorKind(c.PartnerKindRaw))
                .OrderBy(c => c.Name)
                .ToList();
            ApplyFilter();

            await MainThread.InvokeOnMainThreadAsync(() =>
                ActionItems = new ObservableCollection<ContractorActionItem>(actionItemsTask.Result));
        });
    }

    /// <summary>Refresh the action centre without reloading the full contractor list.</summary>
    private async Task RefreshActionItemsAsync()
    {
        try
        {
            var items = await _storage.GetContractorActionItemsAsync(_state.CurrentEmployee!.CompanyId);
            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                ActionItems = new ObservableCollection<ContractorActionItem>(items);
                // Auto-expand Section A when items arrive; keep collapsed if user already collapsed it
                if (ActionItems.Count > 0) IsNeedsApprovalExpanded = true;
                // Refresh header text (includes count)
                OnPropertyChanged(nameof(NeedsApprovalHeader));
            });
        }
        catch { /* non-critical */ }
    }

    partial void OnSearchTextChanged(string value) => ApplyFilter();

    partial void OnStatusFilterChanged(string value)
    {
        OnPropertyChanged(nameof(IsActiveFilter));
        OnPropertyChanged(nameof(IsInactiveFilter));
        OnPropertyChanged(nameof(IsAllFilter));
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        var query = _all.AsEnumerable();

        query = StatusFilter switch
        {
            "active"   => query.Where(c => c.IsActive),
            "inactive" => query.Where(c => !c.IsActive),
            _          => query
        };

        if (!string.IsNullOrWhiteSpace(SearchText))
            query = query.Where(c =>
                c.Name.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
                (c.ContractorCode?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.ContactPerson?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Phone?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false) ||
                (c.Email?.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ?? false));

        Contractors = new ObservableCollection<Contractor>(query);
    }

    [RelayCommand] private void ShowActive()   => StatusFilter = "active";
    [RelayCommand] private void ShowInactive() => StatusFilter = "inactive";
    [RelayCommand] private void ShowAll()      => StatusFilter = "all";

    [RelayCommand]
    private async Task CreateAsync()
        => await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}?ContractorId=new&PartnerKind={PartnerKinds.Contractor}");

    [RelayCommand]
    private async Task OpenAsync(Contractor c)
        => await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}?ContractorId={c.Id}&PartnerKind={Uri.EscapeDataString(c.PartnerKindRaw)}");

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    /// <summary>Phase 2B.3a — navigate to compliance pack settings.</summary>
    [RelayCommand]
    private static async Task OpenCompliancePacksAsync()
        => await Shell.Current.GoToAsync(nameof(HrCompliancePacksPage));

    // ── Phase 2D.3: Sub-tab navigation ───────────────────────────────────────

    [RelayCommand]
    private void ToggleNeedsApproval()
    {
        IsNeedsApprovalExpanded = !IsNeedsApprovalExpanded;
        OnPropertyChanged(nameof(NeedsApprovalHeader));
    }

    [RelayCommand]
    private void ShowContractorsSubTab() => ContractorsSubTab = "contractors";

    [RelayCommand]
    private async Task ShowActivitySubTabAsync()
    {
        ContractorsSubTab = "activity";
        // Reload both action items and activity feed on every visit so data stays fresh
        var companyId = _state.CurrentEmployee?.CompanyId ?? Guid.Empty;
        if (companyId == Guid.Empty) return;

        _ = RefreshActionItemsAsync();          // Section A — action items
        await LoadActivityAsync(companyId);     // Section B — recent events
    }

    private async Task LoadActivityAsync(Guid companyId)
    {
        if (ActivityLoading) return;
        ActivityLoading = true;
        try
        {
            var items = await _storage.GetContractorActivityAsync(companyId);
            await MainThread.InvokeOnMainThreadAsync(() =>
                ActivityItems = new System.Collections.ObjectModel.ObservableCollection<ContractorActivityEvent>(items));
        }
        catch { /* non-critical */ }
        finally { ActivityLoading = false; }
    }

    [RelayCommand]
    private async Task RefreshActivityAsync()
    {
        var companyId = _state.CurrentEmployee?.CompanyId ?? Guid.Empty;
        if (companyId == Guid.Empty) return;
        _ = RefreshActionItemsAsync();
        await LoadActivityAsync(companyId);
    }

    // ── Phase 2D.3: Action Centre commands ───────────────────────────────────

    [RelayCommand]
    private async Task RefreshActionCentreAsync() => await RefreshActionItemsAsync();

    /// <summary>
    /// Navigate to the relevant contractor detail page with the correct tab open.
    /// Uses the TabHint query parameter so HrContractorDetailsViewModel opens the
    /// right workspace (quotes / banking / compliance).
    /// </summary>
    /// <summary>Opens the contractor detail page from an activity-feed row (Section B).</summary>
    [RelayCommand]
    private async Task OpenActivityEventAsync(ContractorActivityEvent ev)
    {
        if (ev == null || ev.ContractorId == Guid.Empty) return;
        var contractor = _all.FirstOrDefault(c => c.Id == ev.ContractorId);
        var kind = contractor != null
            ? Uri.EscapeDataString(contractor.PartnerKindRaw)
            : Uri.EscapeDataString(PartnerKinds.Contractor);
        await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}" +
            $"?ContractorId={ev.ContractorId}" +
            $"&PartnerKind={kind}" +
            $"&TabHint={ev.TargetTab}");
    }

    [RelayCommand]
    private async Task OpenActionItemAsync(ContractorActionItem item)
    {
        if (item == null) return;
        var contractor = _all.FirstOrDefault(c => c.Id == item.ContractorId);
        // Use known partner kind; fall back to "contractor" if not in list
        var kind = contractor != null
            ? Uri.EscapeDataString(contractor.PartnerKindRaw)
            : Uri.EscapeDataString(PartnerKinds.Contractor);
        await ShellNavigation.GoToAsync(
            $"{nameof(HrContractorDetailsPage)}" +
            $"?ContractorId={item.ContractorId}" +
            $"&PartnerKind={kind}" +
            $"&TabHint={item.TargetTab}");
    }
}
