using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.ViewModels.Hr;   // PackChecklistRow
using KaiFlow.Timesheets.Views.ContractorPortal;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.ContractorPortal;

public partial class ContractorPortalViewModel : BaseViewModel
{
    private readonly IStorageService _storage;

    // ── Identity ──────────────────────────────────────────────────────────────
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CompanyCodeDisplay))]
    private string _contractorName = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CompanyCodeDisplay))]
    private string _companyCode = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ContractorCodeDisplay))]
    private string _contractorCode = "";

    [ObservableProperty] private string _onSiteBanner = "";

    // ── Phase 2C.2: Self-service profile ─────────────────────────────────────

    /// <summary>Full profile loaded from contractor_portal_get_profile RPC.</summary>
    private ContractorPortalProfile? _profile;

    /// <summary>True once the profile RPC has returned (success or null).</summary>
    [ObservableProperty] private bool _profileLoaded;

    /// <summary>True while the user is in profile-edit mode.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsViewingProfile))]
    private bool _isEditingProfile;

    public bool IsViewingProfile => !IsEditingProfile;

    // Edit-form observables — bound two-way in edit mode,
    // used as read-only source in view mode.
    [ObservableProperty] private string _editProfileName         = "";
    [ObservableProperty] private string _editRegistrationNumber  = "";
    [ObservableProperty] private string _editTaxNumber           = "";
    [ObservableProperty] private bool   _editIsVatRegistered;
    [ObservableProperty] private string _editVatNumber           = "";
    [ObservableProperty] private string _editContactPerson       = "";
    [ObservableProperty] private string _editPhone               = "";
    [ObservableProperty] private string _editEmail               = "";
    [ObservableProperty] private string _editAddress             = "";

    // Read-only computed properties from the loaded profile
    // (used in view mode to display HR-owned fields)
    public string ProfilePartnerKind     => _profile?.PartnerKindLabel      ?? "—";
    // ProfileRating intentionally removed — rating is internal HR information only.
    public string ProfilePaymentTerms    => _profile?.PaymentTermsLabel     ?? "—";
    public string ProfilePaymentMethod   => _profile?.PaymentMethodLabel    ?? "—";
    public string ProfileCompliancePack  => _profile?.CompliancePackDisplay ?? "No pack assigned";
    public string ProfileTaxDisplay      => _profile?.TaxDisplay            ?? "—";
    public string ProfileVatStatus       => _profile?.VatStatusDisplay      ?? "—";
    public bool   ProfilePaymentHold     => _profile?.PaymentHold     ?? false;
    public bool   ProfileComplianceHold  => _profile?.ComplianceHold  ?? false;
    public bool   ProfileBankingVerified => _profile?.BankingVerified ?? false;

    /// <summary>Company code with "—" fallback when the session value is empty.</summary>
    public string CompanyCodeDisplay    => string.IsNullOrWhiteSpace(CompanyCode)    ? "—" : CompanyCode;
    /// <summary>Contractor code with "—" fallback when the session value is empty.</summary>
    public string ContractorCodeDisplay => string.IsNullOrWhiteSpace(ContractorCode) ? "—" : ContractorCode;

    // ── Phase 2C.3: Banking self-service ─────────────────────────────────────

    private ContractorBankingStatus? _bankingStatus;
    /// <summary>
    /// Latest banking update regardless of status.
    /// Replaces _pendingBanking so the portal can show pending/approved/rejected states.
    /// </summary>
    private ContractorBankingUpdate? _latestBankingDecision;

    [ObservableProperty] private bool _bankingLoaded;
    [ObservableProperty] private bool _bankingLoading;

    // Derived state from _latestBankingDecision
    public bool HasPendingBanking    => _latestBankingDecision?.Status == "pending";
    public bool HasApprovedDecision  => _latestBankingDecision?.Status == "approved";
    public bool HasRejectedDecision  => _latestBankingDecision?.Status == "rejected";

    // Current status display (from _bankingStatus)
    public string BankAccountHolder   => _bankingStatus?.AccountHolderName ?? "—";
    public string BankBankName        => _bankingStatus?.BankName          ?? "—";
    public string BankMaskedAccount   => _bankingStatus?.MaskedAccountDisplay ?? "No account on file";
    public string BankBranchCode      => _bankingStatus?.BankBranchCode    ?? "—";
    public string BankAccountType     => _bankingStatus?.AccountTypeLabel  ?? "—";
    public string BankSwiftBic        => _bankingStatus?.SwiftBic          ?? "—";
    public bool   BankHasDetails      => _bankingStatus?.HasBankingDetails ?? false;
    public bool   BankVerified        => _bankingStatus?.BankingVerified   ?? false;
    public bool   BankPaymentHold     => _bankingStatus?.PaymentHold       ?? false;
    public bool   BankComplianceHold  => _bankingStatus?.ComplianceHold    ?? false;
    public string BankPaymentTerms    => _bankingStatus?.PaymentTermsLabel ?? "—";
    public string BankPaymentMethod   => _bankingStatus?.PaymentMethodLabel ?? "—";

    // Pending/decision display (from _latestBankingDecision)
    public string PendingBankSubmittedAt    => _latestBankingDecision?.SubmittedAtDisplay ?? "";
    public string PendingBankAccountHolder  => _latestBankingDecision?.AccountHolderName  ?? "";
    public string PendingBankBankName       => _latestBankingDecision?.BankName           ?? "";
    public string PendingBankMaskedAccount  => _latestBankingDecision?.MaskedAccount      ?? "";
    public string PendingBankBranchCode     => _latestBankingDecision?.BankBranchCode     ?? "";
    public string PendingBankAccountType    => _latestBankingDecision?.AccountTypeLabel   ?? "";

    // Approved/rejected decision display
    public string DecisionReviewedAt      => _latestBankingDecision?.ReviewedAtDisplay ?? "";
    public string DecisionRejectionReason => _latestBankingDecision?.RejectionReason   ?? "";

    // Banking submission form observables
    [ObservableProperty] private string _editBankAccountHolder = "";
    [ObservableProperty] private string _editBankName          = "";
    [ObservableProperty] private string _editBankAccount       = "";
    [ObservableProperty] private string _editBranchCode        = "";
    [ObservableProperty] private string _editSwiftBic          = "";
    [ObservableProperty] private string _editAccountTypeLabel  = "Cheque";

    public IReadOnlyList<string> BankAccountTypeItems { get; } =
        ["Cheque", "Savings", "Transmission", "Credit"];

    private static readonly Dictionary<string, string> AccountTypeLabelToRaw = new()
    {
        ["Cheque"]       = "cheque",
        ["Savings"]      = "savings",
        ["Transmission"] = "transmission",
        ["Credit"]       = "credit",
    };

    // ── Tab data ──────────────────────────────────────────────────────────────
    [ObservableProperty] private ObservableCollection<Job>              _jobs    = [];
    [ObservableProperty] private ObservableCollection<ContractorPayout> _payouts = [];
    [ObservableProperty] private string _outstandingPayoutsDisplay = "R0.00";

    // ── Payments tab filter (Phase I) ─────────────────────────────────────────
    [ObservableProperty] private string _paymentsFilter = "All";
    [ObservableProperty] private ObservableCollection<ContractorPayout> _filteredPayouts = [];

    public bool IsPaymentsFilterAll      => PaymentsFilter == "All";
    public bool IsPaymentsFilterPending  => PaymentsFilter == "Pending";
    public bool IsPaymentsFilterApproved => PaymentsFilter == "Approved";
    public bool IsPaymentsFilterPaid     => PaymentsFilter == "Paid";

    partial void OnPaymentsFilterChanged(string _)
    {
        ApplyPaymentsFilter();
        OnPropertyChanged(nameof(IsPaymentsFilterAll));
        OnPropertyChanged(nameof(IsPaymentsFilterPending));
        OnPropertyChanged(nameof(IsPaymentsFilterApproved));
        OnPropertyChanged(nameof(IsPaymentsFilterPaid));
        OnPropertyChanged(nameof(IsPaymentsFilterRejected));
    }

    partial void OnPayoutsChanged(ObservableCollection<ContractorPayout> _)
    {
        ApplyPaymentsFilter();
        NotifyHomeProperties();
    }

    partial void OnJobsChanged(ObservableCollection<Job> _) => NotifyHomeProperties();

    private void ApplyPaymentsFilter()
    {
        var filtered = PaymentsFilter switch
        {
            "Pending"  => Payouts.Where(p => p.PayoutStatusRaw == "pending"),
            "Approved" => Payouts.Where(p => p.PayoutStatusRaw == "approved"),
            "Paid"     => Payouts.Where(p => p.PayoutStatusRaw == "paid"),
            "Rejected" => Payouts.Where(p => p.IsRejected),
            _          => Payouts.AsEnumerable()
        };
        FilteredPayouts = new ObservableCollection<ContractorPayout>(filtered);
    }

    public bool IsPaymentsFilterRejected => PaymentsFilter == "Rejected";

    [RelayCommand]
    private void SetPaymentsFilter(string filter) => PaymentsFilter = filter;

    // ── Phase P: reject → revise form ────────────────────────────────────────
    [ObservableProperty] private bool _isReviseMode;
    [ObservableProperty] private ContractorPayout? _revisePayout;
    [ObservableProperty] private decimal _reviseAmount;
    [ObservableProperty] private string _reviseInvoiceRef = "";
    [ObservableProperty] private string _reviseNotes = "";

    public string ReviseOriginalRef => RevisePayout?.InvoiceReferenceDisplay ?? "—";
    public string ReviseJobDisplay  => RevisePayout?.JobDisplay ?? "—";
    public bool   ReviseHasJob      => RevisePayout?.HasJobDisplay ?? false;

    partial void OnRevisePayoutChanged(ContractorPayout? _)
    {
        OnPropertyChanged(nameof(ReviseOriginalRef));
        OnPropertyChanged(nameof(ReviseJobDisplay));
        OnPropertyChanged(nameof(ReviseHasJob));
    }

    [RelayCommand]
    private void StartRevisePayout(ContractorPayout payout)
    {
        RevisePayout = payout;
        ReviseAmount = payout.TotalAmount;
        // Pre-fill invoice reference from notes (first pipe segment)
        ReviseInvoiceRef = payout.InvoiceReferenceDisplay != "—" ? payout.InvoiceReferenceDisplay : "";
        ReviseNotes = "";
        IsReviseMode = true;
    }

    [RelayCommand]
    private void CancelRevise()
    {
        IsReviseMode = false;
        RevisePayout = null;
        ReviseAmount = 0;
        ReviseInvoiceRef = "";
        ReviseNotes = "";
    }

    [RelayCommand]
    private async Task SubmitReviseAsync()
    {
        if (RevisePayout == null) return;
        if (ReviseAmount <= 0) { ErrorMessage = "Enter a valid amount."; return; }
        if (string.IsNullOrWhiteSpace(CompanyCode) || string.IsNullOrWhiteSpace(ContractorCode))
        {
            ErrorMessage = "Session expired. Please log in again.";
            return;
        }

        var payoutId = RevisePayout.Id;
        await RunAsync(async () =>
        {
            await _storage.ContractorPortalResubmitPayoutAsync(
                CompanyCode,
                ContractorCode,
                payoutId,
                ReviseAmount,
                string.IsNullOrWhiteSpace(ReviseInvoiceRef) ? null : ReviseInvoiceRef.Trim(),
                string.IsNullOrWhiteSpace(ReviseNotes) ? null : ReviseNotes.Trim());
        });

        if (ErrorMessage != null) return;

        CancelRevise();
        await ReloadPayoutsAsync(CompanyCode, ContractorCode);
        await Shell.Current.DisplayAlert("Resubmitted", "Your revised invoice has been submitted for review.", "OK");
    }

    // ── Tab state (Phase 2C: expanded to 7 tabs) ─────────────────────────────
    [ObservableProperty] private string _portalTab = "home";

    public bool IsHomeTab        => PortalTab == "home";
    public bool IsInformationTab => PortalTab == "information";
    public bool IsComplianceTab  => PortalTab == "compliance";
    public bool IsBankingTab     => PortalTab == "banking";
    public bool IsTeamTab        => PortalTab == "team";
    public bool IsJobsTab        => PortalTab == "jobs";
    public bool IsPaymentsTab    => PortalTab == "payments";
    public bool IsQuotesTab      => PortalTab == "quotes";

    // ── Home dashboard (Phase J) ──────────────────────────────────────────────
    [ObservableProperty] private ObservableCollection<ContractorPayout> _homeRecentPayouts = [];

    public string HomePendingAmount  => FormatR(Payouts.Where(p => p.PayoutStatusRaw == "pending").Sum(p => p.NetPayable));
    public string HomeApprovedAmount => FormatR(Payouts.Where(p => p.PayoutStatusRaw == "approved").Sum(p => p.NetPayable));
    public string HomeTotalPaid      => FormatR(Payouts.Where(p => p.PayoutStatusRaw == "paid").Sum(p => p.NetPayable));
    public int    HomePendingCount   => Payouts.Count(p => p.PayoutStatusRaw == "pending");
    public int    HomeApprovedCount  => Payouts.Count(p => p.PayoutStatusRaw == "approved");
    public int    HomePaidCount      => Payouts.Count(p => p.PayoutStatusRaw == "paid");

    public string HomeActiveJobsDisplay =>
        Jobs.Count == 0 ? "No active jobs" :
        Jobs.Count == 1 ? "1 active job" : $"{Jobs.Count} active jobs";

    public string HomeComplianceSummary =>
        !PortalHasPackAssigned ? "No pack assigned" :
        PortalMissingCount > 0  ? $"{PortalMissingCount} missing" :
        PortalExpiringCount > 0 ? $"{PortalExpiringCount} expiring soon" :
        PortalRejectedCount > 0 ? $"{PortalRejectedCount} rejected" :
        PortalScorePercent >= 80 ? "All clear" : "Needs attention";

    public bool HomeHasPaymentHold    => _profile?.PaymentHold    ?? false;
    public bool HomeHasComplianceHold => _profile?.ComplianceHold ?? false;
    public bool HomeHasComplianceAlert =>
        PortalHasPackAssigned && (PortalMissingCount > 0 || PortalExpiringCount > 0 || PortalRejectedCount > 0);

    public string HomeGreeting =>
        DateTime.Now.Hour < 12 ? "Good morning" :
        DateTime.Now.Hour < 17 ? "Good afternoon" : "Good evening";

    private static string FormatR(decimal v) => $"R{v:N2}";

    private void NotifyHomeProperties()
    {
        HomeRecentPayouts = new ObservableCollection<ContractorPayout>(Payouts.Take(3));
        OnPropertyChanged(nameof(HomePendingAmount));
        OnPropertyChanged(nameof(HomeApprovedAmount));
        OnPropertyChanged(nameof(HomeTotalPaid));
        OnPropertyChanged(nameof(HomePendingCount));
        OnPropertyChanged(nameof(HomeApprovedCount));
        OnPropertyChanged(nameof(HomePaidCount));
        OnPropertyChanged(nameof(HomeActiveJobsDisplay));
        OnPropertyChanged(nameof(HomeComplianceSummary));
        OnPropertyChanged(nameof(HomeHasPaymentHold));
        OnPropertyChanged(nameof(HomeHasComplianceHold));
        OnPropertyChanged(nameof(HomeHasComplianceAlert));
        OnPropertyChanged(nameof(HomeGreeting));
    }

    // ── Phase 2B.3c: Compliance data ─────────────────────────────────────────

    // Raw documents loaded from DB via portal RPC
    [ObservableProperty]
    private ObservableCollection<ContractorDocument> _portalDocuments = [];

    // Pack checklist rows (one per pack item, cross-referenced with documents)
    [ObservableProperty]
    private ObservableCollection<PackChecklistRow> _portalChecklist = [];

    // Filtered lists for the three dashboard sections
    [ObservableProperty]
    private ObservableCollection<PackChecklistRow> _missingRows = [];    // status: missing

    [ObservableProperty]
    private ObservableCollection<ContractorDocument> _expiringDocs = [];  // expiring soon

    [ObservableProperty]
    private ObservableCollection<ContractorDocument> _rejectedDocs = [];  // rejected

    // Compliance score (flat properties matching the HR VM pattern)
    public int    PortalScorePercent  { get; private set; }
    public double PortalScoreProgress { get; private set; }
    public string PortalStatusLabel   { get; private set; } = "Not Configured";
    public string PortalStatusBadgeBg { get; private set; } = "#1E293B";
    public string PortalStatusBadgeFg { get; private set; } = "#64748B";
    public string PortalScoreColor    { get; private set; } = "#64748B";

    // Summary counts shown in the score card
    public int PortalRequiredCount  { get; private set; }
    public int PortalCompleteCount  { get; private set; }
    public int PortalMissingCount   { get; private set; }
    public int PortalExpiringCount  { get; private set; }
    public int PortalRejectedCount  { get; private set; }
    public int PortalApprovedCount  { get; private set; }

    // Whether a pack has been assigned (drives checklist vs legacy view)
    public bool PortalHasPackAssigned { get; private set; }

    // Internal: pack items loaded from DB
    private List<CompliancePackItem> _portalPackItems = [];

    // ── File-picker type list for portal upload ────────────────────────────────

    private static readonly string[] PortalDocTypeRaw =
    [
        "company_registration","tax_clearance","vat_certificate","bank_confirmation",
        "public_liability_insurance","professional_indemnity","coida","health_safety_file",
        "contractor_agreement","nda","popia_agreement","bbee_certificate",
        "proof_of_address","id_document","site_certification",
        "psira_registration","fidelity_guarantee","liquor_license","food_safety_cert","other"
    ];

    private static readonly string[] PortalDocTypeLabels =
    [
        "Company Registration","Tax Clearance (SARS TCS)","VAT Certificate",
        "Bank Confirmation Letter","Public Liability Insurance","Professional Indemnity",
        "COIDA / Workmen's Comp.","Health & Safety File","Contractor Agreement","NDA",
        "POPIA Agreement","B-BBEE Certificate","Proof of Address","ID / Passport",
        "Site Certification","PSIRA Registration","Fidelity Guarantee",
        "Liquor Licence","Food Safety Certificate","Other"
    ];

    // ─────────────────────────────────────────────────────────────────────────

    public ContractorPortalViewModel(IStorageService storage)
    {
        _storage = storage;
        Title = "Contractor Portal";
    }

    partial void OnPortalTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsHomeTab));
        OnPropertyChanged(nameof(IsInformationTab));
        OnPropertyChanged(nameof(IsComplianceTab));
        OnPropertyChanged(nameof(IsBankingTab));
        OnPropertyChanged(nameof(IsTeamTab));
        OnPropertyChanged(nameof(IsJobsTab));
        OnPropertyChanged(nameof(IsPaymentsTab));
        OnPropertyChanged(nameof(IsQuotesTab));

        // Reload quotes every time the Quotes tab is opened so the contractor
        // always sees the current HR decision (approved / rejected / revision requested).
        // Guard against concurrent loads only — no "loaded once" guard.
        if (value == "quotes" && !QuotesLoading)
        {
            var qs = ContractorPortalSessionStore.Get();
            if (qs != null)
                _ = LoadQuotesAsync(qs.Value.ContractorId, qs.Value.CompanyId);
        }

        // Lazy-load banking data the first time the Banking tab is opened
        if (value == "banking" && !BankingLoaded && !BankingLoading)
        {
            var session = ContractorPortalSessionStore.Get();
            if (session != null)
                _ = LoadBankingAsync(session.Value.ContractorId, session.Value.CompanyId);
        }

        // Reload payments every time the tab is opened so HR status changes appear immediately
        if (value == "payments" && !_paymentsReloading && !string.IsNullOrWhiteSpace(CompanyCode))
            _ = ReloadPayoutsAsync(CompanyCode, ContractorCode);
    }

    // ── Load ──────────────────────────────────────────────────────────────────

    public async Task LoadAsync()
    {
        var session = ContractorPortalSessionStore.Get();
        if (session == null)
        {
            await ShellNavigation.GoToAsync("//IdEntry");
            return;
        }

        // Set identity fields SYNCHRONOUSLY before RunAsync so they are guaranteed
        // to have their correct values when the Information tab first renders.
        // Keeping them inside RunAsync caused a race: if CompanyCode/ContractorCode
        // were still "" from a not-yet-flushed SecureStorage write, SetProperty would
        // see old == new and skip OnPropertyChanged, leaving the labels blank.
        ContractorName = session.Value.ContractorName;
        CompanyCode    = string.IsNullOrWhiteSpace(session.Value.CompanyCode)
                         ? "" : session.Value.CompanyCode;
        ContractorCode = string.IsNullOrWhiteSpace(session.Value.ContractorCode)
                         ? "" : session.Value.ContractorCode;
        Title = ContractorName;

        await RunAsync(async () =>
        {
            // Identity already set above; only async data loaded here.

            var open = await _storage.ContractorPortalOpenVisitAsync(CompanyCode, ContractorCode);
            OnSiteBanner = open != null
                ? $"On site · job in progress since {open.SignInAt.ToLocalTime():h:mm tt}"
                : "Not signed in on a job";

            var jobs = await _storage.GetContractorPortalJobsAsync(CompanyCode, ContractorCode);
            Jobs = new ObservableCollection<Job>(jobs);

            var payouts = await _storage.GetContractorPortalPayoutsAsync(CompanyCode, ContractorCode);
            Payouts = new ObservableCollection<ContractorPayout>(payouts);
            var outstanding = payouts.Where(p => p.PayoutStatusRaw != "paid").Sum(p => p.NetPayable);
            OutstandingPayoutsDisplay = $"R{outstanding:N2}";

            // Phase 2C.2 — load contractor profile for Information tab
            await LoadProfileAsync(session.Value.ContractorId, session.Value.CompanyId);

            // Phase 2B.3c — load compliance data
            await LoadComplianceAsync(session.Value.ContractorId, session.Value.CompanyId);
        });
    }

    // ── Phase 2C.2: Profile loading + editing ─────────────────────────────────

    private async Task LoadProfileAsync(Guid contractorId, Guid companyId)
    {
        var profile = await _storage.ContractorPortalGetProfileAsync(contractorId, companyId);
        _profile = profile;

        if (profile != null)
        {
            // Also refresh the session display name from the authoritative DB value
            ContractorName = profile.Name;
            InitEditFormFromProfile();
        }

        ProfileLoaded = true;
        NotifyProfileReadOnlyProperties();
    }

    /// <summary>
    /// Copies the loaded profile into the edit-form observables.
    /// Called both on initial load and when the user cancels an edit.
    /// </summary>
    private void InitEditFormFromProfile()
    {
        if (_profile == null) return;
        EditProfileName        = _profile.Name;
        EditRegistrationNumber = _profile.RegistrationNumber ?? "";
        EditTaxNumber          = _profile.TaxNumber          ?? "";
        EditIsVatRegistered    = _profile.IsVatRegistered;
        EditVatNumber          = _profile.VatNumber          ?? "";
        EditContactPerson      = _profile.ContactPerson      ?? "";
        EditPhone              = _profile.Phone              ?? "";
        EditEmail              = _profile.Email              ?? "";
        EditAddress            = _profile.Address            ?? "";
    }

    private void NotifyProfileReadOnlyProperties()
    {
        OnPropertyChanged(nameof(ProfilePartnerKind));
        OnPropertyChanged(nameof(ProfilePaymentTerms));
        OnPropertyChanged(nameof(ProfilePaymentMethod));
        OnPropertyChanged(nameof(ProfileCompliancePack));
        OnPropertyChanged(nameof(ProfileTaxDisplay));
        OnPropertyChanged(nameof(ProfileVatStatus));
        OnPropertyChanged(nameof(ProfilePaymentHold));
        OnPropertyChanged(nameof(ProfileComplianceHold));
        OnPropertyChanged(nameof(ProfileBankingVerified));
        NotifyHomeProperties();
    }

    [RelayCommand]
    private void EditProfile()
    {
        InitEditFormFromProfile();   // ensure edit form reflects latest saved state
        IsEditingProfile = true;
    }

    [RelayCommand]
    private void CancelProfileEdit()
    {
        InitEditFormFromProfile();   // discard unsaved changes
        IsEditingProfile = false;
    }

    [RelayCommand]
    private async Task SaveProfileAsync()
    {
        if (string.IsNullOrWhiteSpace(EditProfileName))
        {
            await Shell.Current.DisplayAlert("Required", "Company / trading name is required.", "OK");
            return;
        }

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        await RunAsync(async () =>
        {
            var updated = new ContractorPortalProfile
            {
                Name               = EditProfileName.Trim(),
                RegistrationNumber = NullIfBlank(EditRegistrationNumber),
                TaxNumber          = NullIfBlank(EditTaxNumber),
                IsVatRegistered    = EditIsVatRegistered,
                VatNumber          = EditIsVatRegistered ? NullIfBlank(EditVatNumber) : null,
                ContactPerson      = NullIfBlank(EditContactPerson),
                Phone              = NullIfBlank(EditPhone),
                Email              = NullIfBlank(EditEmail),
                Address            = NullIfBlank(EditAddress),
            };

            await _storage.ContractorPortalUpdateProfileAsync(
                session.Value.ContractorId, session.Value.CompanyId, updated);

            // Reload to get the authoritative server state
            await LoadProfileAsync(session.Value.ContractorId, session.Value.CompanyId);
            IsEditingProfile = false;
        });
    }

    private static string? NullIfBlank(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    // ── Phase 2D.2: Contractor Quotes ─────────────────────────────────────────

    // ── Quote list ──────────────────────────────────────────────────────────
    [ObservableProperty] private ObservableCollection<ContractorQuote> _portalQuotes = [];
    [ObservableProperty] private bool   _quotesLoaded;
    [ObservableProperty] private bool   _quotesLoading;
    [ObservableProperty] private string _quotesFilter = "All";
    public IReadOnlyList<string> QuoteFilterOptions { get; } =
        // Phase 2D.3: added Under Review and Revision Requested so contractors
        // can filter to quotes that need their attention or have been decided.
        ["All", "Drafts", "Active", "Approved", "Rejected", "Expired"];

    // Sub-view within the Quotes tab: list | create | upload | detail
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsQuoteListView), nameof(IsCreateQuoteView),
                               nameof(IsUploadQuoteView), nameof(IsQuoteDetailView))]
    private string _quotesView = "list";

    public bool IsQuoteListView   => QuotesView == "list";
    public bool IsCreateQuoteView => QuotesView == "create";
    public bool IsUploadQuoteView => QuotesView == "upload";
    public bool IsQuoteDetailView => QuotesView == "detail";

    // ── Shared VAT mode helpers ─────────────────────────────────────────────
    //
    // The Picker binds to display labels ("None", "VAT Exclusive", "VAT Inclusive").
    // Raw DB values ("none", "exclusive", "inclusive") are derived via VatLabelToValue().
    // Percentages are UI-only; only final amounts are stored in the database.

    public IReadOnlyList<string> VatModeDisplayOptions { get; } =
        ["None", "VAT Exclusive", "VAT Inclusive"];

    private static string VatLabelToValue(string l) => l switch
    {
        "VAT Exclusive" => "exclusive",
        "VAT Inclusive" => "inclusive",
        _               => "none"
    };

    private static string VatValueToLabel(string v) => v switch
    {
        "exclusive" => "VAT Exclusive",
        "inclusive" => "VAT Inclusive",
        _           => "None"
    };

    private static string VatValueToDescription(string v) => v switch
    {
        "exclusive" => "VAT is added on top of the subtotal.",
        "inclusive" => "VAT is already included in the entered amount.",
        _           => "No VAT will be added to this quote."
    };

    // ── Create/edit form ────────────────────────────────────────────────────
    private Guid? _editingQuoteId;

    [ObservableProperty] private string  _createTitle           = "";
    [ObservableProperty] private string  _createDescription     = "";
    [ObservableProperty] private string  _createQuoteNumber     = "";
    [ObservableProperty] private string  _createValidUntilText  = "";
    // VAT mode: Picker binds to the friendly label; raw value is derived.
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateVatMode), nameof(CreateVatModeDescription),
                               nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay),
                               nameof(CreateShowVatRate), nameof(CreateVatLabel))]
    private string _createVatModeDisplay = "None"; // default: no VAT

    public string CreateVatMode        => VatLabelToValue(_createVatModeDisplay);
    public string CreateVatModeDescription => VatValueToDescription(CreateVatMode);

    // VAT rate: stored as decimal (e.g. 0.15) but the Entry shows/accepts a percentage "15".
    // _createVatRate is updated by OnCreateVatRatePctChanged and is never bound directly.
    private decimal _createVatRate = 0.15m;
    public  decimal CreateVatRate  => _createVatRate;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay),
                               nameof(CreateVatLabel))]
    private string _createVatRatePct = "15";

    // Discount — bidirectional Amount ↔ % (base = line-item subtotal)
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateAfterDiscount), nameof(CreateTaxable),
                               nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateAfterDiscountDisplay), nameof(CreateTaxableDisplay),
                               nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay))]
    private decimal _createDiscount;
    [ObservableProperty] private string _createDiscountPct = "";

    // Freight — bidirectional Amount ↔ % (base = subtotal after discount)
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateTaxable), nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateTaxableDisplay), nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay))]
    private decimal _createFreight;
    [ObservableProperty] private string _createFreightPct = "";

    // Duty — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateTaxable), nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateTaxableDisplay), nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay))]
    private decimal _createDuty;
    [ObservableProperty] private string _createDutyPct = "";

    // Levies — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateTaxable), nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateTaxableDisplay), nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay))]
    private decimal _createLevies;
    [ObservableProperty] private string _createLeviesPct = "";

    // Other Charges — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CreateTaxable), nameof(CreateVatAmount), nameof(CreateGrandTotal),
                               nameof(CreateTaxableDisplay), nameof(CreateVatAmountDisplay), nameof(CreateGrandTotalDisplay))]
    private decimal _createOtherCharges;
    [ObservableProperty] private string _createOtherChargesPct = "";
    [ObservableProperty] private string  _createTerms           = "";
    [ObservableProperty] private string  _createNotes           = "";
    [ObservableProperty] private ObservableCollection<QuoteLineItemRow> _createLineItems = [];

    // Create form computed totals
    // ─────────────────────────────────────────────────────────────────────────
    // Calculation order:
    //   1. CreateLineSubtotal  = Σ (qty × unit_price − item_discount)
    //   2. CreateAfterDiscount = CreateLineSubtotal − CreateDiscount
    //   3. CreateTaxable       = CreateAfterDiscount + Freight + Duty + Levies + Other
    //   4. VAT applied to CreateTaxable based on mode
    //   5. Percentage fields are UI helpers; only the amounts reach the DB
    //
    // Charge % base = CreateAfterDiscount (subtotal after quote-level discount).
    // Discount % base = CreateLineSubtotal.
    public decimal CreateLineSubtotal   => CreateLineItems.Sum(i => i.Subtotal);
    public decimal CreateAfterDiscount  => CreateLineSubtotal - CreateDiscount;
    public decimal CreateChargesTotal   => CreateFreight + CreateDuty + CreateLevies + CreateOtherCharges;
    public decimal CreateTaxable        => CreateAfterDiscount + CreateChargesTotal;
    public decimal CreateVatAmount      => CreateVatMode switch
    {
        "none"      => 0m,
        "inclusive" => Math.Round(CreateTaxable * _createVatRate / (1 + _createVatRate), 2),
        _           => Math.Round(CreateTaxable * _createVatRate, 2)
    };
    public decimal CreateGrandTotal => CreateVatMode switch
    {
        "exclusive" => CreateTaxable + CreateVatAmount,
        _           => CreateTaxable
    };

    public string CreateLineSubtotalDisplay  => $"R{CreateLineSubtotal:N2}";
    public string CreateAfterDiscountDisplay => $"R{CreateAfterDiscount:N2}";
    public string CreateTaxableDisplay       => $"R{CreateTaxable:N2}";
    public string CreateVatAmountDisplay     => CreateVatMode == "none" ? "—" : $"R{CreateVatAmount:N2}";
    public string CreateGrandTotalDisplay    => $"R{CreateGrandTotal:N2}";
    public string CreateVatLabel             => CreateVatMode == "inclusive" ? "VAT (extracted)" : $"VAT ({CreateVatRatePct}%)";
    public bool   CreateShowVatRate          => CreateVatMode != "none";

    // Per-adjustment display for the totals panel
    public string CreateDiscountLineDisplay      => CreateDiscount      > 0 ? $"−R{CreateDiscount:N2}"      : "—";
    public string CreateFreightLineDisplay       => CreateFreight       > 0 ? $"+R{CreateFreight:N2}"       : "—";
    public string CreateDutyLineDisplay          => CreateDuty          > 0 ? $"+R{CreateDuty:N2}"          : "—";
    public string CreateLeviesLineDisplay        => CreateLevies        > 0 ? $"+R{CreateLevies:N2}"        : "—";
    public string CreateOtherChargesLineDisplay  => CreateOtherCharges  > 0 ? $"+R{CreateOtherCharges:N2}"  : "—";

    // ── Upload form ─────────────────────────────────────────────────────────
    [ObservableProperty] private string    _uploadTitle           = "";
    [ObservableProperty] private string    _uploadDescription     = "";
    [ObservableProperty] private string    _uploadQuoteNumber     = "";
    [ObservableProperty] private string    _uploadAmountText      = "";   // base amount entered by user

    // VAT mode — same friendly-label approach as Create form
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadVatMode), nameof(UploadVatModeDescription),
                               nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay),
                               nameof(UploadAmountLabel), nameof(UploadShowVatRate))]
    private string _uploadVatModeDisplay = "None"; // default: no VAT

    public string UploadVatMode        => VatLabelToValue(_uploadVatModeDisplay);
    public string UploadVatModeDescription => VatValueToDescription(UploadVatMode);

    // VAT rate as percentage text (e.g. "15" means 15% → 0.15)
    private decimal _uploadVatRate = 0.15m;
    public  decimal UploadVatRate  => _uploadVatRate;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private string _uploadVatRatePct = "15";

    // Discount — bidirectional Amount ↔ % (base = UploadBaseAmount)
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private decimal _uploadDiscount;
    [ObservableProperty] private string _uploadDiscountPct = "";

    // Freight — bidirectional Amount ↔ % (base = base amount after discount)
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private decimal _uploadFreight;
    [ObservableProperty] private string _uploadFreightPct = "";

    // Duty — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private decimal _uploadDuty;
    [ObservableProperty] private string _uploadDutyPct = "";

    // Levies — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private decimal _uploadLevies;
    [ObservableProperty] private string _uploadLeviesPct = "";

    // Other Charges — bidirectional Amount ↔ %
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UploadTaxable), nameof(UploadVatAmount), nameof(UploadTotal),
                               nameof(UploadTaxableDisplay), nameof(UploadVatDisplay), nameof(UploadTotalDisplay))]
    private decimal _uploadOtherCharges;
    [ObservableProperty] private string _uploadOtherChargesPct = "";

    [ObservableProperty] private string    _uploadValidUntilText  = "";
    [ObservableProperty] private string    _uploadNotes           = "";
    [ObservableProperty] private FileResult? _pickedQuoteFile;
    [ObservableProperty] private string    _pickedQuoteFileName   = "No file selected";

    private decimal UploadBaseAmount      => decimal.TryParse(UploadAmountText, out var v) ? v : 0m;
    private decimal UploadAfterDiscountRaw => UploadBaseAmount - UploadDiscount;

    public decimal UploadTaxable    => UploadAfterDiscountRaw + UploadFreight + UploadDuty + UploadLevies + UploadOtherCharges;
    public decimal UploadVatAmount  => UploadVatMode switch
    {
        "none"      => 0m,
        "inclusive" => Math.Round(UploadTaxable * _uploadVatRate / (1 + _uploadVatRate), 2),
        _           => Math.Round(UploadTaxable * _uploadVatRate, 2)
    };
    public decimal UploadTotal      => UploadVatMode switch
    {
        "exclusive" => UploadTaxable + UploadVatAmount,
        _           => UploadTaxable
    };

    public string UploadAmountLabel  => UploadVatMode switch
    {
        "inclusive" => "Total Amount (incl. VAT)",
        "none"      => "Total Amount",
        _           => "Amount (excl. VAT)"
    };
    public string UploadTaxableDisplay => $"R{UploadTaxable:N2}";
    public string UploadVatDisplay     => UploadVatMode == "none" ? "—" : $"R{UploadVatAmount:N2}";
    public string UploadTotalDisplay   => $"R{UploadTotal:N2}";
    public bool   UploadShowVatRate    => UploadVatMode != "none";

    // Per-adjustment display for Upload totals panel
    public string UploadDiscountLineDisplay     => UploadDiscount     > 0 ? $"−R{UploadDiscount:N2}"     : "—";
    public string UploadFreightLineDisplay      => UploadFreight      > 0 ? $"+R{UploadFreight:N2}"      : "—";
    public string UploadDutyLineDisplay         => UploadDuty         > 0 ? $"+R{UploadDuty:N2}"         : "—";
    public string UploadLeviesLineDisplay       => UploadLevies       > 0 ? $"+R{UploadLevies:N2}"       : "—";
    public string UploadOtherChargesLineDisplay => UploadOtherCharges > 0 ? $"+R{UploadOtherCharges:N2}" : "—";

    // ── Detail view ─────────────────────────────────────────────────────────
    [ObservableProperty] private ContractorQuote? _selectedQuote;

    // ── Filtered quote list ─────────────────────────────────────────────────
    partial void OnQuotesFilterChanged(string _)    => ApplyQuoteFilter();
    partial void OnPortalQuotesChanged(ObservableCollection<ContractorQuote> _) => ApplyQuoteFilter();

    [ObservableProperty] private ObservableCollection<ContractorQuote> _filteredQuotes = [];

    private void ApplyQuoteFilter()
    {
        var filtered = QuotesFilter switch
        {
            "Drafts"   => PortalQuotes.Where(q => q.Status == "draft"),
            // "Active" = all in-flight states: submitted + under review + revision requested
            "Active"   => PortalQuotes.Where(q =>
                              q.Status is "submitted" or "under_review" or "revision_requested"),
            "Approved" => PortalQuotes.Where(q => q.Status == "approved"),
            "Rejected" => PortalQuotes.Where(q => q.Status == "rejected"),
            "Expired"  => PortalQuotes.Where(q => q.Status == "expired"),
            _          => PortalQuotes.AsEnumerable(),   // "All" shows every status
        };
        FilteredQuotes = new ObservableCollection<ContractorQuote>(filtered);
    }

    // ── Live totals: subscribe to each row so any cell edit recalculates ────────
    //
    // Problem: OnCreateLineItemsChanged fires when the whole collection is REPLACED
    // (ShowCreateQuote / EditDraft), NOT when individual row properties change.
    // Fix: hook CollectionChanged to track add/remove, and subscribe to each
    // QuoteLineItemRow.PropertyChanged so any keystroke recalculates totals.

    partial void OnCreateLineItemsChanged(ObservableCollection<QuoteLineItemRow> value)
    {
        WireLineItemSubscriptions();
        NotifyCreateTotals();
    }

    private void WireLineItemSubscriptions()
    {
        if (_createLineItems == null) return;
        _createLineItems.CollectionChanged -= OnLineItemsCollectionChanged;
        _createLineItems.CollectionChanged += OnLineItemsCollectionChanged;
        foreach (var row in _createLineItems)
            SubscribeRow(row);
    }

    private void OnLineItemsCollectionChanged(
        object? sender,
        System.Collections.Specialized.NotifyCollectionChangedEventArgs e)
    {
        if (e.NewItems != null)
            foreach (QuoteLineItemRow row in e.NewItems)
                SubscribeRow(row);
        if (e.OldItems != null)
            foreach (QuoteLineItemRow row in e.OldItems)
                UnsubscribeRow(row);
        NotifyCreateTotals();
    }

    private void SubscribeRow(QuoteLineItemRow row)
    {
        row.PropertyChanged -= RowPropertyChanged;
        row.PropertyChanged += RowPropertyChanged;
    }

    private void UnsubscribeRow(QuoteLineItemRow row)
        => row.PropertyChanged -= RowPropertyChanged;

    private void RowPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
        => NotifyCreateTotals();

    private void NotifyCreateTotals()
    {
        // Refresh pct displays whenever the base amounts change
        RecalcCreatePcts();

        OnPropertyChanged(nameof(CreateLineSubtotal));   OnPropertyChanged(nameof(CreateLineSubtotalDisplay));
        OnPropertyChanged(nameof(CreateAfterDiscount));  OnPropertyChanged(nameof(CreateAfterDiscountDisplay));
        OnPropertyChanged(nameof(CreateTaxable));        OnPropertyChanged(nameof(CreateTaxableDisplay));
        OnPropertyChanged(nameof(CreateVatAmount));      OnPropertyChanged(nameof(CreateVatAmountDisplay));
        OnPropertyChanged(nameof(CreateGrandTotal));     OnPropertyChanged(nameof(CreateGrandTotalDisplay));

        OnPropertyChanged(nameof(CreateDiscountLineDisplay));
        OnPropertyChanged(nameof(CreateFreightLineDisplay));
        OnPropertyChanged(nameof(CreateDutyLineDisplay));
        OnPropertyChanged(nameof(CreateLeviesLineDisplay));
        OnPropertyChanged(nameof(CreateOtherChargesLineDisplay));
    }

    partial void OnUploadAmountTextChanged(string _)    => NotifyUploadTotals();
    private void NotifyUploadTotals()
    {
        RecalcUploadPcts();

        OnPropertyChanged(nameof(UploadTaxable));         OnPropertyChanged(nameof(UploadTaxableDisplay));
        OnPropertyChanged(nameof(UploadVatAmount));       OnPropertyChanged(nameof(UploadVatDisplay));
        OnPropertyChanged(nameof(UploadTotal));           OnPropertyChanged(nameof(UploadTotalDisplay));

        OnPropertyChanged(nameof(UploadDiscountLineDisplay));
        OnPropertyChanged(nameof(UploadFreightLineDisplay));
        OnPropertyChanged(nameof(UploadDutyLineDisplay));
        OnPropertyChanged(nameof(UploadLeviesLineDisplay));
        OnPropertyChanged(nameof(UploadOtherChargesLineDisplay));
    }

    // ── Bidirectional pct ↔ amount sync — Create form ──────────────────────
    //
    // Each pair uses a reentrancy guard to prevent A→B→A loops.
    // Rule: the LAST user-edited field wins; the other is recalculated.
    // Base for discount % = CreateLineSubtotal.
    // Base for charge %   = CreateAfterDiscount (subtotal after quote-level discount).

    // VAT rate is one-directional: user enters a % text → internal decimal is updated.
    // No reverse hook needed (the decimal is never set independently).
    partial void OnCreateVatRatePctChanged(string value)
    {
        if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var pct))
            _createVatRate = Math.Round(pct / 100m, 4);
    }

    private bool _syncingCDiscount;
    partial void OnCreateDiscountChanged(decimal value)
    {
        if (_syncingCDiscount) return;
        _syncingCDiscount = true;
        try
        {
            CreateDiscountPct = CreateLineSubtotal > 0
                ? (value / CreateLineSubtotal * 100m).ToString("N2")
                : (value > 0 ? "" : "0.00");
        }
        finally { _syncingCDiscount = false; }
    }
    partial void OnCreateDiscountPctChanged(string value)
    {
        if (_syncingCDiscount) return;
        _syncingCDiscount = true;
        try
        {
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct)
                && CreateLineSubtotal > 0)
                CreateDiscount = Math.Round(CreateLineSubtotal * pct / 100m, 2);
        }
        finally { _syncingCDiscount = false; }
    }

    private bool _syncingCFreight;
    partial void OnCreateFreightChanged(decimal value)
    {
        if (_syncingCFreight) return;
        _syncingCFreight = true;
        try
        {
            var b = CreateAfterDiscount;
            CreateFreightPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingCFreight = false; }
    }
    partial void OnCreateFreightPctChanged(string value)
    {
        if (_syncingCFreight) return;
        _syncingCFreight = true;
        try
        {
            var b = CreateAfterDiscount;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                CreateFreight = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingCFreight = false; }
    }

    private bool _syncingCDuty;
    partial void OnCreateDutyChanged(decimal value)
    {
        if (_syncingCDuty) return;
        _syncingCDuty = true;
        try
        {
            var b = CreateAfterDiscount;
            CreateDutyPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingCDuty = false; }
    }
    partial void OnCreateDutyPctChanged(string value)
    {
        if (_syncingCDuty) return;
        _syncingCDuty = true;
        try
        {
            var b = CreateAfterDiscount;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                CreateDuty = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingCDuty = false; }
    }

    private bool _syncingCLevies;
    partial void OnCreateLeviesChanged(decimal value)
    {
        if (_syncingCLevies) return;
        _syncingCLevies = true;
        try
        {
            var b = CreateAfterDiscount;
            CreateLeviesPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingCLevies = false; }
    }
    partial void OnCreateLeviesPctChanged(string value)
    {
        if (_syncingCLevies) return;
        _syncingCLevies = true;
        try
        {
            var b = CreateAfterDiscount;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                CreateLevies = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingCLevies = false; }
    }

    private bool _syncingCOther;
    partial void OnCreateOtherChargesChanged(decimal value)
    {
        if (_syncingCOther) return;
        _syncingCOther = true;
        try
        {
            var b = CreateAfterDiscount;
            CreateOtherChargesPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingCOther = false; }
    }
    partial void OnCreateOtherChargesPctChanged(string value)
    {
        if (_syncingCOther) return;
        _syncingCOther = true;
        try
        {
            var b = CreateAfterDiscount;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                CreateOtherCharges = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingCOther = false; }
    }

    /// <summary>
    /// Refreshes pct display strings when the calculation base changes (e.g. a line item
    /// was edited and the subtotal moved).  Amounts are kept; pcts are recalculated.
    /// Called from NotifyCreateTotals().
    /// </summary>
    private void RecalcCreatePcts()
    {
        var sub  = CreateLineSubtotal;
        var post = CreateAfterDiscount;

        if (!_syncingCDiscount)
        {
            _syncingCDiscount = true;
            try
            {
                CreateDiscountPct = sub > 0 && CreateDiscount > 0
                    ? (CreateDiscount / sub * 100m).ToString("N2") : "0.00";
            }
            finally { _syncingCDiscount = false; }
        }
        if (!_syncingCFreight)
        {
            _syncingCFreight = true;
            try { CreateFreightPct = post > 0 && CreateFreight > 0 ? (CreateFreight / post * 100m).ToString("N2") : "0.00"; }
            finally { _syncingCFreight = false; }
        }
        if (!_syncingCDuty)
        {
            _syncingCDuty = true;
            try { CreateDutyPct = post > 0 && CreateDuty > 0 ? (CreateDuty / post * 100m).ToString("N2") : "0.00"; }
            finally { _syncingCDuty = false; }
        }
        if (!_syncingCLevies)
        {
            _syncingCLevies = true;
            try { CreateLeviesPct = post > 0 && CreateLevies > 0 ? (CreateLevies / post * 100m).ToString("N2") : "0.00"; }
            finally { _syncingCLevies = false; }
        }
        if (!_syncingCOther)
        {
            _syncingCOther = true;
            try { CreateOtherChargesPct = post > 0 && CreateOtherCharges > 0 ? (CreateOtherCharges / post * 100m).ToString("N2") : "0.00"; }
            finally { _syncingCOther = false; }
        }
    }

    // ── Bidirectional pct ↔ amount sync — Upload form ───────────────────────
    //
    // Base for discount % = UploadBaseAmount.
    // Base for charge %   = UploadAfterDiscountRaw (base amount after discount).

    partial void OnUploadVatRatePctChanged(string value)
    {
        if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var pct))
            _uploadVatRate = Math.Round(pct / 100m, 4);
        NotifyUploadTotals();
    }

    private bool _syncingUDiscount;
    partial void OnUploadDiscountChanged(decimal value)
    {
        if (_syncingUDiscount) return;
        _syncingUDiscount = true;
        try
        {
            var b = UploadBaseAmount;
            UploadDiscountPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingUDiscount = false; }
    }
    partial void OnUploadDiscountPctChanged(string value)
    {
        if (_syncingUDiscount) return;
        _syncingUDiscount = true;
        try
        {
            var b = UploadBaseAmount;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                UploadDiscount = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingUDiscount = false; }
    }

    private bool _syncingUFreight;
    partial void OnUploadFreightChanged(decimal value)
    {
        if (_syncingUFreight) return;
        _syncingUFreight = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            UploadFreightPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingUFreight = false; }
    }
    partial void OnUploadFreightPctChanged(string value)
    {
        if (_syncingUFreight) return;
        _syncingUFreight = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                UploadFreight = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingUFreight = false; }
    }

    private bool _syncingUDuty;
    partial void OnUploadDutyChanged(decimal value)
    {
        if (_syncingUDuty) return;
        _syncingUDuty = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            UploadDutyPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingUDuty = false; }
    }
    partial void OnUploadDutyPctChanged(string value)
    {
        if (_syncingUDuty) return;
        _syncingUDuty = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                UploadDuty = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingUDuty = false; }
    }

    private bool _syncingULevies;
    partial void OnUploadLeviesChanged(decimal value)
    {
        if (_syncingULevies) return;
        _syncingULevies = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            UploadLeviesPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingULevies = false; }
    }
    partial void OnUploadLeviesPctChanged(string value)
    {
        if (_syncingULevies) return;
        _syncingULevies = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                UploadLevies = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingULevies = false; }
    }

    private bool _syncingUOther;
    partial void OnUploadOtherChargesChanged(decimal value)
    {
        if (_syncingUOther) return;
        _syncingUOther = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            UploadOtherChargesPct = b > 0 ? (value / b * 100m).ToString("N2") : (value > 0 ? "" : "0.00");
        }
        finally { _syncingUOther = false; }
    }
    partial void OnUploadOtherChargesPctChanged(string value)
    {
        if (_syncingUOther) return;
        _syncingUOther = true;
        try
        {
            var b = UploadAfterDiscountRaw;
            if (decimal.TryParse(value, System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var pct) && b > 0)
                UploadOtherCharges = Math.Round(b * pct / 100m, 2);
        }
        finally { _syncingUOther = false; }
    }

    private void RecalcUploadPcts()
    {
        var base_  = UploadBaseAmount;
        var post   = UploadAfterDiscountRaw;

        if (!_syncingUDiscount)
        {
            _syncingUDiscount = true;
            try { UploadDiscountPct  = base_ > 0 && UploadDiscount     > 0 ? (UploadDiscount     / base_ * 100m).ToString("N2") : "0.00"; }
            finally { _syncingUDiscount = false; }
        }
        if (!_syncingUFreight)
        {
            _syncingUFreight = true;
            try { UploadFreightPct   = post  > 0 && UploadFreight      > 0 ? (UploadFreight      / post  * 100m).ToString("N2") : "0.00"; }
            finally { _syncingUFreight = false; }
        }
        if (!_syncingUDuty)
        {
            _syncingUDuty = true;
            try { UploadDutyPct      = post  > 0 && UploadDuty         > 0 ? (UploadDuty         / post  * 100m).ToString("N2") : "0.00"; }
            finally { _syncingUDuty = false; }
        }
        if (!_syncingULevies)
        {
            _syncingULevies = true;
            try { UploadLeviesPct    = post  > 0 && UploadLevies       > 0 ? (UploadLevies       / post  * 100m).ToString("N2") : "0.00"; }
            finally { _syncingULevies = false; }
        }
        if (!_syncingUOther)
        {
            _syncingUOther = true;
            try { UploadOtherChargesPct = post > 0 && UploadOtherCharges > 0 ? (UploadOtherCharges / post * 100m).ToString("N2") : "0.00"; }
            finally { _syncingUOther = false; }
        }
    }

    // ── Quote load (lazy) ───────────────────────────────────────────────────
    private async Task LoadQuotesAsync(Guid contractorId, Guid companyId)
    {
        if (QuotesLoading) return;
        QuotesLoading = true;
        try
        {
            var quotes = await _storage.ContractorPortalListQuotesAsync(contractorId, companyId);
            PortalQuotes = new ObservableCollection<ContractorQuote>(quotes);
            QuotesLoaded = true;
        }
        catch { /* non-fatal */ }
        finally { QuotesLoading = false; }
    }

    // ── Navigation commands ─────────────────────────────────────────────────

    [RelayCommand]
    private void ShowCreateQuote()
    {
        _editingQuoteId      = null;
        CreateTitle          = ""; CreateDescription = ""; CreateQuoteNumber = "";
        CreateValidUntilText = "";
        CreateVatModeDisplay = "None"; CreateVatRatePct = "15";  _createVatRate = 0.15m;
        CreateDiscount       = 0; CreateDiscountPct   = "0.00";
        CreateFreight        = 0; CreateFreightPct    = "0.00";
        CreateDuty           = 0; CreateDutyPct       = "0.00";
        CreateLevies         = 0; CreateLeviesPct     = "0.00";
        CreateOtherCharges   = 0; CreateOtherChargesPct = "0.00";
        CreateTerms          = ""; CreateNotes = "";
        CreateLineItems      = [new QuoteLineItemRow()];
        QuotesView = "create";
    }

    [RelayCommand]
    private void ShowUploadQuote()
    {
        UploadTitle          = ""; UploadDescription = ""; UploadQuoteNumber = "";
        UploadAmountText     = "";
        UploadVatModeDisplay = "None"; UploadVatRatePct = "15"; _uploadVatRate = 0.15m;
        UploadDiscount       = 0; UploadDiscountPct   = "0.00";
        UploadFreight        = 0; UploadFreightPct    = "0.00";
        UploadDuty           = 0; UploadDutyPct       = "0.00";
        UploadLevies         = 0; UploadLeviesPct     = "0.00";
        UploadOtherCharges   = 0; UploadOtherChargesPct = "0.00";
        UploadValidUntilText = ""; UploadNotes = "";
        PickedQuoteFile      = null; PickedQuoteFileName = "No file selected";
        QuotesView = "upload";
    }

    [RelayCommand]
    private async Task ViewQuoteAsync(ContractorQuote quote)
    {
        if (quote == null) return;
        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        await RunAsync(async () =>
        {
            var full = await _storage.ContractorPortalGetQuoteAsync(
                session.Value.ContractorId, session.Value.CompanyId, quote.Id);
            SelectedQuote = full ?? quote;
            QuotesView = "detail";
        });
    }

    [RelayCommand]
    private void EditDraft(ContractorQuote quote)
    {
        // Phase 2D.3: also allow editing revision_requested quotes
        if (quote == null || !quote.CanEdit) return;
        _editingQuoteId      = quote.Id;
        CreateTitle          = quote.Title;
        CreateDescription    = quote.Description ?? "";
        CreateQuoteNumber    = quote.QuoteNumber ?? "";
        CreateValidUntilText = quote.ValidUntil.HasValue
                               ? quote.ValidUntil.Value.ToString("dd/MM/yyyy") : "";
        CreateVatModeDisplay = VatValueToLabel(quote.VatMode);
        _createVatRate       = quote.VatRate;
        CreateVatRatePct     = (quote.VatRate * 100m).ToString("G");
        CreateDiscount       = quote.DiscountAmount;
        CreateFreight        = quote.FreightAmount;
        CreateDuty           = quote.DutyAmount;
        CreateLevies         = quote.LeviesAmount;
        CreateOtherCharges   = quote.OtherChargesAmount;
        CreateTerms          = quote.Terms ?? "";
        CreateNotes          = quote.ContractorNotes ?? "";
        CreateLineItems      = new ObservableCollection<QuoteLineItemRow>(
            quote.Items.Count > 0
            ? quote.Items.Select(QuoteLineItemRow.FromModel)
            : [new QuoteLineItemRow()]);
        QuotesView = "create";
    }

    [RelayCommand]
    private void AddLineItem() => CreateLineItems.Add(new QuoteLineItemRow());

    [RelayCommand]
    private void RemoveLineItem(QuoteLineItemRow row)
    {
        if (CreateLineItems.Count > 1) CreateLineItems.Remove(row);
    }

    [RelayCommand]
    private void BackToQuoteList()
    {
        QuotesView = "list";
        // Reload so contractor immediately sees any HR decision that arrived while
        // they were viewing / editing a quote (approved, rejected, revision requested).
        var qs = ContractorPortalSessionStore.Get();
        if (qs != null && !QuotesLoading)
            _ = LoadQuotesAsync(qs.Value.ContractorId, qs.Value.CompanyId);
    }

    // ── Pick file ───────────────────────────────────────────────────────────

    [RelayCommand]
    private async Task PickQuoteFileAsync()
    {
        var file = await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = "Select quote document (PDF, Word, image)",
            FileTypes   = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
            {
                [DevicePlatform.WinUI]       = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"],
                [DevicePlatform.Android]     = ["application/pdf", "application/msword", "image/jpeg", "image/png"],
                [DevicePlatform.iOS]         = ["public.data", "public.image", "com.adobe.pdf"],
                [DevicePlatform.MacCatalyst] = ["public.data", "public.image", "com.adobe.pdf"],
            })
        });
        if (file == null) return;
        PickedQuoteFile     = file;
        PickedQuoteFileName = file.FileName;
    }

    // ── Save draft command ──────────────────────────────────────────────────

    [RelayCommand]
    private async Task SaveDraftAsync()
    {
        if (string.IsNullOrWhiteSpace(CreateTitle))
        {
            await Shell.Current.DisplayAlert("Required", "Quote title is required.", "OK");
            return;
        }
        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        DateOnly? validUntil = null;
        if (!string.IsNullOrWhiteSpace(CreateValidUntilText)
            && DateOnly.TryParseExact(CreateValidUntilText.Trim(), "dd/MM/yyyy",
               System.Globalization.CultureInfo.InvariantCulture,
               System.Globalization.DateTimeStyles.None, out var vd))
            validUntil = vd;

        await RunAsync(async () =>
        {
            var qid = await _storage.ContractorPortalSaveQuoteDraftAsync(
                session.Value.ContractorId, session.Value.CompanyId,
                _editingQuoteId,
                CreateTitle, CreateDescription, CreateQuoteNumber,
                validUntil,
                CreateVatMode, CreateVatRate,
                CreateDiscount, CreateFreight, CreateDuty, CreateLevies, CreateOtherCharges,
                CreateTerms, CreateNotes,
                CreateLineItems.ToList());

            if (qid == Guid.Empty)
                throw new Exception("Draft could not be saved. Please check your entries and try again.");

            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
            QuotesView = "list";
        });
    }

    // ── Submit draft command ────────────────────────────────────────────────

    [RelayCommand]
    private async Task SaveAndSubmitQuoteAsync()
    {
        if (string.IsNullOrWhiteSpace(CreateTitle))
        {
            await Shell.Current.DisplayAlert("Required", "Quote title is required.", "OK");
            return;
        }
        if (!CreateLineItems.Any(i => i.Subtotal > 0))
        {
            await Shell.Current.DisplayAlert("Required", "Add at least one line item with a value.", "OK");
            return;
        }

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        DateOnly? validUntil = null;
        if (!string.IsNullOrWhiteSpace(CreateValidUntilText)
            && DateOnly.TryParseExact(CreateValidUntilText.Trim(), "dd/MM/yyyy",
               System.Globalization.CultureInfo.InvariantCulture,
               System.Globalization.DateTimeStyles.None, out var vd))
            validUntil = vd;

        await RunAsync(async () =>
        {
            // 1. Save/update draft (FIX: no DBNull, returns valid uuid or throws)
            var qid = await _storage.ContractorPortalSaveQuoteDraftAsync(
                session.Value.ContractorId, session.Value.CompanyId,
                _editingQuoteId,
                CreateTitle, CreateDescription, CreateQuoteNumber,
                validUntil,
                CreateVatMode, CreateVatRate,
                CreateDiscount, CreateFreight, CreateDuty, CreateLevies, CreateOtherCharges,
                CreateTerms, CreateNotes,
                CreateLineItems.ToList());

            if (qid == Guid.Empty)
                throw new Exception("Draft could not be saved — please try again.");

            // 2. Submit the saved draft
            await _storage.ContractorPortalSubmitQuoteAsync(
                session.Value.ContractorId, session.Value.CompanyId, qid);

            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
            QuotesView = "list";
        });
    }

    [RelayCommand]
    private async Task SubmitExistingDraftAsync(ContractorQuote quote)
    {
        if (quote == null) return;
        var confirmed = await Shell.Current.DisplayAlert(
            "Submit Quote", $"Submit '{quote.Title}' to HR?", "Submit", "Cancel");
        if (!confirmed) return;

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        await RunAsync(async () =>
        {
            await _storage.ContractorPortalSubmitQuoteAsync(
                session.Value.ContractorId, session.Value.CompanyId, quote.Id);
            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
        });
    }

    // ── Phase 2D.3: Resubmit after revision was requested ──────────────────

    [RelayCommand]
    private async Task ResubmitQuoteAsync(ContractorQuote quote)
    {
        if (quote == null || !quote.CanResubmit) return;

        var confirmed = await Shell.Current.DisplayAlert(
            "Resubmit Quote",
            $"Resubmit '{quote.Title}' to HR for review?\n\n" +
            "Make sure you've addressed the revision comments before resubmitting.",
            "Resubmit", "Cancel");
        if (!confirmed) return;

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        await RunAsync(async () =>
        {
            await _storage.ContractorPortalResubmitQuoteAsync(
                session.Value.ContractorId, session.Value.CompanyId, quote.Id);
            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
            QuotesView = "list";
        });
    }

    // ── Upload submit command ───────────────────────────────────────────────

    [RelayCommand]
    private async Task SubmitUploadedQuoteAsync()
    {
        if (string.IsNullOrWhiteSpace(UploadTitle))
        {
            await Shell.Current.DisplayAlert("Required", "Quote title is required.", "OK");
            return;
        }
        if (PickedQuoteFile == null)
        {
            await Shell.Current.DisplayAlert("Required", "Please select a quote document to upload.", "OK");
            return;
        }

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        DateOnly? validUntil = null;
        if (!string.IsNullOrWhiteSpace(UploadValidUntilText)
            && DateOnly.TryParseExact(UploadValidUntilText.Trim(), "dd/MM/yyyy",
               System.Globalization.CultureInfo.InvariantCulture,
               System.Globalization.DateTimeStyles.None, out var vd))
            validUntil = vd;

        var baseAmount = decimal.TryParse(UploadAmountText, out var ba) ? ba : 0m;

        await RunAsync(async () =>
        {
            var qid = await _storage.ContractorPortalUploadQuoteAsync(
                session.Value.ContractorId, session.Value.CompanyId,
                PickedQuoteFile!,
                UploadTitle, UploadDescription, UploadQuoteNumber,
                UploadVatMode, UploadVatRate,
                baseAmount,
                UploadDiscount, UploadFreight, UploadDuty, UploadLevies, UploadOtherCharges,
                validUntil, UploadNotes);

            if (qid == Guid.Empty)
                throw new Exception("Upload could not be completed — please try again.");

            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
            QuotesView = "list";
        });
    }

    // ── Delete draft command ────────────────────────────────────────────────

    [RelayCommand]
    private async Task DeleteDraftAsync(ContractorQuote quote)
    {
        if (quote == null) return;
        var confirmed = await Shell.Current.DisplayAlert(
            "Delete Draft", $"Permanently delete draft '{quote.Title}'?", "Delete", "Cancel");
        if (!confirmed) return;

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        await RunAsync(async () =>
        {
            await _storage.ContractorPortalDeleteDraftAsync(
                session.Value.ContractorId, session.Value.CompanyId, quote.Id);
            await LoadQuotesAsync(session.Value.ContractorId, session.Value.CompanyId);
        });
    }

    // ── View document ────────────────────────────────────────────────────────

    [RelayCommand]
    private static async Task ViewQuoteDocumentAsync(ContractorQuoteAttachment att)
    {
        if (att == null || string.IsNullOrWhiteSpace(att.FileUrl)) return;
        try { await Launcher.OpenAsync(new Uri(att.FileUrl)); }
        catch { /* unavailable */ }
    }

    // ── Phase I: payments reload ──────────────────────────────────────────────

    private bool _paymentsReloading;

    private async Task ReloadPayoutsAsync(string companyCode, string contractorCode)
    {
        if (_paymentsReloading) return;
        _paymentsReloading = true;
        try
        {
            var payouts = await _storage.GetContractorPortalPayoutsAsync(companyCode, contractorCode);
            Payouts = new ObservableCollection<ContractorPayout>(payouts);
            var outstanding = payouts.Where(p => p.PayoutStatusRaw != "paid").Sum(p => p.NetPayable);
            OutstandingPayoutsDisplay = $"R{outstanding:N2}";
        }
        catch { /* non-fatal */ }
        finally { _paymentsReloading = false; }
    }

    // ── Phase 2C.3: Banking self-service ─────────────────────────────────────

    private async Task LoadBankingAsync(Guid contractorId, Guid companyId)
    {
        if (BankingLoading) return;
        BankingLoading = true;
        try
        {
            var status   = await _storage.ContractorPortalGetBankingAsync(contractorId, companyId);
            var decision = await _storage.ContractorPortalGetLatestBankingDecisionAsync(contractorId, companyId);
            _bankingStatus         = status;
            _latestBankingDecision = decision;
            BankingLoaded = true;
            NotifyBankingProperties();
        }
        catch { /* non-fatal */ }
        finally { BankingLoading = false; }
    }

    private void NotifyBankingProperties()
    {
        OnPropertyChanged(nameof(BankAccountHolder));
        OnPropertyChanged(nameof(BankBankName));
        OnPropertyChanged(nameof(BankMaskedAccount));
        OnPropertyChanged(nameof(BankBranchCode));
        OnPropertyChanged(nameof(BankAccountType));
        OnPropertyChanged(nameof(BankSwiftBic));
        OnPropertyChanged(nameof(BankHasDetails));
        OnPropertyChanged(nameof(BankVerified));
        OnPropertyChanged(nameof(BankPaymentHold));
        OnPropertyChanged(nameof(BankComplianceHold));
        OnPropertyChanged(nameof(BankPaymentTerms));
        OnPropertyChanged(nameof(BankPaymentMethod));
        OnPropertyChanged(nameof(HasPendingBanking));
        OnPropertyChanged(nameof(HasApprovedDecision));
        OnPropertyChanged(nameof(HasRejectedDecision));
        OnPropertyChanged(nameof(PendingBankSubmittedAt));
        OnPropertyChanged(nameof(PendingBankAccountHolder));
        OnPropertyChanged(nameof(PendingBankBankName));
        OnPropertyChanged(nameof(PendingBankMaskedAccount));
        OnPropertyChanged(nameof(PendingBankBranchCode));
        OnPropertyChanged(nameof(PendingBankAccountType));
        OnPropertyChanged(nameof(DecisionReviewedAt));
        OnPropertyChanged(nameof(DecisionRejectionReason));
    }

    [RelayCommand]
    private async Task SubmitBankingAsync()
    {
        if (string.IsNullOrWhiteSpace(EditBankAccountHolder))
        {
            await Shell.Current.DisplayAlert("Required", "Account holder name is required.", "OK");
            return;
        }
        if (string.IsNullOrWhiteSpace(EditBankName))
        {
            await Shell.Current.DisplayAlert("Required", "Bank name is required.", "OK");
            return;
        }
        if (string.IsNullOrWhiteSpace(EditBankAccount))
        {
            await Shell.Current.DisplayAlert("Required", "Account number is required.", "OK");
            return;
        }

        // Warn if replacing an existing pending update
        if (HasPendingBanking)
        {
            var confirmed = await Shell.Current.DisplayAlert(
                "Replace Pending Update",
                "You already have a pending banking update awaiting HR review. "
                + "Submitting new details will replace your previous submission. Continue?",
                "Yes, Replace", "Cancel");
            if (!confirmed) return;
        }

        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        var accountTypeRaw = AccountTypeLabelToRaw.TryGetValue(EditAccountTypeLabel, out var raw)
            ? raw : "cheque";

        await RunAsync(async () =>
        {
            await _storage.ContractorPortalSubmitBankingAsync(
                session.Value.ContractorId,
                session.Value.CompanyId,
                EditBankAccountHolder.Trim(),
                EditBankName.Trim(),
                EditBankAccount.Trim(),
                EditBranchCode.Trim(),
                accountTypeRaw,
                EditSwiftBic.Trim());

            // Clear the form after successful submission
            EditBankAccountHolder = "";
            EditBankName          = "";
            EditBankAccount       = "";
            EditBranchCode        = "";
            EditSwiftBic          = "";
            EditAccountTypeLabel  = "Cheque";

            // Reload banking state to show pending banner
            await LoadBankingAsync(session.Value.ContractorId, session.Value.CompanyId);
        });
    }

    /// <summary>
    /// Loads documents + pack items from Supabase via portal RPCs, then
    /// rebuilds the checklist and compliance score. Called on initial load
    /// and after every document upload.
    /// </summary>
    private async Task LoadComplianceAsync(Guid contractorId, Guid companyId)
    {
        var docs  = await _storage.ContractorPortalGetDocumentsAsync(contractorId, companyId);
        var items = await _storage.ContractorPortalGetCompliancePackAsync(contractorId, companyId);

        _portalPackItems = items;
        PortalDocuments  = new ObservableCollection<ContractorDocument>(docs);
        PortalHasPackAssigned = items.Count > 0;

        RebuildComplianceView();
    }

    // ── Compliance view builder ───────────────────────────────────────────────

    private void RebuildComplianceView()
    {
        var docs = PortalDocuments.ToList();

        if (_portalPackItems.Count > 0)
        {
            // ── Pack-based mode ──────────────────────────────────────────────
            PortalChecklist = BuildPortalChecklist(_portalPackItems, docs);

            var required = PortalChecklist.Where(r => r.IsRequired).ToList();
            PortalRequiredCount  = required.Count;
            PortalCompleteCount  = required.Count(r => r.CountsForScore);
            PortalMissingCount   = required.Count(r => r.Status == "missing");
            PortalExpiringCount  = required.Count(r => r.Status == "expiring");
            PortalRejectedCount  = required.Count(r => r.Status == "rejected");
            PortalApprovedCount  = docs.Count(d => d.IsApproved && !d.IsExpired);

            PortalScorePercent  = required.Count == 0 ? 0
                : (int)Math.Round(PortalCompleteCount * 100.0 / required.Count);
            PortalScoreProgress = required.Count == 0 ? 0.0
                : Math.Round(PortalCompleteCount / (double)required.Count, 2);

            // Missing section: pack items with no valid document
            MissingRows = new ObservableCollection<PackChecklistRow>(
                PortalChecklist.Where(r => r.Status is "missing" or "rejected" && r.IsRequired));
        }
        else
        {
            // ── Legacy mode: is_required per-document ────────────────────────
            PortalChecklist = [];
            MissingRows     = [];

            var req = docs.Where(d => d.IsRequired).ToList();
            PortalRequiredCount  = req.Count;
            PortalCompleteCount  = req.Count(d => d.IsApproved && !d.IsExpired);
            PortalMissingCount   = 0;
            PortalExpiringCount  = req.Count(d => d.IsExpiringSoon && !d.IsExpired);
            PortalRejectedCount  = req.Count(d => d.IsRejected);
            PortalApprovedCount  = docs.Count(d => d.IsApproved && !d.IsExpired);

            PortalScorePercent  = req.Count == 0 ? 0
                : (int)Math.Round(PortalCompleteCount * 100.0 / req.Count);
            PortalScoreProgress = req.Count == 0 ? 0.0
                : Math.Round(PortalCompleteCount / (double)req.Count, 2);
        }

        // Status label + colours
        var (label, bg, fg, scoreColor) = PortalRequiredCount == 0
            ? ("Not Configured", "#1E293B", "#64748B", "#64748B")
            : PortalScorePercent >= 100
                ? ("Compliant",      "#14532D", "#22C55E", "#22C55E")
                : PortalScorePercent >= 80
                    ? ("Near Compliant", "#14532D", "#86EFAC", "#22C55E")
                    : PortalScorePercent >= 50
                        ? ("Partial",        "#78350F", "#FCD34D", "#FCD34D")
                        : ("Non-Compliant",  "#7F1D1D", "#FCA5A5", "#EF4444");
        PortalStatusLabel   = label;
        PortalStatusBadgeBg = bg;
        PortalStatusBadgeFg = fg;
        PortalScoreColor    = scoreColor;

        // Expiring / rejected document lists (drive their table sections)
        ExpiringDocs = new ObservableCollection<ContractorDocument>(
            docs.Where(d => d.IsExpiringSoon && !d.IsExpired).OrderBy(d => d.ExpiryDate));

        RejectedDocs = new ObservableCollection<ContractorDocument>(
            docs.Where(d => d.IsRejected).OrderByDescending(d => d.CreatedAt));

        // Notify flat score properties
        OnPropertyChanged(nameof(PortalScorePercent));
        OnPropertyChanged(nameof(PortalScoreProgress));
        OnPropertyChanged(nameof(PortalStatusLabel));
        OnPropertyChanged(nameof(PortalStatusBadgeBg));
        OnPropertyChanged(nameof(PortalStatusBadgeFg));
        OnPropertyChanged(nameof(PortalScoreColor));
        OnPropertyChanged(nameof(PortalRequiredCount));
        OnPropertyChanged(nameof(PortalCompleteCount));
        OnPropertyChanged(nameof(PortalMissingCount));
        OnPropertyChanged(nameof(PortalExpiringCount));
        OnPropertyChanged(nameof(PortalRejectedCount));
        OnPropertyChanged(nameof(PortalApprovedCount));
        OnPropertyChanged(nameof(PortalHasPackAssigned));
        NotifyHomeProperties();
    }

    /// <summary>
    /// Identical logic to HrContractorDetailsViewModel.BuildPackChecklist.
    /// Kept separate to avoid modifying HR code.
    /// </summary>
    private static ObservableCollection<PackChecklistRow> BuildPortalChecklist(
        List<CompliancePackItem> packItems,
        List<ContractorDocument> docs)
    {
        var rows = packItems
            .OrderBy(i => !i.IsRequired)
            .ThenBy(i => i.SortOrder)
            .Select(item =>
            {
                var docsOfType = docs
                    .Where(d => d.DocumentType == item.DocumentType && d.IsCurrent)
                    .ToList();

                string status;
                string? expiryDisplay = null;

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
                    status = "pending";
                else if (docsOfType.Any(d => d.IsRejected))
                    status = "rejected";
                else
                    status = "missing";

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

    // ── Tab commands ──────────────────────────────────────────────────────────

    [RelayCommand] private void ShowHomeTab()         => PortalTab = "home";
    [RelayCommand] private void ShowInformationTab() => PortalTab = "information";
    [RelayCommand] private void ShowComplianceTab()  => PortalTab = "compliance";
    [RelayCommand] private void ShowBankingTab()     => PortalTab = "banking";
    [RelayCommand] private void ShowTeamTab()        => PortalTab = "team";
    [RelayCommand] private void ShowJobsTab()        => PortalTab = "jobs";
    [RelayCommand] private void ShowPaymentsTab()    => PortalTab = "payments";
    [RelayCommand] private void ShowQuotesTab()      => PortalTab = "quotes";

    // ── Navigation commands ───────────────────────────────────────────────────

    [RelayCommand]
    private async Task OpenJobAsync(Job job)
    {
        if (job == null) return;
        await ShellNavigation.GoToAsync(
            nameof(ContractorPortalJobDetailPage),
            new Dictionary<string, object> { ["JobId"] = job.Id.ToString() });
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        ContractorPortalSessionStore.ClearForSignOut();
        await ShellNavigation.GoToAsync("//IdEntry");
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    // ── Phase 2B.3c: Document upload commands ─────────────────────────────────

    /// <summary>
    /// Upload a NEW document for a required pack item that is currently missing.
    /// The document type is pre-filled from the PackChecklistRow.
    /// </summary>
    [RelayCommand]
    private async Task UploadMissingDocumentAsync(PackChecklistRow row)
    {
        if (row == null) return;
        await PickAndUploadAsync(row.DocumentType, row.TypeLabel, oldDocumentId: null);
    }

    /// <summary>
    /// Replace an expiring or rejected document with a newer version.
    /// The old document is superseded (is_current=false).
    /// </summary>
    [RelayCommand]
    private async Task ReplaceDocumentAsync(ContractorDocument doc)
    {
        if (doc == null) return;
        await PickAndUploadAsync(doc.DocumentType, doc.TypeLabel, oldDocumentId: doc.Id);
    }

    /// <summary>
    /// Open a submitted document in the default browser / file viewer.
    /// FileUrl is the signed storage URL generated when the file was uploaded.
    /// </summary>
    [RelayCommand]
    private static async Task ViewPortalDocumentAsync(ContractorDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try { await Launcher.OpenAsync(new Uri(doc.FileUrl)); }
        catch { /* browser unavailable or URI malformed — fail silently */ }
    }

    /// <summary>
    /// Upload an additional compliance document that is NOT in the missing-required list.
    /// The contractor selects the document type from the full allowed-types list.
    ///
    /// is_required note: the RPC always inserts is_required=false for portal uploads.
    /// Compliance scoring is pack-driven (contractor_compliance_pack_items), so the
    /// is_required flag on the document row is not used for score calculation.
    /// HR notifications fire automatically via contractor_portal_insert_document (Phase 2B.3c).
    /// </summary>
    [RelayCommand]
    private async Task UploadAdditionalDocumentAsync()
    {
        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        // Let the contractor pick any allowed document type
        var chosen = await Shell.Current.DisplayActionSheetAsync(
            "Select document type", "Cancel", null, PortalDocTypeLabels);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var typeIdx = Array.IndexOf(PortalDocTypeLabels, chosen);
        if (typeIdx < 0) return;

        var docType  = PortalDocTypeRaw[typeIdx];
        var docLabel = PortalDocTypeLabels[typeIdx];

        // Reuse the same upload flow (file picker → name → expiry → upload + notify)
        await PickAndUploadAsync(docType, docLabel, oldDocumentId: null);
    }

    /// <summary>
    /// Generic upload flow: pick file → name → expiry → upload via service.
    /// Used by UploadMissingDocument, ReplaceDocument, and UploadAdditionalDocument.
    /// </summary>
    private async Task PickAndUploadAsync(string docType, string typeLabel, Guid? oldDocumentId)
    {
        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        // 1 — pick file
        var fileResult = await FilePicker.PickAsync(new PickOptions
        {
            PickerTitle = $"Select {typeLabel} document (PDF, Word, image)",
            FileTypes   = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
            {
                [DevicePlatform.WinUI]       = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"],
                [DevicePlatform.Android]     = ["application/pdf", "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "image/jpeg", "image/png"],
                [DevicePlatform.iOS]         = ["public.data", "public.image", "com.adobe.pdf"],
                [DevicePlatform.MacCatalyst] = ["public.data", "public.image", "com.adobe.pdf"],
            })
        });
        if (fileResult == null) return;

        // 2 — document name
        var docName = await Shell.Current.DisplayPromptAsync(
            "Document name", $"Short description for this {typeLabel}:",
            "Upload", "Cancel", "e.g. SARS TCS Certificate 2026");
        if (string.IsNullOrWhiteSpace(docName)) return;

        // 3 — optional expiry date
        var expiryStr = await Shell.Current.DisplayPromptAsync(
            "Expiry date", "Date (dd/MM/yyyy) or leave blank if no expiry:",
            "OK", "Skip", "e.g. 31/03/2027");
        DateOnly? expiryDate = null;
        if (!string.IsNullOrWhiteSpace(expiryStr) &&
            DateOnly.TryParseExact(expiryStr.Trim(), "dd/MM/yyyy",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var parsed))
            expiryDate = parsed;

        // 4 — upload
        await RunAsync(async () =>
        {
            await _storage.ContractorPortalUploadDocumentAsync(
                session.Value.ContractorId,
                session.Value.CompanyId,
                fileResult,
                docType,
                docName.Trim(),
                expiryDate,
                oldDocumentId);

            // Reload compliance view after upload
            await LoadComplianceAsync(session.Value.ContractorId, session.Value.CompanyId);
        });
    }
}
