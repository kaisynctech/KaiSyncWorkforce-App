using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record ContractorMemberDisplay(ContractorMemberLink Link, string EmployeeName);

[QueryProperty(nameof(ContractorId), "ContractorId")]
[QueryProperty(nameof(PartnerKind), "PartnerKind")]
[QueryProperty(nameof(TabHint),     "TabHint")]       // Phase 2D.3: action centre deep-link
public partial class HrContractorDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _contractorId = "";
    [ObservableProperty] private string _partnerKind = PartnerKinds.Contractor;

    /// <summary>
    /// Optional deep-link tab slug passed from the Action Centre (e.g. "quotes", "banking", "compliance").
    /// Applied to ActiveTab when navigation arrives so the page opens on the correct tab.
    /// </summary>
    [ObservableProperty] private string _tabHint = "";

    partial void OnTabHintChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            ActiveTab = value;
    }

    [ObservableProperty] private Contractor? _contractor;
    [ObservableProperty] private ObservableCollection<ContractorMemberDisplay> _members = [];
    [ObservableProperty] private string _selectedPartnerKindLabel = "Contractor";

    // ── Phase 2B.1 — Compliance documents ────────────────────────────────────
    [ObservableProperty] private ObservableCollection<ContractorDocument> _documents = [];

    // Filtered + sorted view of Documents — this is what the table binds to.
    [ObservableProperty] private ObservableCollection<ContractorDocument> _filteredDocuments = [];

    // Search, sort and filter state
    [ObservableProperty] private string _documentSearch = "";
    [ObservableProperty] private string _selectedDocSortLabel = "Newest First";

    /// <summary>
    /// Active KPI strip filter key: "all" | "approved" | "pending" | "rejected" | "expired".
    /// Stacks on top of DocumentSearch and SelectedDocSortLabel.
    /// </summary>
    [ObservableProperty] private string _selectedDocFilter = "all";

    private static readonly string[] DocSortLabelsArr = [
        "Newest First", "Oldest First", "Type (A→Z)", "Expiry (Soonest)", "Status"
    ];
    private static readonly string[] DocSortKeysArr = [
        "uploaded_desc", "uploaded_asc", "type_asc", "expiry_asc", "status"
    ];

    public IReadOnlyList<string> DocSortOptions => DocSortLabelsArr;

    // KPI summary counts (computed from raw Documents, not FilteredDocuments)
    public int TotalDocuments   => Documents.Count;
    public int ApprovedDocCount => Documents.Count(d => d.IsApproved && !d.IsExpired);
    public int PendingDocCount  => Documents.Count(d => d.IsPending);
    public int RejectedDocCount => Documents.Count(d => d.IsRejected);
    public int ExpiredDocCount  => Documents.Count(d => d.IsExpired);

    /// <summary>
    /// Border colour for each KPI filter badge — highlighted when that filter is active.
    /// Transparent when inactive so the badge looks unselected.
    /// </summary>
    public string FilterBorderAll      => SelectedDocFilter == "all"      ? "#94A3B8" : "Transparent";
    public string FilterBorderApproved => SelectedDocFilter == "approved" ? "#22C55E" : "Transparent";
    public string FilterBorderPending  => SelectedDocFilter == "pending"  ? "#94A3B8" : "Transparent";
    public string FilterBorderRejected => SelectedDocFilter == "rejected" ? "#FCA5A5" : "Transparent";
    public string FilterBorderExpired  => SelectedDocFilter == "expired"  ? "#FCA5A5" : "Transparent";

    /// <summary>
    /// Context-sensitive empty-state message for the documents table.
    /// </summary>
    public string DocEmptyMessage =>
        Documents.Count == 0
            ? "No compliance documents uploaded yet. Tap + Upload to add the first document."
            : "No documents found for this filter.";

    // ── Phase 2B.3b: Compliance Pack assignment ──────────────────────────────

    /// <summary>All packs available for this company (loaded once on page open).</summary>
    [ObservableProperty] private ObservableCollection<CompliancePack> _availablePacks = [];

    /// <summary>
    /// Label shown in the pack Picker. "No pack assigned" means no pack is linked.
    /// Changing this sets Contractor.CompliancePackId in-memory; persisted on Save.
    /// </summary>
    [ObservableProperty] private string _selectedPackLabel = "No pack assigned";

    /// <summary>Checklist rows — one per pack item, cross-referenced with Documents.</summary>
    [ObservableProperty] private ObservableCollection<PackChecklistRow> _packChecklistRows = [];

    /// <summary>Items for the currently selected pack (empty = no pack / legacy mode).</summary>
    private List<CompliancePackItem> _loadedPackItems = [];

    /// <summary>Guard: prevents OnSelectedPackLabelChanged from saving during initial load.</summary>
    private bool _packsLoaded;

    // Picker item source — "No pack assigned" + pack names
    public IReadOnlyList<string> PackLabels =>
        new[] { "No pack assigned" }.Concat(AvailablePacks.Select(p => p.Name)).ToArray();

    /// <summary>True when a pack is assigned AND its items have been loaded.</summary>
    public bool HasPackAssigned => _loadedPackItems.Count > 0;

    // Summary counts for the pack card stats strip
    public int PackRequiredCount => PackChecklistRows.Count(r => r.IsRequired);
    public int PackCompleteCount => PackChecklistRows.Count(r => r.IsRequired && r.CountsForScore);
    public int PackMissingCount  => PackChecklistRows.Count(r => r.IsRequired && r.Status == "missing");

    // ── Phase 2B.2: Compliance Overview ──────────────────────────────────────
    // All properties are computed client-side from the loaded Documents collection.
    // They are flat (not nested model) to avoid compiled-binding path uncertainty.

    // Required-document breakdown counts
    public int  CompTotalRequired    { get; private set; }
    public int  CompValidRequired    { get; private set; }
    public int  CompExpiringRequired { get; private set; }
    public int  CompExpiredRequired  { get; private set; }
    public int  CompPendingRequired  { get; private set; }
    public int  CompRejectedRequired { get; private set; }

    // Score
    public int    CompScorePercent       { get; private set; }
    public double CompScoreProgress      { get; private set; }       // 0.0 – 1.0  for ProgressBar
    public string CompRequiredValidLabel { get; private set; } = "0/0";

    // Status styling
    public string CompStatusLabel   { get; private set; } = "Not Configured";
    public string CompStatusBadgeBg { get; private set; } = "#1E293B";
    public string CompStatusBadgeFg { get; private set; } = "#64748B";
    public string CompScoreColor    { get; private set; } = "#64748B";

    // Flags used to drive IsVisible on XAML warning panels
    public bool CompHasRequiredDocs { get; private set; }
    public bool CompHasIssues       { get; private set; }

    // Expiring-soon and expired document lists (updated alongside FilteredDocuments)
    [ObservableProperty] private ObservableCollection<ContractorDocument> _expiringDocuments = [];
    [ObservableProperty] private ObservableCollection<ContractorDocument> _expiredDocuments  = [];

    // ViewModel-level proxies for Contractor fields that need live UI updates.
    // Contractor model (BaseModel) does not implement INotifyPropertyChanged, so
    // nested property changes never notify XAML. These proxies are synced at load
    // and written back to the model before save.

    // ── Phase 1 proxies ──────────────────────────────────────────────────────
    [ObservableProperty] private bool _isVatRegistered;
    [ObservableProperty] private double _contractorRating;

    // ── Phase 2A proxies — banking & payment controls ─────────────────────────
    [ObservableProperty] private bool _paymentHold;
    [ObservableProperty] private bool _complianceHold;
    [ObservableProperty] private bool _bankingVerified;
    [ObservableProperty] private string _selectedAccountTypeLabel  = "Cheque";
    [ObservableProperty] private string _selectedPaymentTermsLabel = "30 Days";
    [ObservableProperty] private string _selectedPaymentMethodLabel = "EFT";

    // Lookup tables for picker → raw value conversion
    private static readonly string[] AccountTypeRaw    = ["cheque", "savings", "transmission", "credit"];
    private static readonly string[] AccountTypeLbls   = ["Cheque", "Savings", "Transmission", "Credit"];
    private static readonly string[] PaymentTermsRaw   = ["immediate", "7_days", "14_days", "30_days", "60_days", "90_days"];
    private static readonly string[] PaymentTermsLbls  = ["Immediate", "7 Days", "14 Days", "30 Days", "60 Days", "90 Days"];
    private static readonly string[] PaymentMethodRaw  = ["eft", "cash", "cheque", "card"];
    private static readonly string[] PaymentMethodLbls = ["EFT", "Cash", "Cheque", "Card"];

    // Picker item sources bound from XAML
    public IReadOnlyList<string> AccountTypeItems   => AccountTypeLbls;
    public IReadOnlyList<string> PaymentTermsItems  => PaymentTermsLbls;
    public IReadOnlyList<string> PaymentMethodItems => PaymentMethodLbls;

    private List<Employee> _allEmployees = [];
    private bool _originalIsActive = true; // tracks active state at load time for deactivation confirmation

    // ── Lookup helpers ────────────────────────────────────────────────────────
    private static string LabelFor(string[] raws, string[] labels, string? raw, string fallback)
    {
        if (raw is null) return fallback;
        var i = Array.IndexOf(raws, raw);
        return i >= 0 ? labels[i] : fallback;
    }

    private static string RawFor(string[] raws, string[] labels, string label, string fallback)
    {
        var i = Array.IndexOf(labels, label);
        return i >= 0 ? raws[i] : fallback;
    }

    // ── Document search / sort / filter ──────────────────────────────────────

    partial void OnDocumentsChanged(ObservableCollection<ContractorDocument> _)
        => RefreshDocumentView();

    partial void OnDocumentSearchChanged(string _)
        => RefreshDocumentView();

    partial void OnSelectedDocSortLabelChanged(string _)
        => RefreshDocumentView();

    partial void OnSelectedDocFilterChanged(string _)
        => RefreshDocumentView();

    /// <summary>
    /// Fired when the user picks a different pack from the Picker.
    /// Sets Contractor.CompliancePackId in-memory (persisted on Save) and
    /// reloads the pack items + checklist without navigating away.
    /// The _packsLoaded guard prevents this from firing during initial data load.
    /// </summary>
    partial void OnSelectedPackLabelChanged(string value)
    {
        if (Contractor == null || !_packsLoaded) return;
        var pack = AvailablePacks.FirstOrDefault(p => p.Name == value);
        Contractor.CompliancePackId = pack?.Id;
        _ = LoadPackItemsAndRefreshAsync(pack?.Id);
    }

    /// <summary>
    /// Loads items for the given pack (or clears them when packId is null),
    /// then rebuilds the checklist + compliance overview.
    /// Fire-and-forget from OnSelectedPackLabelChanged.
    /// </summary>
    private async Task LoadPackItemsAndRefreshAsync(Guid? packId)
    {
        _loadedPackItems = packId.HasValue
            ? await _storage.GetCompliancePackItemsAsync(packId.Value)
            : [];

        RefreshDocumentView();
        OnPropertyChanged(nameof(PackLabels));
        OnPropertyChanged(nameof(HasPackAssigned));
    }

    /// <summary>
    /// Sets the active KPI strip filter. Clears to "all" when the same filter is tapped again
    /// (toggle behaviour), and refreshes the document view.
    /// </summary>
    [RelayCommand]
    private void SetDocFilter(string filter)
        => SelectedDocFilter = SelectedDocFilter == filter ? "all" : filter;

    /// <summary>
    /// Rebuilds FilteredDocuments from Documents applying current filter, search text and sort.
    /// Also notifies all KPI summary properties so the summary strip updates live.
    /// </summary>
    private void RefreshDocumentView()
    {
        var sortKey = DocSortKeysArr[
            Math.Max(0, Array.IndexOf(DocSortLabelsArr, SelectedDocSortLabel))];

        // 1 — status filter (applied first so counts drive the KPI strip)
        IEnumerable<ContractorDocument> query = SelectedDocFilter switch
        {
            "approved" => Documents.Where(d => d.IsApproved && !d.IsExpired),
            "pending"  => Documents.Where(d => d.IsPending),
            "rejected" => Documents.Where(d => d.IsRejected),
            "expired"  => Documents.Where(d => d.IsExpired),
            _          => Documents,  // "all"
        };

        // 2 — text search (stacks on top of status filter)
        if (!string.IsNullOrWhiteSpace(DocumentSearch))
            query = query.Where(d =>
                d.DocumentName.Contains(DocumentSearch, StringComparison.OrdinalIgnoreCase) ||
                d.TypeLabel.Contains(DocumentSearch, StringComparison.OrdinalIgnoreCase));

        // 3 — sort
        query = sortKey switch
        {
            "uploaded_asc"  => query.OrderBy(d => d.CreatedAt),
            "type_asc"      => query.OrderBy(d => d.TypeLabel),
            "expiry_asc"    => query.OrderBy(d => d.ExpiryDate ?? DateOnly.MaxValue),
            "status"        => query.OrderBy(d => d.ApprovalStatus == "pending" ? 0
                                                 : d.ApprovalStatus == "rejected" ? 1 : 2)
                                    .ThenBy(d => d.ExpiryDate ?? DateOnly.MaxValue),
            _               => query.OrderByDescending(d => d.CreatedAt), // uploaded_desc
        };

        FilteredDocuments = new ObservableCollection<ContractorDocument>(query);

        // Refresh KPI badge counts + filter highlight borders + empty-state message
        OnPropertyChanged(nameof(TotalDocuments));
        OnPropertyChanged(nameof(ApprovedDocCount));
        OnPropertyChanged(nameof(PendingDocCount));
        OnPropertyChanged(nameof(RejectedDocCount));
        OnPropertyChanged(nameof(ExpiredDocCount));
        OnPropertyChanged(nameof(FilterBorderAll));
        OnPropertyChanged(nameof(FilterBorderApproved));
        OnPropertyChanged(nameof(FilterBorderPending));
        OnPropertyChanged(nameof(FilterBorderRejected));
        OnPropertyChanged(nameof(FilterBorderExpired));
        OnPropertyChanged(nameof(DocEmptyMessage));

        // Phase 2B.3b — rebuild pack checklist (must run before RefreshComplianceOverview
        // so scoring can read PackChecklistRows when a pack is assigned)
        PackChecklistRows = _loadedPackItems.Count > 0
            ? BuildPackChecklist(_loadedPackItems, Documents)
            : [];
        OnPropertyChanged(nameof(PackRequiredCount));
        OnPropertyChanged(nameof(PackCompleteCount));
        OnPropertyChanged(nameof(PackMissingCount));
        OnPropertyChanged(nameof(HasPackAssigned));

        // Phase 2B.2 — rebuild compliance overview alongside the filter view
        RefreshComplianceOverview();
    }

    /// <summary>
    /// Builds a checklist row for every item in the assigned pack.
    /// Determines status by finding the best uploaded document for each document type:
    ///   approved + not expired  → complete
    ///   approved + expiring     → expiring  (still counts for score)
    ///   approved + expired      → expired
    ///   pending (no approved)   → pending
    ///   rejected (no better)    → rejected
    ///   nothing uploaded        → missing
    /// Required rows float to the top; recommended rows follow sorted by sort_order.
    /// </summary>
    private static ObservableCollection<PackChecklistRow> BuildPackChecklist(
        List<CompliancePackItem> packItems,
        ObservableCollection<ContractorDocument> docs)
    {
        var docsList = docs.ToList();

        var rows = packItems
            .OrderBy(i => !i.IsRequired)      // required first (false < true inverted)
            .ThenBy(i => i.SortOrder)
            .Select(item =>
            {
                var docsOfType = docsList
                    .Where(d => d.DocumentType == item.DocumentType && d.IsCurrent)
                    .ToList();

                string status;
                string? expiryDisplay = null;

                // Best approved: prefer non-expired, then non-expiring, then most recent
                var bestApproved = docsOfType
                    .Where(d => d.IsApproved)
                    .OrderBy(d => d.IsExpired)
                    .ThenBy(d => d.IsExpiringSoon)
                    .ThenByDescending(d => d.CreatedAt)
                    .FirstOrDefault();

                if (bestApproved != null)
                {
                    if (bestApproved.IsExpired)
                    {
                        status       = "expired";
                        expiryDisplay = bestApproved.ExpiryDisplay;
                    }
                    else if (bestApproved.IsExpiringSoon)
                    {
                        status       = "expiring";
                        expiryDisplay = bestApproved.ExpiryDisplay;
                    }
                    else
                    {
                        status       = "complete";
                        expiryDisplay = bestApproved.ExpiryDate.HasValue
                            ? bestApproved.ExpiryDisplay : null;
                    }
                }
                else if (docsOfType.Any(d => d.IsPending))
                {
                    status = "pending";
                }
                else if (docsOfType.Any(d => d.IsRejected))
                {
                    status = "rejected";
                }
                else
                {
                    status = "missing";
                }

                return new PackChecklistRow
                {
                    DocumentType = item.DocumentType,
                    TypeLabel    = item.TypeLabel,
                    IsRequired   = item.IsRequired,
                    Status       = status,
                    ExpiryDisplay = expiryDisplay,
                };
            });

        return new ObservableCollection<PackChecklistRow>(rows);
    }

    /// <summary>
    /// Computes all Compliance Overview display values from the raw Documents collection.
    /// Called every time RefreshDocumentView() runs so the dashboard stays in sync with
    /// any upload, approve, reject or delete action.
    /// No database calls — pure client-side computation.
    /// </summary>
    private void RefreshComplianceOverview()
    {
        if (_loadedPackItems.Count > 0)
        {
            // ── Pack-based scoring (Phase 2B.3b) ────────────────────────────
            // Uses PackChecklistRows (already rebuilt in RefreshDocumentView).
            // Score = required rows where CountsForScore / total required rows.
            var requiredRows = PackChecklistRows.Where(r => r.IsRequired).ToList();
            CompTotalRequired    = requiredRows.Count;
            CompValidRequired    = requiredRows.Count(r => r.CountsForScore);
            CompExpiringRequired = requiredRows.Count(r => r.Status == "expiring");
            CompExpiredRequired  = requiredRows.Count(r => r.Status == "expired");
            CompPendingRequired  = requiredRows.Count(r => r.Status == "pending");
            CompRejectedRequired = requiredRows.Count(r => r.Status == "rejected");
            CompHasRequiredDocs  = CompTotalRequired > 0;  // pack always defines requirements
            CompHasIssues        = CompExpiredRequired > 0 || CompPendingRequired > 0 || CompRejectedRequired > 0;
        }
        else
        {
            // ── Legacy scoring (Phase 2B.2) ──────────────────────────────────
            // No pack assigned: use is_required per-document (original behaviour).
            var req = Documents.Where(d => d.IsRequired).ToList();
            CompTotalRequired    = req.Count;
            CompValidRequired    = req.Count(d => d.IsApproved && !d.IsExpired);
            CompExpiringRequired = req.Count(d => d.IsApproved && d.IsExpiringSoon && !d.IsExpired);
            CompExpiredRequired  = req.Count(d => d.IsExpired);
            CompPendingRequired  = req.Count(d => d.IsPending);
            CompRejectedRequired = req.Count(d => d.IsRejected);
            CompHasRequiredDocs  = CompTotalRequired > 0;
            CompHasIssues        = CompExpiredRequired > 0 || CompPendingRequired > 0 || CompRejectedRequired > 0;
        }

        CompScorePercent  = CompTotalRequired == 0 ? 0
            : (int)Math.Round(CompValidRequired * 100.0 / CompTotalRequired);
        CompScoreProgress = CompTotalRequired == 0 ? 0.0
            : Math.Round(CompValidRequired / (double)CompTotalRequired, 2);
        CompRequiredValidLabel = $"{CompValidRequired}/{CompTotalRequired}";

        var (label, bg, fg, scoreColor) = !CompHasRequiredDocs
            ? ("Not Configured", "#1E293B", "#64748B", "#64748B")
            : CompScorePercent >= 100
                ? ("Compliant",      "#14532D", "#22C55E", "#22C55E")
                : CompScorePercent >= 80
                    ? ("Near Compliant", "#14532D", "#86EFAC", "#22C55E")
                    : CompScorePercent >= 50
                        ? ("Partial",        "#78350F", "#FCD34D", "#FCD34D")
                        : ("Non-Compliant",  "#7F1D1D", "#FCA5A5", "#EF4444");
        CompStatusLabel   = label;
        CompStatusBadgeBg = bg;
        CompStatusBadgeFg = fg;
        CompScoreColor    = scoreColor;

        // Expiring-soon: approved docs whose expiry falls within 30 days (not yet expired)
        ExpiringDocuments = new ObservableCollection<ContractorDocument>(
            Documents.Where(d => d.IsExpiringSoon && !d.IsExpired)
                     .OrderBy(d => d.ExpiryDate));

        // Expired: all expired docs — required ones float to the top
        ExpiredDocuments = new ObservableCollection<ContractorDocument>(
            Documents.Where(d => d.IsExpired)
                     .OrderByDescending(d => d.IsRequired)
                     .ThenBy(d => d.ExpiryDate));

        // Notify all compliance overview properties
        OnPropertyChanged(nameof(CompTotalRequired));
        OnPropertyChanged(nameof(CompValidRequired));
        OnPropertyChanged(nameof(CompExpiringRequired));
        OnPropertyChanged(nameof(CompExpiredRequired));
        OnPropertyChanged(nameof(CompPendingRequired));
        OnPropertyChanged(nameof(CompRejectedRequired));
        OnPropertyChanged(nameof(CompScorePercent));
        OnPropertyChanged(nameof(CompScoreProgress));
        OnPropertyChanged(nameof(CompRequiredValidLabel));
        OnPropertyChanged(nameof(CompStatusLabel));
        OnPropertyChanged(nameof(CompStatusBadgeBg));
        OnPropertyChanged(nameof(CompStatusBadgeFg));
        OnPropertyChanged(nameof(CompScoreColor));
        OnPropertyChanged(nameof(CompHasRequiredDocs));
        OnPropertyChanged(nameof(CompHasIssues));
    }

    public bool IsNew =>
        string.IsNullOrWhiteSpace(ContractorId) ||
        ContractorId.Equals("new", StringComparison.OrdinalIgnoreCase) ||
        !Guid.TryParse(ContractorId, out var id) ||
        id == Guid.Empty;

    public bool IsSupplierMode =>
        PartnerKinds.IsSupplierKind(PartnerKind) && !PartnerKinds.IsContractorKind(PartnerKind);

    public bool ShowMembersSection =>
        !IsNew && PartnerKinds.IsContractorKind(Contractor?.PartnerKindRaw ?? PartnerKind);

    public bool ShowPortalCodeSection =>
        Contractor != null && PartnerKinds.IsContractorKind(Contractor.PartnerKindRaw);
    public bool ShowDocumentsSection => !IsNew;
    public IReadOnlyList<string> PartnerKindLabels => PartnerKinds.KindLabels;

    // ── Phase 2C / 2D.5: Tab state ───────────────────────────────────────────

    [ObservableProperty] private string _activeTab = "information";

    public bool IsInformationTab => ActiveTab == "information";
    public bool IsComplianceTab  => ActiveTab == "compliance";
    public bool IsPaymentsTab    => ActiveTab == "payments";
    public bool IsTeamTab        => ActiveTab == "team";
    public bool IsJobsTab        => ActiveTab == "jobs";       // Phase 2D.5
    public bool IsProjectsTab    => ActiveTab == "projects";   // Phase 2D.5
    public bool IsIncidentsTab   => ActiveTab == "incidents";  // Phase 2D.5
    public bool IsActivityTab    => ActiveTab == "activity";
    public bool IsQuotesTab      => ActiveTab == "quotes";
    public bool IsInvoicesTab    => ActiveTab == "invoices";

    // ── Contractor Jobs (Phase A — job_contractors join table) ───────────────
    [ObservableProperty] private System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.JobContractor> _contractorJobs = [];
    [ObservableProperty] private bool _jobsLoading;
    [ObservableProperty] private bool _jobsLoaded;
    // Company-wide projects loaded alongside the jobs tab; reused by quote conversion.
    private List<KaiFlow.Timesheets.Models.ClientDeal> _companyProjects = [];

    // ── Contractor Projects (Phase A — project_contractors join table) ───────
    [ObservableProperty] private System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.ProjectContractor> _contractorProjects = [];
    [ObservableProperty] private bool _projectsLoading;
    [ObservableProperty] private bool _projectsLoaded;

    // ── Contractor Incidents (Phase 2D.5) ─────────────────────────────────────
    [ObservableProperty] private System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.IncidentReport> _contractorIncidents = [];
    [ObservableProperty] private bool _incidentsLoading;
    [ObservableProperty] private bool _incidentsLoaded;

    // ── Phase 2C: Activity feed ───────────────────────────────────────────────

    /// <summary>Full feed from DB (source for filtering).</summary>
    private List<ContractorActivityEntry> _allActivityEvents = [];

    /// <summary>Filtered view shown in the Activity tab.</summary>
    [ObservableProperty] private System.Collections.ObjectModel.ObservableCollection<ContractorActivityEntry> _activityEvents = [];

    [ObservableProperty] private bool _activityLoading;
    [ObservableProperty] private bool _activityLoaded;

    // Filter state — Picker uses display labels directly as values.
    // "All" is the default; other options match display labels in ActivityFilterOptions.
    [ObservableProperty] private string _activityFilter = "All";

    /// <summary>Options list bound to the filter Picker in the Activity tab.</summary>
    public IReadOnlyList<string> ActivityFilterOptions { get; } =
        ["All", "Profile", "Documents", "Compliance", "Payments", "Portal"];

    partial void OnActivityFilterChanged(string _) => ApplyActivityFilter();

    private void ApplyActivityFilter()
    {
        var filtered = ActivityFilter switch
        {
            "Profile"    => _allActivityEvents.Where(e => e.Category == "profile"),
            "Documents"  => _allActivityEvents.Where(e => e.Category == "documents"),
            "Compliance" => _allActivityEvents.Where(e => e.Category == "compliance"),
            "Payments"   => _allActivityEvents.Where(e => e.Category == "payments"),
            "Portal"     => _allActivityEvents.Where(e => e.IsPortalEvent),
            _            => _allActivityEvents.AsEnumerable(),   // "All"
        };
        ActivityEvents = new System.Collections.ObjectModel.ObservableCollection<ContractorActivityEntry>(filtered);
    }

    private async Task LoadActivityFeedAsync(Guid companyId, Guid contractorId)
    {
        if (ActivityLoading) return;
        ActivityLoading = true;
        try
        {
            var events = await _storage.GetContractorActivityFeedAsync(companyId, contractorId);
            _allActivityEvents = events;
            ApplyActivityFilter();
            ActivityLoaded = true;
        }
        catch { /* non-fatal — tab shows empty state */ }
        finally
        {
            ActivityLoading = false;
        }
    }

    // ── Tab state ─────────────────────────────────────────────────────────────

    partial void OnActiveTabChanged(string tab)
    {
        NotifyTabFlags();

        // Close HR quote detail when leaving Quotes tab
        if (tab != "quotes") HrQuoteDetailVisible = false;

        if (IsNew || Contractor == null) return;
        var companyId    = _state.CurrentEmployee!.CompanyId;
        var contractorId = Contractor.Id;

        // Lazy-load each operational tab the first time it is opened
        if (tab == "activity" && !ActivityLoaded && !ActivityLoading)
            _ = LoadActivityFeedAsync(companyId, contractorId);

        if (tab == "jobs" && !JobsLoaded && !JobsLoading)
            _ = LoadContractorJobsAsync(companyId, contractorId);

        if (tab == "projects" && !ProjectsLoaded && !ProjectsLoading)
            _ = LoadContractorProjectsAsync(companyId, contractorId);

        if (tab == "incidents" && !IncidentsLoaded && !IncidentsLoading)
            _ = LoadContractorIncidentsAsync(companyId, contractorId);
    }

    private void NotifyTabFlags()
    {
        OnPropertyChanged(nameof(IsInformationTab));
        OnPropertyChanged(nameof(IsComplianceTab));
        OnPropertyChanged(nameof(IsPaymentsTab));
        OnPropertyChanged(nameof(IsTeamTab));
        OnPropertyChanged(nameof(IsJobsTab));
        OnPropertyChanged(nameof(IsProjectsTab));
        OnPropertyChanged(nameof(IsIncidentsTab));
        OnPropertyChanged(nameof(IsActivityTab));
        OnPropertyChanged(nameof(IsQuotesTab));
        OnPropertyChanged(nameof(IsInvoicesTab));
    }

    [RelayCommand] private void ShowInformationTab() => ActiveTab = "information";
    [RelayCommand] private void ShowComplianceTab()  => ActiveTab = "compliance";
    [RelayCommand] private void ShowPaymentsTab()    => ActiveTab = "payments";
    [RelayCommand] private void ShowTeamTab()        => ActiveTab = "team";
    [RelayCommand] private void ShowJobsTab()        => ActiveTab = "jobs";
    [RelayCommand] private void ShowProjectsTab()    => ActiveTab = "projects";
    [RelayCommand] private void ShowIncidentsTab()   => ActiveTab = "incidents";
    [RelayCommand] private void ShowActivityTab()    => ActiveTab = "activity";
    [RelayCommand] private void ShowQuotesTab()      => ActiveTab = "quotes";
    [RelayCommand] private void ShowInvoicesTab()    => ActiveTab = "invoices";

    // ── Jobs tab data loading (Phase A — job_contractors join table) ──────────

    private async Task LoadContractorJobsAsync(Guid companyId, Guid contractorId)
    {
        if (JobsLoading) return;
        JobsLoading = true;
        try
        {
            // Primary source: job_contractors join table (has agreed_amount, quote_id, etc.)
            var assignments = await _storage.GetContractorAssignmentsAsync(companyId, contractorId);

            // Fallback: jobs where contractor_id matches but no job_contractors row exists.
            // Covers jobs created before the Phase A fix, or any future write-path gap.
            var allJobs = await _storage.GetJobsAsync(companyId);
            var assignedJobIds = assignments.Select(a => a.JobId).ToHashSet();
            var fallbackJobs = allJobs
                .Where(j => j.ContractorId == contractorId && !assignedJobIds.Contains(j.Id))
                .ToList();

            // Wrap fallback jobs as synthetic JobContractor rows so the same XAML template works.
            var synthetic = fallbackJobs.Select(j => new KaiFlow.Timesheets.Models.JobContractor
            {
                Id           = Guid.Empty,
                CompanyId    = companyId,
                JobId        = j.Id,
                ContractorId = contractorId,
                QuoteId      = j.SourceQuoteId,
                Role         = "general",
                AgreedAmount = (decimal)j.ContractorCost,
                QuotedAmount = (decimal)j.ContractorCost,
                StatusRaw    = "assigned",
                AssignedAt   = j.OpenedAt ?? j.CreatedAt,
                CreatedAt    = j.CreatedAt,
                UpdatedAt    = j.UpdatedAt,
                Job          = j,
            }).ToList();

            var merged = assignments.Concat(synthetic)
                .OrderByDescending(a => a.AssignedAt)
                .ToList();

            // Build a project lookup enriched with client names.
            var projects = await _storage.GetClientDealsAsync(companyId);
            var clients  = await _storage.GetClientsAsync(companyId);
            var clientById = clients.ToDictionary(c => c.Id);
            foreach (var d in projects)
                if (d.ClientId.HasValue && clientById.TryGetValue(d.ClientId.Value, out var cl))
                    d.ClientName = cl.Name;

            _companyProjects = projects;

            var projectLookup = projects.ToDictionary(d => d.Id, d => d.PickerDisplay);
            foreach (var a in merged)
                if (a.Job?.DealId is Guid dealId && projectLookup.TryGetValue(dealId, out var display))
                    a.JobProjectDisplay = display;

            // Phase G: enrich with paid/approved/pending totals
            var payouts = await _storage.GetContractorPayoutsAsync(companyId, contractorId: contractorId);
            foreach (var a in merged)
            {
                var rp = a.Id != Guid.Empty
                    ? payouts.Where(p => p.JobContractorId == a.Id).ToList()
                    : payouts.Where(p => p.JobId == a.JobId && p.ContractorId == a.ContractorId
                                      && !p.JobContractorId.HasValue).ToList();
                a.PaidAmount     = rp.Where(p => p.PayoutStatusRaw == "paid")    .Sum(p => p.TotalAmount);
                a.ApprovedAmount = rp.Where(p => p.PayoutStatusRaw == "approved").Sum(p => p.TotalAmount);
                a.PendingAmount  = rp.Where(p => p.PayoutStatusRaw == "pending") .Sum(p => p.TotalAmount);
            }

            await MainThread.InvokeOnMainThreadAsync(() =>
                ContractorJobs = new System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.JobContractor>(merged));
            JobsLoaded = true;
        }
        catch { /* non-fatal — empty state shows */ }
        finally { JobsLoading = false; }
    }

    [RelayCommand]
    private static async Task OpenContractorJobAsync(KaiFlow.Timesheets.Models.JobContractor assignment)
    {
        if (assignment?.Job == null) return;
        try { await ShellNavigation.GoToAsync($"{nameof(HrJobDetailsPage)}?JobId={assignment.Job.Id}"); }
        catch { /* page may not be registered in current shell route */ }
    }

    [RelayCommand]
    private static async Task OpenJobContractorDocsAsync(KaiFlow.Timesheets.Models.JobContractor assignment)
    {
        if (assignment == null) return;
        try { await ShellNavigation.GoToAsync($"{nameof(HrJobContractorDocsPage)}?jobContractorId={assignment.Id}"); }
        catch { /* page may not be registered in current shell route */ }
    }

    // ── Projects tab data loading (Phase A — project_contractors join table) ──

    private async Task LoadContractorProjectsAsync(Guid companyId, Guid contractorId)
    {
        if (ProjectsLoading) return;
        ProjectsLoading = true;
        try
        {
            var projects = await _storage.GetContractorProjectsAsync(companyId, contractorId);
            await MainThread.InvokeOnMainThreadAsync(() =>
                ContractorProjects = new System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.ProjectContractor>(projects));
            ProjectsLoaded = true;
        }
        catch { /* non-fatal — empty state shows */ }
        finally { ProjectsLoading = false; }
    }

    [RelayCommand]
    private static async Task OpenContractorProjectAsync(KaiFlow.Timesheets.Models.ProjectContractor assignment)
    {
        if (assignment == null) return;
        try
        {
            await ShellNavigation.GoToAsync(
                nameof(KaiFlow.Timesheets.Views.Hr.HrProjectDetailPage),
                new System.Collections.Generic.Dictionary<string, object>
                    { ["DealId"] = assignment.DealId.ToString() });
        }
        catch { /* page may not be registered in current shell route */ }
    }

    // ── Incidents tab data loading ────────────────────────────────────────────

    private async Task LoadContractorIncidentsAsync(Guid companyId, Guid contractorId)
    {
        if (IncidentsLoading) return;
        IncidentsLoading = true;
        try
        {
            var all  = await _storage.GetIncidentsAsync(companyId, includeClosed: true);
            var mine = all.Where(i => i.ContractorId == contractorId)
                          .OrderByDescending(i => i.OccurredAt ?? i.CreatedAt)
                          .ToList();
            await MainThread.InvokeOnMainThreadAsync(() =>
                ContractorIncidents = new System.Collections.ObjectModel.ObservableCollection<KaiFlow.Timesheets.Models.IncidentReport>(mine));
            IncidentsLoaded = true;
        }
        catch { /* non-fatal — empty state shows */ }
        finally { IncidentsLoading = false; }
    }

    [RelayCommand]
    private static async Task OpenContractorIncidentAsync(KaiFlow.Timesheets.Models.IncidentReport incident)
    {
        if (incident == null) return;
        try
        {
            await ShellNavigation.GoToAsync(nameof(HrIncidentDetailsPage),
                new System.Collections.Generic.Dictionary<string, object>
                    { ["incidentId"] = incident.Id.ToString() });
        }
        catch { /* page may not be registered in current shell route */ }
    }

    public HrContractorDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Partner";
    }

    public async Task LoadAsync()
    {
        // Reset lazy-load guards so navigating away and back always shows fresh data.
        JobsLoaded     = false;
        ProjectsLoaded = false;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            _allEmployees = (await _storage.GetEmployeesAsync(companyId)).Where(e => e.IsActive).ToList();

            if (IsNew)
            {
                Contractor = new Contractor
                {
                    CompanyId = companyId,
                    PartnerKindRaw = string.IsNullOrWhiteSpace(PartnerKind) ? PartnerKinds.Contractor : PartnerKind,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };
                IsVatRegistered = false;
                ContractorRating = 0;
                // Phase 2A defaults for new records
                PaymentHold = false;
                ComplianceHold = false;
                BankingVerified = false;
                SelectedAccountTypeLabel   = "Cheque";
                SelectedPaymentTermsLabel  = "30 Days";
                SelectedPaymentMethodLabel = "EFT";
                SelectedPartnerKindLabel = PartnerKinds.LabelFor(Contractor.PartnerKindRaw);
                Title = IsSupplierMode ? "New Supplier" : "New Contractor";
                Members = [];
                return;
            }

            if (!Guid.TryParse(ContractorId, out var cid)) return;
            Contractor = await _storage.GetContractorByIdAsync(companyId, cid);
            if (Contractor == null) return;

            // Sync observable proxies from loaded model.
            IsVatRegistered = Contractor.IsVatRegistered;
            ContractorRating = Contractor.Rating;
            // Phase 2A proxies
            PaymentHold = Contractor.PaymentHold;
            ComplianceHold = Contractor.ComplianceHold;
            BankingVerified = Contractor.BankingVerified;
            SelectedAccountTypeLabel   = LabelFor(AccountTypeRaw, AccountTypeLbls,  Contractor.AccountType, "Cheque");
            SelectedPaymentTermsLabel  = LabelFor(PaymentTermsRaw, PaymentTermsLbls, Contractor.PaymentTerms, "30 Days");
            SelectedPaymentMethodLabel = LabelFor(PaymentMethodRaw, PaymentMethodLbls, Contractor.PreferredPaymentMethod, "EFT");
            _originalIsActive = Contractor.IsActive; // capture for deactivation confirmation
            PartnerKind = Contractor.PartnerKindRaw;
            SelectedPartnerKindLabel = PartnerKinds.LabelFor(Contractor.PartnerKindRaw);
            Title = Contractor.Name;
            if (ShowPortalCodeSection && string.IsNullOrWhiteSpace(Contractor.ContractorCode))
                Contractor.ContractorCode = await _storage.GenerateNextContractorCodeAsync(companyId);

            var nameMap = _allEmployees.ToDictionary(e => e.Id, e => e.FullName);
            var links = await _storage.GetContractorMemberLinksAsync(Contractor.Id);
            Members = new ObservableCollection<ContractorMemberDisplay>(
                links.Select(l => new ContractorMemberDisplay(l, nameMap.GetValueOrDefault(l.EmployeeId, "Unknown"))));

            // Phase 2B.1 — load compliance documents
            var docs = await _storage.GetContractorDocumentsAsync(companyId, Contractor.Id);
            Documents = new ObservableCollection<ContractorDocument>(docs);

            // Phase 2B.3b — load available packs for the picker
            // GetCompliancePacksAsync seeds 6 SA defaults on first call (idempotent).
            var packs = await _storage.GetCompliancePacksAsync(companyId);
            AvailablePacks = new ObservableCollection<CompliancePack>(packs);
            OnPropertyChanged(nameof(PackLabels));

            // If contractor already has a pack assigned, pre-load its items and
            // set the picker label WITHOUT triggering OnSelectedPackLabelChanged
            // (backing-field write skips the hook — avoids a redundant DB round-trip).
            if (Contractor.CompliancePackId.HasValue)
            {
                var assigned = packs.FirstOrDefault(p => p.Id == Contractor.CompliancePackId.Value);
                if (assigned != null)
                {
                    _loadedPackItems   = await _storage.GetCompliancePackItemsAsync(assigned.Id);
                    _selectedPackLabel = assigned.Name;   // back-field, no hook
                    OnPropertyChanged(nameof(SelectedPackLabel));
                }
            }

            _packsLoaded = true;
            OnPropertyChanged(nameof(HasPackAssigned));

            // Rebuild checklist + scoring now that pack items are available
            RefreshDocumentView();

            // Phase 2C.3 — load pending banking update for Payments tab card
            var pendingBanking = await _storage.GetContractorPendingBankingAsync(companyId, Contractor.Id);
            PendingBankingUpdate = pendingBanking;

            // Phase 2D.2 — load quotes for Quotes tab
            var quotes = await _storage.GetContractorQuotesAsync(companyId, Contractor.Id);
            ContractorQuotes = new ObservableCollection<ContractorQuote>(quotes);
        });

        // Race-condition guard: if the user tapped a lazy-loaded tab before LoadAsync
        // finished (Contractor was null at that point, so OnActiveTabChanged returned
        // early without triggering the load), trigger it now that Contractor is set.
        if (Contractor != null && !IsNew)
        {
            var companyId    = _state.CurrentEmployee?.CompanyId ?? Guid.Empty;
            var contractorId = Contractor.Id;
            if      (ActiveTab == "jobs"      && !JobsLoaded      && !JobsLoading)
                _ = LoadContractorJobsAsync(companyId, contractorId);
            else if (ActiveTab == "projects"  && !ProjectsLoaded  && !ProjectsLoading)
                _ = LoadContractorProjectsAsync(companyId, contractorId);
            else if (ActiveTab == "incidents" && !IncidentsLoaded && !IncidentsLoading)
                _ = LoadContractorIncidentsAsync(companyId, contractorId);
            else if (ActiveTab == "activity"  && !ActivityLoaded  && !ActivityLoading)
                _ = LoadActivityFeedAsync(companyId, contractorId);
        }
    }

    // ── Phase 2C.3: Pending banking update (HR Payments tab) ─────────────────

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasPendingBankingUpdate))]
    private ContractorBankingUpdate? _pendingBankingUpdate;

    public bool HasPendingBankingUpdate => PendingBankingUpdate != null;

    // ── Phase 2D.2 / 2D.3: Contractor Quotes (HR view) ──────────────────────

    [ObservableProperty] private ObservableCollection<ContractorQuote> _contractorQuotes = [];
    [ObservableProperty] private ContractorQuote? _selectedHrQuote;
    [ObservableProperty] private ObservableCollection<ContractorQuoteItem>       _hrQuoteItems       = [];
    [ObservableProperty] private ObservableCollection<ContractorQuoteAttachment> _hrQuoteAttachments = [];
    [ObservableProperty] private bool _hrQuoteDetailVisible;

    public bool HrQuoteIsManual    => SelectedHrQuote?.IsManual     ?? false;
    public bool HrQuoteIsUpload    => SelectedHrQuote?.IsUpload     ?? false;
    /// <summary>Show Approve / Reject / Request Revision buttons.</summary>
    public bool HrQuoteIsReviewable => SelectedHrQuote?.IsReviewable ?? false;
    /// <summary>Show "Convert to Job" button — approved and not yet converted.</summary>
    public bool HrQuoteCanConvert   => SelectedHrQuote?.CanConvert   ?? false;
    /// <summary>Show "Converted" banner — already converted to a job.</summary>
    public bool HrQuoteIsConverted  => SelectedHrQuote?.IsConverted  ?? false;

    partial void OnSelectedHrQuoteChanged(ContractorQuote? value)
    {
        OnPropertyChanged(nameof(HrQuoteIsManual));
        OnPropertyChanged(nameof(HrQuoteIsUpload));
        OnPropertyChanged(nameof(HrQuoteIsReviewable));
        OnPropertyChanged(nameof(HrQuoteCanConvert));
        OnPropertyChanged(nameof(HrQuoteIsConverted));
    }

    [RelayCommand]
    private async Task OpenHrQuoteAsync(ContractorQuote quote)
    {
        if (quote == null || IsNew) return;
        SelectedHrQuote      = quote;
        HrQuoteDetailVisible = true;
        HrQuoteItems         = [];
        HrQuoteAttachments   = [];

        await RunAsync(async () =>
        {
            if (quote.IsManual)
            {
                var items = await _storage.GetContractorQuoteItemsAsync(quote.Id);
                HrQuoteItems = new ObservableCollection<ContractorQuoteItem>(items);
            }
            else
            {
                var atts = await _storage.GetContractorQuoteAttachmentsAsync(quote.Id);
                HrQuoteAttachments = new ObservableCollection<ContractorQuoteAttachment>(atts);
            }

            // Auto-start review: submitted → under_review when HR opens the quote
            if (quote.Status == "submitted" && Contractor != null)
            {
                var companyId = _state.CurrentEmployee!.CompanyId;
                var hrUserId  = _state.CurrentEmployee.Id;
                try
                {
                    await _storage.HrStartQuoteReviewAsync(companyId, hrUserId, quote.Id);
                    var refreshed = await _storage.GetContractorQuotesAsync(companyId, Contractor.Id);
                    var updated   = refreshed.FirstOrDefault(q => q.Id == quote.Id);
                    await MainThread.InvokeOnMainThreadAsync(() =>
                    {
                        ContractorQuotes = new System.Collections.ObjectModel.ObservableCollection<ContractorQuote>(refreshed);
                        if (updated != null) SelectedHrQuote = updated;
                        OnPropertyChanged(nameof(HrQuoteIsReviewable));
                    });
                }
                catch { /* non-critical — status will still show submitted */ }
            }
        });
    }

    [RelayCommand]
    private void CloseHrQuoteDetail()
    {
        HrQuoteDetailVisible = false;
        SelectedHrQuote      = null;
    }

    [RelayCommand]
    private static async Task ViewHrQuoteDocumentAsync(ContractorQuoteAttachment att)
    {
        if (att == null || string.IsNullOrWhiteSpace(att.FileUrl)) return;
        try { await Launcher.OpenAsync(new Uri(att.FileUrl)); }
        catch { /* unavailable */ }
    }

    // ── Phase 2D.3: HR review actions ────────────────────────────────────────

    [RelayCommand]
    private async Task ApproveContractorQuoteAsync()
    {
        if (SelectedHrQuote == null || Contractor == null) return;

        var confirmed = await Shell.Current.DisplayAlert(
            "Approve Quote",
            $"Approve quote '{SelectedHrQuote.Title}' from {Contractor.Name}?\n\n" +
            $"Total: {SelectedHrQuote.TotalDisplay}\n\n" +
            "The contractor will be notified.",
            "Approve", "Cancel");
        if (!confirmed) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        var hrUserId  = _state.CurrentEmployee.Id;
        var quoteId   = SelectedHrQuote.Id;
        var title     = SelectedHrQuote.Title;

        bool success = false;
        await RunAsync(async () =>
        {
            await _storage.HrApproveContractorQuoteAsync(companyId, hrUserId, quoteId, null);
            await RefreshHrQuoteAfterActionAsync(companyId, quoteId);
            success = true;
        });
        if (success)
        {
            // Phase L: combine approval confirmation + payout draft offer in one dialog.
            var quoteForDraft = SelectedHrQuote;
            var createDraft = await Shell.Current.DisplayAlert(
                "Quote Approved",
                $"'{title}' has been approved and the contractor will be notified.\n\n" +
                $"Create a pending payout draft for {quoteForDraft?.TotalDisplay ?? "this amount"} now?",
                "Create Draft", "Skip");

            if (createDraft && quoteForDraft != null)
            {
                await RunAsync(async () =>
                {
                    await _storage.CreateContractorPayoutAsync(new ContractorPayout
                    {
                        CompanyId       = companyId,
                        ContractorId    = quoteForDraft.ContractorId,
                        JobId           = quoteForDraft.ConvertedToJobId,
                        QuoteId         = quoteForDraft.Id,
                        Subtotal        = quoteForDraft.TaxableAmount > 0 ? quoteForDraft.TaxableAmount : quoteForDraft.Subtotal,
                        VatRate         = quoteForDraft.VatRate,
                        VatAmount       = quoteForDraft.VatAmount,
                        TotalAmount     = quoteForDraft.TotalAmount,
                        IsVatInclusive  = quoteForDraft.IsVatInclusive,
                        RetentionAmount = 0m,
                        PayoutStatusRaw = "pending",
                        CreatedBy       = _state.CurrentEmployee?.Id,
                        Notes           = $"Auto-drafted from approved quote: {quoteForDraft.Title}"
                    });
                });
                if (ErrorMessage == null)
                    await Shell.Current.DisplayAlert("Payout Draft Created",
                        "A pending payout draft has been created.\nGo to Finance › Contractor Payouts to review and submit for payment.",
                        "OK");
            }
        }
    }

    [RelayCommand]
    private async Task RejectContractorQuoteAsync()
    {
        if (SelectedHrQuote == null || Contractor == null) return;

        var reason = await Shell.Current.DisplayPromptAsync(
            "Reject Quote",
            $"Provide a reason for rejecting '{SelectedHrQuote.Title}'.\n" +
            "The contractor will be notified.",
            accept: "Reject", cancel: "Cancel",
            placeholder: "e.g. Pricing too high, please resubmit...",
            maxLength: 500);
        if (string.IsNullOrWhiteSpace(reason)) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        var hrUserId  = _state.CurrentEmployee.Id;
        var quoteId   = SelectedHrQuote.Id;
        var title     = SelectedHrQuote.Title;

        bool success = false;
        await RunAsync(async () =>
        {
            await _storage.HrRejectContractorQuoteAsync(companyId, hrUserId, quoteId, reason.Trim());
            await RefreshHrQuoteAfterActionAsync(companyId, quoteId);
            success = true;
        });
        if (success)
            await Shell.Current.DisplayAlert("Quote Rejected",
                $"'{title}' has been rejected. The contractor will be notified.", "OK");
    }

    [RelayCommand]
    private async Task RequestQuoteRevisionAsync()
    {
        if (SelectedHrQuote == null || Contractor == null) return;

        var comments = await Shell.Current.DisplayPromptAsync(
            "Request Revision",
            $"Describe what changes are needed for '{SelectedHrQuote.Title}'.\n" +
            "The contractor will see these comments and can edit the quote before resubmitting.",
            accept: "Send", cancel: "Cancel",
            placeholder: "e.g. Please itemise labour and materials separately...",
            maxLength: 1000);
        if (string.IsNullOrWhiteSpace(comments)) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        var hrUserId  = _state.CurrentEmployee.Id;
        var quoteId   = SelectedHrQuote.Id;
        var title     = SelectedHrQuote.Title;

        bool success = false;
        await RunAsync(async () =>
        {
            await _storage.HrRequestQuoteRevisionAsync(companyId, hrUserId, quoteId, comments.Trim());
            await RefreshHrQuoteAfterActionAsync(companyId, quoteId);
            success = true;
        });
        if (success)
            await Shell.Current.DisplayAlert("Revision Requested",
                $"Revision comments sent for '{title}'. The contractor will be notified.", "OK");
    }

    /// <summary>
    /// Reloads the contractor's quote list from DB and updates SelectedHrQuote on the
    /// main thread so status badge and action-button visibility refresh immediately.
    ///
    /// ROOT-CAUSE FIX for stale action buttons:
    /// The previous implementation set ObservableCollection + SelectedHrQuote from a
    /// background thread (inside RunAsync). On WinUI, INotifyPropertyChanged raised off
    /// the UI thread can be silently dropped by the binding infrastructure.
    /// Fix: wrap ALL property mutations in MainThread.InvokeOnMainThreadAsync.
    /// </summary>
    // ── Phase 2D.4 / 2D.5: Quote → Job (create new or assign existing) ──────────

    /// <summary>
    /// Create a new job from the approved quote (Phase 2D.4 — original command, renamed).
    /// </summary>
    [RelayCommand]
    private async Task CreateNewJobFromQuoteAsync()
    {
        if (SelectedHrQuote == null || Contractor == null) return;
        if (!SelectedHrQuote.CanConvert) return;

        var quote      = SelectedHrQuote;
        var jobTitle   = quote.Title;
        var totalStr   = quote.TotalDisplay;
        var companyId  = _state.CurrentEmployee!.CompanyId;
        var hrUserId   = _state.CurrentEmployee.Id;
        var quoteId    = quote.Id;
        var contractorId = Contractor.Id;

        // Optional project selection — load if not already available from the jobs tab.
        if (_companyProjects.Count == 0)
        {
            var deals   = await _storage.GetClientDealsAsync(companyId);
            var clients = await _storage.GetClientsAsync(companyId);
            var cById   = clients.ToDictionary(c => c.Id);
            foreach (var d in deals)
                if (d.ClientId.HasValue && cById.TryGetValue(d.ClientId.Value, out var cl))
                    d.ClientName = cl.Name;
            _companyProjects = deals;
        }

        var activeProjects = _companyProjects
            .Where(d => d.StatusRaw is not ("won" or "lost"))
            .OrderBy(d => d.ProjectCode)
            .ThenBy(d => d.Title)
            .ToList();

        KaiFlow.Timesheets.Models.ClientDeal? selectedDeal = null;
        if (activeProjects.Count > 0)
        {
            var options = activeProjects.Select(d => d.PickerDisplay).Prepend("No project").ToArray();
            var picked  = await Shell.Current.DisplayActionSheetAsync("Link to project (optional)", "Cancel", null, options);
            if (picked == null || picked == "Cancel") return;
            if (picked != "No project")
                selectedDeal = activeProjects.FirstOrDefault(d => d.PickerDisplay == picked);
        }

        var projectLine = selectedDeal != null ? $"\n  Project:      {selectedDeal.PickerDisplay}" : "";
        var confirmed = await Shell.Current.DisplayAlert(
            "Create New Job",
            $"A new job will be created with the following details:\n\n" +
            $"  Job Title:    {jobTitle}\n" +
            $"  Contractor:   {Contractor.Name}\n" +
            $"  Est. Cost:    {totalStr}{projectLine}\n\n" +
            "The job will be created in Scheduled status.",
            "Create Job", "Cancel");
        if (!confirmed) return;

        var desc = string.IsNullOrWhiteSpace(quote.ContractorNotes)
                   ? quote.Description
                   : quote.ContractorNotes;

        // ── Execute: single RPC call writes job + job_contractors + project_contractors atomically.
        // RefreshHrQuoteAfterActionAsync runs in a SEPARATE RunAsync so it always executes
        // regardless of what happens inside the first one.
        (Guid jobId, string jobCode) result = default;
        bool rpcSucceeded = false;

        await RunAsync(async () =>
        {
            result = await _storage.HrConvertQuoteToJobAsync(
                companyId, hrUserId, quoteId,
                jobTitle, desc, "normal",
                null, null,
                dealId: selectedDeal?.Id);          // ← RPC writes job + both join tables atomically

            rpcSucceeded = true;

            // Invalidate tab caches so they reload fresh on next open.
            JobsLoaded     = false;
            ProjectsLoaded = false;
        });

        // Refresh quote list on UI thread — ALWAYS runs after the RPC attempt,
        // even if something else in RunAsync failed. This ensures the quote
        // immediately shows "Converted" without the user needing to click Save.
        await RefreshHrQuoteAfterActionAsync(companyId, quoteId);

        if (rpcSucceeded)
            await Shell.Current.DisplayAlert(
                "Job Created",
                $"Job {result.jobCode} has been created from this quote.\n\n" +
                "The quote is now marked as Converted To Job.",
                "OK");
    }

    /// <summary>
    /// Assign the approved quote to an already-existing job (Phase 2D.5).
    /// Loads open jobs, shows a picker, then confirms the assignment.
    /// </summary>
    [RelayCommand]
    private async Task AssignToExistingJobAsync()
    {
        if (SelectedHrQuote == null || Contractor == null) return;
        if (!SelectedHrQuote.CanConvert) return;

        var companyId = _state.CurrentEmployee!.CompanyId;
        var hrUserId  = _state.CurrentEmployee.Id;
        var quoteId   = SelectedHrQuote.Id;
        var totalStr  = SelectedHrQuote.TotalDisplay;

        // ── Load and filter jobs ──────────────────────────────────────────────
        List<KaiFlow.Timesheets.Models.Job> openJobs = [];
        await RunAsync(async () =>
        {
            var all = await _storage.GetJobsAsync(companyId);
            // Show scheduled + in-progress jobs only; exclude jobs already sourced from a quote
            openJobs = all.Where(j => j.IsOpen).ToList();
        });

        if (openJobs.Count == 0)
        {
            await Shell.Current.DisplayAlert(
                "No Open Jobs",
                "There are no open jobs to assign this quote to.\n\n" +
                "Create a job first in the Jobs section, then return here to assign.",
                "OK");
            return;
        }

        // ── Build picker options ──────────────────────────────────────────────
        // Format: "[JC-001] Job Title  (Status • existing contractor or empty)"
        var options = openJobs.Select(j =>
        {
            var code         = string.IsNullOrWhiteSpace(j.JobCode) ? j.Id.ToString()[..8] : j.JobCode;
            var contractorSuffix = j.ContractorId.HasValue
                ? $" ← contractor assigned"
                : "";
            var status = j.Status switch
            {
                KaiFlow.Timesheets.Models.JobStatus.InProgress => "In Progress",
                _ => "Scheduled"
            };
            return $"[{code}]  {j.Title}  ({status}{contractorSuffix})";
        }).ToArray();

        var picked = await Shell.Current.DisplayActionSheet(
            "Assign Quote to Job",
            "Cancel",
            null,
            options);

        if (string.IsNullOrEmpty(picked) || picked == "Cancel") return;

        // Map the display string back to the job
        var selectedIndex = Array.IndexOf(options, picked);
        if (selectedIndex < 0 || selectedIndex >= openJobs.Count) return;
        var selectedJob = openJobs[selectedIndex];

        // ── Confirm ───────────────────────────────────────────────────────────
        var code    = string.IsNullOrWhiteSpace(selectedJob.JobCode) ? "—" : selectedJob.JobCode;
        var confirmed = await Shell.Current.DisplayAlert(
            "Assign Quote to Job",
            $"Assign this quote to:\n\n" +
            $"  Job:          [{code}] {selectedJob.Title}\n" +
            $"  Quote total:  {totalStr}\n\n" +
            "The quote amount will be added to the job's contractor cost.\n" +
            "The quote status will be set to Converted.",
            "Assign", "Cancel");
        if (!confirmed) return;

        // ── Execute ───────────────────────────────────────────────────────────
        bool success = false;
        var agreedAmount = SelectedHrQuote?.TotalAmount ?? 0;
        await RunAsync(async () =>
        {
            await _storage.HrAssignQuoteToJobAsync(companyId, hrUserId, quoteId, selectedJob.Id);

            // Write job_contractors via SECURITY DEFINER RPC — guaranteed to succeed.
            await _storage.HrUpsertJobContractorAsync(
                companyId, selectedJob.Id, Contractor!.Id,
                quoteId: quoteId,
                agreedAmount: agreedAmount,
                dealId: selectedJob.DealId);   // ← passes deal_id so project_contractors is written

            JobsLoaded     = false;
            ProjectsLoaded = false;            // ← invalidates Projects tab cache
            success = true;
        });

        // Refresh quote UI unconditionally — must not be inside the RunAsync that can throw.
        await RefreshHrQuoteAfterActionAsync(companyId, quoteId);

        if (success)
            await Shell.Current.DisplayAlert(
                "Quote Assigned",
                $"Quote has been assigned to job [{code}] {selectedJob.Title}.\n\n" +
                "The quote status is now Converted.",
                "OK");
    }

    private async Task RefreshHrQuoteAfterActionAsync(Guid companyId, Guid quoteId)
    {
        if (Contractor == null) return;

        // Read from DB on whatever thread we're on (background is fine for I/O)
        var quotes  = await _storage.GetContractorQuotesAsync(companyId, Contractor.Id);
        var updated = quotes.FirstOrDefault(q => q.Id == quoteId);

        // All property-change notifications MUST fire on the UI thread in WinUI
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            ContractorQuotes = new System.Collections.ObjectModel.ObservableCollection<ContractorQuote>(quotes);
            if (updated != null)
                SelectedHrQuote = updated;          // triggers OnSelectedHrQuoteChanged
            // Belt-and-suspenders: force all derived flags explicitly
            OnPropertyChanged(nameof(HrQuoteIsReviewable));
            OnPropertyChanged(nameof(HrQuoteIsManual));
            OnPropertyChanged(nameof(HrQuoteIsUpload));
            OnPropertyChanged(nameof(HrQuoteCanConvert));
            OnPropertyChanged(nameof(HrQuoteIsConverted));
        });
    }

    // ── Phase 2C.4: Banking approval commands ─────────────────────────────────

    [RelayCommand]
    private async Task ApproveContractorBankingAsync()
    {
        if (PendingBankingUpdate == null || Contractor == null) return;

        var update = PendingBankingUpdate;
        var confirmed = await Shell.Current.DisplayAlert(
            "Approve Banking Update",
            $"Approve the banking update submitted by {Contractor.Name}?\n\n" +
            $"Account holder: {update.AccountHolderName}\n" +
            $"Bank: {update.BankName}  ·  Account: {update.MaskedAccount}\n\n" +
            "The contractor's banking details will be updated immediately. " +
            "Banking verification will be reset and must be confirmed by HR separately " +
            "before payouts can be processed.",
            "Approve", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId  = _state.CurrentEmployee!.CompanyId;
            var employeeId = _state.CurrentEmployee.Id;

            await _storage.ApproveContractorBankingAsync(update.Id, employeeId);

            // Reload contractor so banking fields + BankingVerified reflect the new state
            if (Guid.TryParse(ContractorId, out var cid))
            {
                var refreshed = await _storage.GetContractorByIdAsync(companyId, cid);
                if (refreshed != null)
                {
                    Contractor    = refreshed;
                    BankingVerified = refreshed.BankingVerified; // will be false
                }
            }

            // Clear pending card
            PendingBankingUpdate = null;

            // Invalidate activity cache → next Activity tab open shows the approval event
            _allActivityEvents = [];
            ActivityLoaded     = false;
        });
    }

    [RelayCommand]
    private async Task RejectContractorBankingAsync()
    {
        if (PendingBankingUpdate == null || Contractor == null) return;

        var update = PendingBankingUpdate;
        var reason = await Shell.Current.DisplayPromptAsync(
            "Reject Banking Update",
            $"Provide a reason for rejecting {Contractor.Name}'s banking update:",
            "Reject", "Cancel",
            "e.g. Account details do not match submitted proof of banking");

        if (string.IsNullOrWhiteSpace(reason)) return;

        await RunAsync(async () =>
        {
            var employeeId = _state.CurrentEmployee!.Id;
            await _storage.RejectContractorBankingAsync(update.Id, employeeId, reason.Trim());

            // Clear pending card (contractors table unchanged)
            PendingBankingUpdate = null;

            // Invalidate activity cache
            _allActivityEvents = [];
            ActivityLoaded     = false;
        });
    }

    // ── Phase 2B.1 — Document commands ───────────────────────────────────────

    private static readonly string[] DocTypeRaw = [
        "company_registration", "tax_clearance", "vat_certificate", "bank_confirmation",
        "public_liability_insurance", "professional_indemnity", "coida", "health_safety_file",
        "contractor_agreement", "nda", "popia_agreement", "bbee_certificate",
        "proof_of_address", "id_document", "site_certification", "other"
    ];

    private static readonly string[] DocTypeLabels = [
        "Company Registration", "Tax Clearance (SARS TCS)", "VAT Certificate", "Bank Confirmation Letter",
        "Public Liability Insurance", "Professional Indemnity", "COIDA / Workmen's Comp.", "Health & Safety File",
        "Contractor Agreement", "NDA", "POPIA Agreement", "B-BBEE Certificate",
        "Proof of Address", "ID / Passport", "Site Certification", "Other"
    ];

    [RelayCommand]
    private async Task UploadDocumentAsync()
    {
        if (Contractor == null || IsNew) return;

        // 1. Pick file — use dot-prefixed extensions for WinUI.
        //    WinUI requires explicit extensions (".pdf", ".docx" etc.).
        //    Wildcards ("*") are treated as a literal extension on Windows
        //    and show no matching files.  Follow the pattern from ProjectDocumentTypes.
        var fileResult = await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = "Select contractor compliance document (PDF, Word, Excel, image)",
            FileTypes   = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
            {
                // WinUI: dot-prefixed file extensions
                [DevicePlatform.WinUI] = [
                    ".pdf",
                    ".doc", ".docx",
                    ".xls", ".xlsx",
                    ".jpg", ".jpeg", ".png"
                ],
                // Android: MIME types
                [DevicePlatform.Android] = [
                    "application/pdf",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "image/jpeg", "image/png"
                ],
                // iOS / macOS: UTI identifiers
                [DevicePlatform.iOS]         = ["public.data", "public.image", "com.adobe.pdf"],
                [DevicePlatform.MacCatalyst] = ["public.data", "public.image", "com.adobe.pdf"],
            })
        });
        if (fileResult == null) return;

        // 2. Document type
        var chosen = await Shell.Current.DisplayActionSheetAsync(
            "Document type", "Cancel", null, DocTypeLabels);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;
        var typeIdx = Array.IndexOf(DocTypeLabels, chosen);
        var docType = typeIdx >= 0 ? DocTypeRaw[typeIdx] : "other";

        // 3. Document name
        var docName = await Shell.Current.DisplayPromptAsync(
            "Document name", "Short description (e.g. SARS TCS Certificate 2026):",
            "Upload", "Cancel", "Enter name…");
        if (string.IsNullOrWhiteSpace(docName)) return;

        // 4. Expiry date (optional)
        var expiryStr = await Shell.Current.DisplayPromptAsync(
            "Expiry date", "Date (dd/MM/yyyy) or leave blank if no expiry:",
            "OK", "Skip", "e.g. 31/03/2027");
        DateOnly? expiryDate = null;
        if (!string.IsNullOrWhiteSpace(expiryStr) &&
            DateOnly.TryParseExact(expiryStr.Trim(), "dd/MM/yyyy",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var parsed))
            expiryDate = parsed;

        // 5. Required flag
        var requiredAnswer = await Shell.Current.DisplayActionSheetAsync(
            "Is this document required for compliance?", "Skip", null, "Yes — Required", "No — Optional");
        var isRequired = requiredAnswer == "Yes — Required";

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var doc = await _storage.UploadContractorDocumentAsync(
                companyId, Contractor.Id, fileResult,
                docType, docName.Trim(),
                issueDate: null, expiryDate: expiryDate,
                isRequired: isRequired);
            Documents.Insert(0, doc);
            RefreshDocumentView();
        });
    }

    [RelayCommand]
    private async Task ApproveDocumentAsync(ContractorDocument doc)
    {
        if (doc == null) return;
        var confirmed = await Shell.Current.DisplayAlert(
            "Approve document",
            $"Approve '{doc.DocumentName}'? This marks it as verified by HR.",
            "Approve", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var updated = await _storage.ApproveContractorDocumentAsync(
                doc.Id, _state.CurrentEmployee!.Id);
            var idx = Documents.IndexOf(doc);
            if (idx >= 0) Documents[idx] = updated;
            else Documents.Insert(0, updated);
            RefreshDocumentView();
        });
    }

    [RelayCommand]
    private async Task RejectDocumentAsync(ContractorDocument doc)
    {
        if (doc == null) return;
        var reason = await Shell.Current.DisplayPromptAsync(
            "Reject document",
            $"Reason for rejecting '{doc.DocumentName}':",
            "Reject", "Cancel", "e.g. Document expired, wrong type…");
        if (string.IsNullOrWhiteSpace(reason)) return;

        await RunAsync(async () =>
        {
            var updated = await _storage.RejectContractorDocumentAsync(doc.Id, reason.Trim());
            var idx = Documents.IndexOf(doc);
            if (idx >= 0) Documents[idx] = updated;
            else Documents.Insert(0, updated);
            RefreshDocumentView();
        });
    }

    [RelayCommand]
    private async Task DeleteDocumentAsync(ContractorDocument doc)
    {
        if (doc == null) return;
        var confirmed = await Shell.Current.DisplayAlert(
            "Delete document",
            $"Permanently delete '{doc.DocumentName}'? This cannot be undone.",
            "Delete", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            await _storage.DeleteContractorDocumentAsync(doc);
            Documents.Remove(doc);
            RefreshDocumentView();
        });
    }

    [RelayCommand]
    private async Task ViewDocumentAsync(ContractorDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try { await Launcher.OpenAsync(new Uri(doc.FileUrl)); }
        catch { /* browser unavailable or URI malformed */ }
    }

    partial void OnSelectedPartnerKindLabelChanged(string value)
    {
        if (Contractor == null) return;
        var idx = Array.IndexOf(PartnerKinds.KindLabels, value);
        if (idx < 0) idx = 0;
        Contractor.PartnerKindRaw = PartnerKinds.All[idx];
        PartnerKind = Contractor.PartnerKindRaw;
        OnPropertyChanged(nameof(IsSupplierMode));
        OnPropertyChanged(nameof(ShowMembersSection));
        Title = IsSupplierMode ? (IsNew ? "New Supplier" : Contractor?.Name ?? "Supplier")
            : (IsNew ? "New Contractor" : Contractor?.Name ?? "Contractor");
    }

    [RelayCommand]
    private async Task GenerateContractorCodeAsync()
    {
        if (Contractor == null) return;
        await RunAsync(async () =>
        {
            Contractor.ContractorCode = await _storage.GenerateNextContractorCodeAsync(_state.CurrentEmployee!.CompanyId);
            OnPropertyChanged(nameof(Contractor));
        });
    }

    [RelayCommand]
    private async Task RotateContractorCodeAsync()
    {
        if (Contractor == null || Contractor.Id == Guid.Empty) return;

        var confirmed = await Shell.Current.DisplayAlert(
            "Rotate portal code",
            "The current code will stop working immediately. Display the new code to the contractor before navigating away. Continue?",
            "Rotate", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var newCode = await _storage.HrRotateContractorCodeAsync(companyId, Contractor.Id);
            Contractor.ContractorCode = newCode;
            OnPropertyChanged(nameof(Contractor));
            await Shell.Current.DisplayAlert(
                "New portal code",
                $"New code: {newCode}\n\nShare this with the contractor. The old code no longer works.",
                "OK");
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (Contractor == null || string.IsNullOrWhiteSpace(Contractor.Name))
        {
            await Shell.Current.DisplayAlertAsync("Required", "Company / partner name is required.", "OK");
            return;
        }

        // Deactivation confirmation — only when transitioning active → inactive.
        if (!IsNew && _originalIsActive && !Contractor.IsActive)
        {
            var confirmed = await Shell.Current.DisplayAlert(
                "Deactivate contractor?",
                $"'{Contractor.Name}' will be marked inactive and will not appear in active lists or job assignments. Continue?",
                "Deactivate",
                "Cancel");
            if (!confirmed)
            {
                Contractor.IsActive = true;
                OnPropertyChanged(nameof(Contractor));
                return;
            }
        }

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            // Capture old HR-controlled values before write-back (for activity log)
            var oldPaymentHold     = Contractor.PaymentHold;
            var oldComplianceHold  = Contractor.ComplianceHold;
            var oldBankingVerified = Contractor.BankingVerified;
            var oldPackId          = Contractor.CompliancePackId;

            // Write observable proxies back to the model before saving.
            Contractor.IsVatRegistered = IsVatRegistered;
            Contractor.Rating = ContractorRating;
            // Phase 2A write-back
            Contractor.PaymentHold = PaymentHold;
            Contractor.ComplianceHold = ComplianceHold;
            Contractor.BankingVerified = BankingVerified;
            Contractor.AccountType = RawFor(AccountTypeRaw, AccountTypeLbls, SelectedAccountTypeLabel, "cheque");
            Contractor.PaymentTerms = RawFor(PaymentTermsRaw, PaymentTermsLbls, SelectedPaymentTermsLabel, "30_days");
            Contractor.PreferredPaymentMethod = RawFor(PaymentMethodRaw, PaymentMethodLbls, SelectedPaymentMethodLabel, "eft");

            if (IsNew)
            {
                Contractor.CreatedAt = DateTime.UtcNow;
                Contractor = await _storage.CreateContractorAsync(Contractor);
            }
            else
            {
                Contractor = await _storage.UpdateContractorAsync(Contractor);

                // ── Activity events for HR-owned field changes (Phase 2C) ──────
                var id = Contractor.Id;
                var meta = new Dictionary<string, object> { ["contractor_id"] = id.ToString() };

                if (oldPaymentHold != PaymentHold)
                    _ = _storage.RecordContractorEventAsync(companyId, id,
                        PaymentHold ? "contractor_payment_hold_enabled" : "contractor_payment_hold_disabled");

                if (oldComplianceHold != ComplianceHold)
                    _ = _storage.RecordContractorEventAsync(companyId, id,
                        ComplianceHold ? "contractor_compliance_hold_enabled" : "contractor_compliance_hold_disabled");

                if (oldBankingVerified != BankingVerified)
                    _ = _storage.RecordContractorEventAsync(companyId, id,
                        BankingVerified ? "contractor_banking_verified" : "contractor_banking_unverified");

                if (oldPackId != Contractor.CompliancePackId)
                {
                    var packName = AvailablePacks
                        .FirstOrDefault(p => p.Id == Contractor.CompliancePackId)?.Name ?? "";
                    _ = _storage.RecordContractorEventAsync(companyId, id,
                        "contractor_compliance_pack_changed",
                        meta: new() { ["contractor_id"] = id.ToString(), ["pack_name"] = packName });
                }

                // Invalidate the loaded activity cache so next open shows fresh data
                _allActivityEvents = [];
                ActivityLoaded = false;
            }

            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task AddMemberAsync()
    {
        if (Contractor == null || IsNew || _allEmployees.Count == 0) return;

        var names = _allEmployees.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheetAsync("Add member", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var employee = _allEmployees.FirstOrDefault(e => e.FullName == chosen);
        if (employee == null) return;

        var role = await Shell.Current.DisplayPromptAsync("Role", "Role (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            var link = new ContractorMemberLink
            {
                ContractorId = Contractor!.Id,
                EmployeeId = employee.Id,
                Role = string.IsNullOrWhiteSpace(role) ? null : role.Trim(),
                CompanyId = _state.CurrentEmployee!.CompanyId
            };
            await _storage.CreateContractorMemberLinkAsync(link);
            Members.Add(new ContractorMemberDisplay(link, employee.FullName));
        });
    }

    [RelayCommand]
    private async Task InviteMemberAsync()
    {
        var email = await Shell.Current.DisplayPromptAsync("Invite member", "Email:", "Send", "Cancel", "", keyboard: Keyboard.Email);
        if (string.IsNullOrWhiteSpace(email)) return;

        await RunAsync(async () =>
        {
            await _storage.SendOtpAsync(email.Trim());
            await Shell.Current.DisplayAlertAsync("Invited", $"Login link sent to {email.Trim()}.", "OK");
        });
    }
}
