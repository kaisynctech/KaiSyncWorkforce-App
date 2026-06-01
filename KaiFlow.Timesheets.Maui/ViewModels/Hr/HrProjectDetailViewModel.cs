using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(DealId), "DealId")]
[QueryProperty(nameof(ClientId), "ClientId")]
public partial class HrProjectDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;
    private string _statusBeforeEdit = "draft";

    [ObservableProperty] private string _dealId = "";
    [ObservableProperty] private string _clientId = "";
    [ObservableProperty] private ClientDeal? _deal;
    [ObservableProperty] private Client? _client;
    [ObservableProperty] private ObservableCollection<Client> _clients = [];
    [ObservableProperty] private ObservableCollection<Employee> _employees = [];
    [ObservableProperty] private ObservableCollection<Contractor> _contractors = [];
    [ObservableProperty] private ObservableCollection<ClientDealUpdate> _activity = [];
    [ObservableProperty] private ObservableCollection<ProjectDocument> _documents = [];
    [ObservableProperty] private ObservableCollection<ProjectClientPayment> _clientPayments = [];
    [ObservableProperty] private ObservableCollection<ClientDealMessage> _clientMessages = [];
    [ObservableProperty] private string _clientReplyText = "";
    [ObservableProperty] private Client? _selectedClient;
    [ObservableProperty] private Employee? _selectedAssignee;
    [ObservableProperty] private Employee? _selectedManager;
    [ObservableProperty] private ObservableCollection<Employee> _managerCandidates = [];
    [ObservableProperty] private ObservableCollection<ProjectQuotationLine> _quotationLines = [];
    [ObservableProperty] private string _quotationNotes = "";
    [ObservableProperty] private DateTime _quotationValidUntilDate = DateTime.Today.AddDays(30);
    [ObservableProperty] private bool _useQuotationValidUntil = true;
    [ObservableProperty] private Contractor? _selectedContractor;
    [ObservableProperty] private ObservableCollection<Job> _projectJobs = [];
    [ObservableProperty] private PipelineStageOption? _selectedStage;
    [ObservableProperty] private ObservableCollection<PipelineStageChip> _stageChips = [];
    [ObservableProperty] private string _projectTitle = "";
    [ObservableProperty] private string _projectCode = "";
    [ObservableProperty] private string _offerAmountText = "0";
    [ObservableProperty] private string _depositRequiredText = "0";
    [ObservableProperty] private string _amountPaidText = "0";
    [ObservableProperty] private string _progressPercentText = "0";
    [ObservableProperty] private string _autoProgressHint = "";
    [ObservableProperty] private bool _progressIsAuto = true;
    [ObservableProperty] private DateTime _expectedCloseDate = DateTime.Today.AddDays(30);
    [ObservableProperty] private bool _useExpectedCloseDate = true;
    [ObservableProperty] private DateTime _siteStartDate = DateTime.Today;
    [ObservableProperty] private bool _useSiteStartDate;
    [ObservableProperty] private DateTime _expectedCompletionDate = DateTime.Today.AddDays(60);
    [ObservableProperty] private bool _useExpectedCompletionDate = true;
    [ObservableProperty] private DateTime _nextVisitDate = DateTime.Today.AddDays(7);
    [ObservableProperty] private bool _useNextVisitDate;
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private string _agreementNotes = "";
    [ObservableProperty] private string _newUpdateText = "";
    [ObservableProperty] private string _selectedDocumentTypeLabel = "Contract";
    [ObservableProperty] private string _detailTab = "details";

    public bool IsDetailsTab => DetailTab == "details";
    public bool IsDocsTab => DetailTab == "docs";
    public bool IsQuotationTab => DetailTab == "quotation";
    public bool IsPipelineTab => DetailTab == "pipeline";
    public bool IsPaymentsTab => DetailTab == "payments";
    public string SelectedDocumentTypeKey =>
        ProjectDocumentTypes.TypeKeys[
            Math.Max(0, Array.IndexOf(ProjectDocumentTypes.TypeLabels, SelectedDocumentTypeLabel))];

    public bool IsNew =>
        string.IsNullOrWhiteSpace(DealId) ||
        DealId.Equals("new", StringComparison.OrdinalIgnoreCase) ||
        !Guid.TryParse(DealId, out var id) ||
        id == Guid.Empty;
    public bool CanPickClient => IsNew;
    public string ClientDisplay => Client?.Name ?? "Internal (no client)";
    public bool HasLinkedJob => Deal?.JobId != null;
    public string ProjectJobsLabel => ProjectJobs.Count switch
    {
        0 => "No jobs on this project yet",
        1 => "1 job",
        _ => $"{ProjectJobs.Count} jobs"
    };
    public bool HasProjectCode => !string.IsNullOrWhiteSpace(ProjectCode);
    public bool CanPostUpdate => !IsNew && Deal != null;
    public bool CanReplyToClient => CanPostUpdate;
    public bool HasClientMessages => ClientMessages.Count > 0;
    public bool CanManageDocuments => !IsNew && Deal != null;
    public bool CanManageQuotation => !IsNew && Deal != null;
    public string QuotationTotalDisplay => $"R{QuotationLines.Sum(l => l.LineTotal):N2}";
    public string QuotationSentLabel => Deal?.QuotationSentDisplay ?? "Not sent yet";

    public IReadOnlyList<PipelineStageOption> PipelineStages => ProjectPipeline.Stages;
    public IReadOnlyList<string> DocumentTypeLabels => ProjectDocumentTypes.TypeLabels;
    public IReadOnlyList<string> DocumentTypeKeys => ProjectDocumentTypes.TypeKeys;

    public string BalanceDisplay => FormatMoney(Math.Max(0, ParseOffer() - ParsePaid()));
    public string DepositOutstandingDisplay => FormatMoney(Math.Max(0, ParseDeposit() - ParsePaid()));
    public string TotalPaidDisplay => FormatMoney(ParsePaid());
    public string PaymentsSummaryDisplay =>
        ClientPayments.Count == 0 ? "No payments recorded yet." : $"{ClientPayments.Count} payment(s) on file";
    public double ProgressFraction =>
        int.TryParse(ProgressPercentText, out var p) ? Math.Clamp(p, 0, 100) / 100.0 : 0;

    public HrProjectDetailViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export = export;
        _state = state;
        Title = "Project";
        _selectedStage = ProjectPipeline.Stages[0];
        StageChips = new ObservableCollection<PipelineStageChip>(
            ProjectPipeline.Stages.Select(s => new PipelineStageChip(s)));
        SyncStageChips();
    }

    /// <summary>Call from OnAppearing and when shell query parameters are applied.</summary>
    public void RequestReload()
    {
        NotifyProjectModeChanged();
        MainThread.BeginInvokeOnMainThread(async () => await LoadAsync());
    }

    partial void OnDealIdChanged(string value) => RequestReload();

    partial void OnClientIdChanged(string value)
    {
        if (IsNew)
            RequestReload();
    }

    private void NotifyProjectModeChanged()
    {
        OnPropertyChanged(nameof(IsNew));
        OnPropertyChanged(nameof(CanPickClient));
        OnPropertyChanged(nameof(CanPostUpdate));
        OnPropertyChanged(nameof(CanManageDocuments));
        OnPropertyChanged(nameof(CanManageQuotation));
        OnPropertyChanged(nameof(HasLinkedJob));
        OnPropertyChanged(nameof(HasProjectCode));
    }

    private void SyncStageChips()
    {
        var current = SelectedStage?.Value;
        foreach (var chip in StageChips)
            chip.IsSelected = chip.Stage.Value == current;
    }

    partial void OnOfferAmountTextChanged(string value)
    {
        NotifyFinancials();
        if (!IsNew && Deal != null)
            _ = EnsureQuotationOfferLineAsync();
    }
    partial void OnDepositRequiredTextChanged(string value) => NotifyFinancials();
    partial void OnAmountPaidTextChanged(string value)
    {
        NotifyFinancials();
        OnPropertyChanged(nameof(TotalPaidDisplay));
    }
    partial void OnProgressPercentTextChanged(string value) => OnPropertyChanged(nameof(ProgressFraction));
    partial void OnClientPaymentsChanged(ObservableCollection<ProjectClientPayment> value)
    {
        OnPropertyChanged(nameof(PaymentsSummaryDisplay));
        OnPropertyChanged(nameof(TotalPaidDisplay));
    }
    partial void OnSelectedStageChanged(PipelineStageOption? value) => SyncStageChips();

    partial void OnDetailTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsDetailsTab));
        OnPropertyChanged(nameof(IsDocsTab));
        OnPropertyChanged(nameof(IsQuotationTab));
        OnPropertyChanged(nameof(IsPipelineTab));
        OnPropertyChanged(nameof(IsPaymentsTab));
    }

    [RelayCommand]
    private void SetDetailTab(string tab)
    {
        if (string.IsNullOrWhiteSpace(tab)) return;
        DetailTab = tab;
    }

    private void NotifyFinancials()
    {
        OnPropertyChanged(nameof(BalanceDisplay));
        OnPropertyChanged(nameof(DepositOutstandingDisplay));
    }

    private double ParseOffer() => double.TryParse(OfferAmountText, out var v) ? v : 0;
    private double ParseDeposit() => double.TryParse(DepositRequiredText, out var v) ? v : 0;
    private double ParsePaid() => double.TryParse(AmountPaidText, out var v) ? v : 0;
    private static string FormatMoney(double amount) => $"R{amount:N2}";

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var allClients = await _storage.GetClientsAsync(companyId);
            Clients = new ObservableCollection<Client>(allClients.OrderBy(c => c.Name));
            var activeEmployees = (await _storage.GetEmployeesAsync(companyId)).Where(e => e.IsActive).OrderBy(e => e.FullName).ToList();
            Employees = new ObservableCollection<Employee>(activeEmployees);
            ManagerCandidates = new ObservableCollection<Employee>(
                activeEmployees.Where(e => e.IsManager));
            Contractors = new ObservableCollection<Contractor>(
                (await _storage.GetContractorsAsync(companyId)).Where(c => c.IsActive).OrderBy(c => c.Name));

            if (Guid.TryParse(ClientId, out var presetClientId))
            {
                SelectedClient = allClients.FirstOrDefault(c => c.Id == presetClientId);
                Client = SelectedClient;
            }

            // Shell applies DealId after first layout pass — skip until we know new vs existing.
            if (string.IsNullOrWhiteSpace(DealId))
                return;

            if (IsNew)
            {
                Title = "New Project";
                ProjectCode = await _storage.GenerateNextProjectCodeAsync(companyId);
                SelectedStage = ProjectPipeline.Stages[0];
                Activity = [];
                Documents = [];
                return;
            }

            if (!Guid.TryParse(DealId, out var dealId)) return;
            Deal = await _storage.GetClientDealAsync(dealId);
            if (Deal == null) return;

            BindFromDeal(Deal);
            Activity = new ObservableCollection<ClientDealUpdate>(
                await _storage.GetClientDealUpdatesAsync(dealId));
            Documents = new ObservableCollection<ProjectDocument>(
                await _storage.GetProjectDocumentsAsync(dealId));
            QuotationLines = new ObservableCollection<ProjectQuotationLine>(
                await _storage.GetProjectQuotationLinesAsync(dealId));
            QuotationNotes = Deal.QuotationNotes ?? "";
            UseQuotationValidUntil = Deal.QuotationValidUntil.HasValue;
            if (Deal.QuotationValidUntil.HasValue)
                QuotationValidUntilDate = Deal.QuotationValidUntil.Value.ToDateTime(TimeOnly.MinValue);
            SelectedManager = ManagerCandidates.FirstOrDefault(e => e.Id == Deal.ManagerEmployeeId)
                              ?? activeEmployees.FirstOrDefault(e => e.Id == Deal.ManagerEmployeeId);
            OnPropertyChanged(nameof(QuotationTotalDisplay));
            OnPropertyChanged(nameof(QuotationSentLabel));
            ProjectJobs = new ObservableCollection<Job>(await _storage.GetJobsByDealIdAsync(dealId));
            Deal.JobCount = ProjectJobs.Count;
            ClientPayments = new ObservableCollection<ProjectClientPayment>(
                await _storage.GetProjectClientPaymentsAsync(dealId));
            await LoadClientThreadMessagesAsync(dealId);
            OnPropertyChanged(nameof(HasClientMessages));
            await DedupeQuotationSummaryLinesAsync();
            await EnsureQuotationOfferLineAsync();
            await RefreshAutoProgressAsync();
            OnPropertyChanged(nameof(ProjectJobsLabel));
            OnPropertyChanged(nameof(PaymentsSummaryDisplay));
            OnPropertyChanged(nameof(TotalPaidDisplay));
            NotifyProjectModeChanged();
        });
    }

    private async Task RefreshAutoProgressAsync()
    {
        if (Deal == null) return;
        var jobs = ProjectJobs.ToList();
        var pct = ProjectProgressHelper.ComputePercent(Deal, jobs);
        ProgressPercentText = pct.ToString();
        ProgressIsAuto = true;
        var payPct = Deal.OfferAmount > 0
            ? (int)Math.Min(100, Math.Round(Deal.AmountPaid / Deal.OfferAmount * 100))
            : 0;
        var jobPct = jobs.Count == 0 ? 0
            : (int)Math.Round(jobs.Count(j => j.StatusRaw is "completed" or "Completed") * 100.0 / jobs.Count);
        AutoProgressHint = $"Auto: {payPct}% from payments, {jobPct}% from jobs completed (uses higher value).";
        OnPropertyChanged(nameof(ProgressFraction));
    }

    private void BindFromDeal(ClientDeal deal)
    {
        Title = deal.Title;
        ProjectTitle = deal.Title;
        ProjectCode = deal.ProjectCode ?? "";
        if (deal.HasClient && deal.ClientId.HasValue)
        {
            Client = Clients.FirstOrDefault(c => c.Id == deal.ClientId.Value);
            SelectedClient = Client;
        }
        else
        {
            Client = null;
            SelectedClient = null;
        }
        OnPropertyChanged(nameof(ClientDisplay));
        _statusBeforeEdit = deal.StatusRaw;
        SelectedStage = ProjectPipeline.Stages.FirstOrDefault(s => s.Value == deal.StatusRaw)
                         ?? ProjectPipeline.Stages[0];
        OfferAmountText = deal.OfferAmount.ToString("F2");
        DepositRequiredText = deal.DepositRequired.ToString("F2");
        AmountPaidText = deal.AmountPaid.ToString("F2");
        ProgressPercentText = deal.ProgressPercent.ToString();
        ProgressIsAuto = true;
        Notes = deal.Notes ?? "";
        AgreementNotes = deal.AgreementNotes ?? "";
        NewUpdateText = deal.LastUpdateNote ?? "";
        UseExpectedCloseDate = PortalDateHelper.IsSet(deal.ExpectedCloseDate);
        if (UseExpectedCloseDate)
            ExpectedCloseDate = deal.ExpectedCloseDate!.Value.ToDateTime(TimeOnly.MinValue);
        UseSiteStartDate = PortalDateHelper.IsSet(deal.SiteStartDate);
        if (UseSiteStartDate)
            SiteStartDate = deal.SiteStartDate!.Value.ToDateTime(TimeOnly.MinValue);
        UseExpectedCompletionDate = PortalDateHelper.IsSet(deal.ExpectedCompletionDate);
        if (UseExpectedCompletionDate)
            ExpectedCompletionDate = deal.ExpectedCompletionDate!.Value.ToDateTime(TimeOnly.MinValue);
        UseNextVisitDate = PortalDateHelper.IsSet(deal.NextVisitDate);
        if (UseNextVisitDate)
            NextVisitDate = deal.NextVisitDate!.Value.ToDateTime(TimeOnly.MinValue);
        QuotationNotes = deal.QuotationNotes ?? "";
        NotifyFinancials();
        OnPropertyChanged(nameof(HasLinkedJob));
    }

    [RelayCommand]
    private void SelectPipelineStage(PipelineStageChip chip)
    {
        SelectedStage = chip.Stage;
    }

    [RelayCommand]
    private async Task GenerateProjectCodeAsync()
    {
        await RunAsync(async () =>
        {
            ProjectCode = await _storage.GenerateNextProjectCodeAsync(_state.CurrentEmployee!.CompanyId);
            OnPropertyChanged(nameof(HasProjectCode));
        });
    }

    [RelayCommand]
    private async Task PostUpdateAsync()
    {
        if (Deal == null || string.IsNullOrWhiteSpace(NewUpdateText)) return;

        await RunAsync(async () =>
        {
            var body = NewUpdateText.Trim();
            var entry = await _storage.AddClientDealUpdateAsync(new ClientDealUpdate
            {
                CompanyId = Deal.CompanyId,
                DealId = Deal.Id,
                Body = body,
                StatusFrom = null,
                StatusTo = null
            });

            Deal.LastUpdateNote = body;
            Deal.LastUpdateAt = DateTime.UtcNow;
            Deal = await _storage.UpdateClientDealAsync(Deal);

            Activity.Insert(0, entry);
            await Shell.Current.DisplayAlertAsync("Posted", "Update added to project timeline.", "OK");
        });
    }

    [RelayCommand]
    private async Task UploadDocumentAsync()
    {
        if (Deal == null) return;

        FileResult? pick;
        try
        {
            pick = await ProjectDocumentTypes.PickAsync("Select project file (PDF, Word, Excel, images…)");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Upload failed", ex.Message, "OK");
            return;
        }

        if (pick == null) return;

        var typeLabels = ProjectDocumentTypes.TypeLabels;
        var typePick = await Shell.Current.DisplayActionSheetAsync("Document type", "Cancel", null, typeLabels);
        if (typePick == null || typePick == "Cancel") return;
        var typeKey = ProjectDocumentTypes.TypeKeys[
            Math.Max(0, Array.IndexOf(typeLabels, typePick))];

        var name = await Shell.Current.DisplayPromptAsync(
            "Document name", "Label for this file:", "Upload", "Cancel",
            initialValue: pick.FileName ?? "Document");
        if (string.IsNullOrWhiteSpace(name)) return;

        var companyId = Deal.CompanyId;
        var dealId = Deal.Id;
        if (companyId == Guid.Empty)
        {
            await Shell.Current.DisplayAlertAsync("Upload failed", "Project company is missing. Save the project and try again.", "OK");
            return;
        }

        if (IsBusy)
        {
            await Shell.Current.DisplayAlertAsync("Please wait", "The project is still loading. Try again in a moment.", "OK");
            return;
        }

        IsBusy = true;
        try
        {
            var doc = await _storage.UploadProjectDocumentAsync(
                companyId, dealId, pick, typeKey, name.Trim());
            Documents.Insert(0, doc);
            await Shell.Current.DisplayAlertAsync("Uploaded", "Document attached to project.", "OK");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Upload failed", ex.Message, "OK");
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task OpenDocumentAsync(ProjectDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
    }

    [RelayCommand]
    private async Task DeleteDocumentAsync(ProjectDocument doc)
    {
        if (!await Shell.Current.DisplayAlertAsync("Remove", $"Remove '{doc.DocumentName}'?", "Remove", "Cancel"))
            return;

        await RunAsync(async () =>
        {
            await _storage.DeleteProjectDocumentAsync(doc);
            Documents.Remove(doc);
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        var name = ProjectTitle.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            await Shell.Current.DisplayAlertAsync("Required", "Project name is required.", "OK");
            return;
        }

        var client = SelectedClient ?? Client;
        var stage = SelectedStage ?? ProjectPipeline.Stages[0];
        var offer = ParseOffer();
        var deposit = ParseDeposit();
        if (IsBusy) return;
        IsBusy = true;
        try
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            DateOnly? closeDate = UseExpectedCloseDate
                ? NormalizeSaveDate(ExpectedCloseDate)
                : null;

            if (IsNew)
            {
                var created = await _storage.CreateClientDealAsync(new ClientDeal
                {
                    CompanyId = companyId,
                    ClientId = client?.Id,
                    Title = name,
                    ProjectCode = string.IsNullOrWhiteSpace(ProjectCode)
                        ? await _storage.GenerateNextProjectCodeAsync(companyId)
                        : ProjectCode.Trim().ToUpperInvariant(),
                    StatusRaw = stage.Value,
                    OfferAmount = offer,
                    DepositRequired = deposit,
                    AmountPaid = ClientPayments.Sum(p => p.Amount),
                    ProgressPercent = 0,
                    ExpectedCloseDate = closeDate,
                    SiteStartDate = UseSiteStartDate ? NormalizeSaveDate(SiteStartDate) : null,
                    ExpectedCompletionDate = UseExpectedCompletionDate ? NormalizeSaveDate(ExpectedCompletionDate) : null,
                    NextVisitDate = UseNextVisitDate ? NormalizeSaveDate(NextVisitDate) : null,
                    Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim(),
                    AgreementNotes = string.IsNullOrWhiteSpace(AgreementNotes) ? null : AgreementNotes.Trim(),
                    LastUpdateNote = string.IsNullOrWhiteSpace(NewUpdateText) ? null : NewUpdateText.Trim(),
                    LastUpdateAt = string.IsNullOrWhiteSpace(NewUpdateText) ? null : DateTime.UtcNow,
                    ManagerEmployeeId = SelectedManager?.Id,
                    QuotationNotes = string.IsNullOrWhiteSpace(QuotationNotes) ? null : QuotationNotes.Trim(),
                    QuotationValidUntil = UseQuotationValidUntil
                        ? DateOnly.FromDateTime(QuotationValidUntilDate.Date)
                        : null
                });
                Deal = await _storage.SyncClientDealFinancialsAsync(created.Id);
                DealId = Deal.Id.ToString();
                _statusBeforeEdit = stage.Value;
                AmountPaidText = Deal.AmountPaid.ToString("F2");
                await RefreshAutoProgressAsync();

                if (!string.IsNullOrWhiteSpace(NewUpdateText))
                {
                    await _storage.AddClientDealUpdateAsync(new ClientDealUpdate
                    {
                        CompanyId = companyId,
                        DealId = created.Id,
                        Body = NewUpdateText.Trim()
                    });
                }
            }
            else if (Deal != null)
            {
                var statusChanged = _statusBeforeEdit != stage.Value;
                Deal.Title = name;
                Deal.ClientId = client?.Id;
                Deal.ProjectCode = string.IsNullOrWhiteSpace(ProjectCode) ? Deal.ProjectCode : ProjectCode.Trim().ToUpperInvariant();
                Deal.StatusRaw = stage.Value;
                Deal.OfferAmount = offer;
                Deal.DepositRequired = deposit;
                Deal.ExpectedCloseDate = closeDate;
                Deal.SiteStartDate = UseSiteStartDate ? NormalizeSaveDate(SiteStartDate) : null;
                Deal.ExpectedCompletionDate = UseExpectedCompletionDate ? NormalizeSaveDate(ExpectedCompletionDate) : null;
                Deal.NextVisitDate = UseNextVisitDate ? NormalizeSaveDate(NextVisitDate) : null;
                Deal.Notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes.Trim();
                Deal.AgreementNotes = string.IsNullOrWhiteSpace(AgreementNotes) ? null : AgreementNotes.Trim();
                Deal.ManagerEmployeeId = SelectedManager?.Id;
                Deal.QuotationNotes = string.IsNullOrWhiteSpace(QuotationNotes) ? null : QuotationNotes.Trim();
                Deal.QuotationValidUntil = UseQuotationValidUntil
                    ? DateOnly.FromDateTime(QuotationValidUntilDate.Date)
                    : null;
                Deal = await _storage.UpdateClientDealAsync(Deal);
                Deal = await _storage.SyncClientDealFinancialsAsync(Deal.Id);
                AmountPaidText = Deal.AmountPaid.ToString("F2");
                await RefreshAutoProgressAsync();

                if (statusChanged)
                {
                    var entry = await _storage.AddClientDealUpdateAsync(new ClientDealUpdate
                    {
                        CompanyId = Deal.CompanyId,
                        DealId = Deal.Id,
                        Body = $"Stage changed to {stage.Label}.",
                        StatusFrom = _statusBeforeEdit,
                        StatusTo = stage.Value
                    });
                    Activity.Insert(0, entry);
                    _statusBeforeEdit = stage.Value;
                }
            }

            await Shell.Current.DisplayAlertAsync("Saved", "Project saved.", "OK");
            NotifyProjectModeChanged();

            if (!IsNew && Deal != null)
            {
                Activity = new ObservableCollection<ClientDealUpdate>(
                    await _storage.GetClientDealUpdatesAsync(Deal.Id));
                Documents = new ObservableCollection<ProjectDocument>(
                    await _storage.GetProjectDocumentsAsync(Deal.Id));
                ProjectJobs = new ObservableCollection<Job>(await _storage.GetJobsByDealIdAsync(Deal.Id));
                ClientPayments = new ObservableCollection<ProjectClientPayment>(
                    await _storage.GetProjectClientPaymentsAsync(Deal.Id));
                await LoadClientThreadMessagesAsync(Deal.Id);
            }
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Could not save", ex.Message, "OK");
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task ReplyToClientAsync()
    {
        if (Deal == null || string.IsNullOrWhiteSpace(ClientReplyText)) return;

        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        await RunAsync(async () =>
        {
            var thread = await _storage.GetOrCreateClientDealThreadAsync(Deal.CompanyId, Deal.Id);
            var sent = await _storage.SendMessageAsync(new AppMessage
            {
                ThreadId = thread.Id,
                SenderId = employee.Id,
                Body = ClientReplyText.Trim(),
                CompanyId = Deal.CompanyId,
                SenderDisplayName = employee.FullName
            });
            var reply = ClientDealMessage.FromAppMessage(sent);
            reply.DealId = Deal.Id;
            reply.Author = "hr";
            ClientMessages.Add(reply);
            ClientReplyText = "";
            OnPropertyChanged(nameof(HasClientMessages));
            await Shell.Current.DisplayAlertAsync("Sent", "Reply sent — the client will see it in their portal.", "OK");
        });
    }

    [RelayCommand]
    private async Task OpenClientThreadInMessagesAsync()
    {
        if (Deal == null) return;
        await RunAsync(async () =>
        {
            var thread = await _storage.GetOrCreateClientDealThreadAsync(Deal.CompanyId, Deal.Id);
            var threads = await _storage.GetMessageThreadsAsync(Deal.CompanyId, _state.CurrentEmployee!.Id);
            var title = threads.FirstOrDefault(t => t.Id == thread.Id)?.ListTitle
                ?? MessageThreadDisplay.DealThreadTitle(_client?.Name ?? "Client", Deal.Title);
            await ShellNavigation.GoToAsync(
                $"{nameof(HrSimpleThreadChatPage)}?ThreadId={thread.Id}&ThreadSubject={Uri.EscapeDataString(title)}");
        });
    }

    private async Task LoadClientThreadMessagesAsync(Guid dealId)
    {
        if (Deal == null) return;
        var subject = $"Deal:{dealId}";
        var threads = await _storage.GetMessageThreadsAsync(Deal.CompanyId, _state.CurrentEmployee!.Id);
        var thread = threads.FirstOrDefault(t => t.Subject == subject);
        if (thread == null)
        {
            ClientMessages = [];
            OnPropertyChanged(nameof(HasClientMessages));
            return;
        }

        var raw = await _storage.GetMessagesAsync(thread.Id);
        ClientMessages = new ObservableCollection<ClientDealMessage>(raw.Select(m =>
        {
            var dm = ClientDealMessage.FromAppMessage(m);
            dm.DealId = dealId;
            return dm;
        }));
        OnPropertyChanged(nameof(HasClientMessages));
    }

    [RelayCommand]
    private async Task AttachPaymentReceiptAsync(ProjectClientPayment payment)
    {
        if (Deal == null || payment == null) return;

        FileResult? pick;
        try
        {
            pick = await ProjectDocumentTypes.PickAsync("Select payment receipt (PDF or image)");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Receipt", ex.Message, "OK");
            return;
        }

        if (pick == null) return;

        await RunAsync(async () =>
        {
            var updated = await _storage.AttachPaymentReceiptAsync(Deal.CompanyId, payment, pick);
            var idx = ClientPayments.IndexOf(payment);
            if (idx >= 0)
                ClientPayments[idx] = updated;
            await Shell.Current.DisplayAlertAsync("Receipt", "Receipt attached. Client can open it from the portal.", "OK");
        });
    }

    [RelayCommand]
    private async Task OpenPaymentReceiptAsync(ProjectClientPayment payment)
    {
        if (string.IsNullOrWhiteSpace(payment?.ReceiptUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(payment.ReceiptUrl));
    }

    [RelayCommand]
    private async Task AddClientPaymentAsync()
    {
        if (Deal == null) return;

        var amountStr = await Shell.Current.DisplayPromptAsync(
            "Client payment", "Amount received (R):", "Next", "Cancel", keyboard: Keyboard.Numeric);
        if (string.IsNullOrWhiteSpace(amountStr) || !double.TryParse(amountStr, out var amount) || amount <= 0)
            return;

        var method = await Shell.Current.DisplayPromptAsync(
            "Payment method", "EFT, cash, card… (optional):", "Next", "Skip");
        var reference = await Shell.Current.DisplayPromptAsync(
            "Reference", "Invoice / POP ref (optional):", "Add", "Skip");

        await RunAsync(async () =>
        {
            var payment = await _storage.AddProjectClientPaymentAsync(new ProjectClientPayment
            {
                CompanyId = Deal.CompanyId,
                DealId = Deal.Id,
                Amount = amount,
                PaidAt = DateTime.UtcNow,
                PaymentMethod = string.IsNullOrWhiteSpace(method) || method == "Skip" ? null : method.Trim(),
                Reference = string.IsNullOrWhiteSpace(reference) || reference == "Skip" ? null : reference.Trim()
            });
            ClientPayments.Insert(0, payment);
            Deal = await _storage.SyncClientDealFinancialsAsync(Deal.Id);
            AmountPaidText = Deal.AmountPaid.ToString("F2");
            await RefreshAutoProgressAsync();
            NotifyFinancials();

            if (await Shell.Current.DisplayAlertAsync(
                    "Receipt", "Attach a receipt or POP for the client portal?", "Attach", "Skip"))
            {
                FileResult? pick;
                try { pick = await ProjectDocumentTypes.PickAsync("Payment receipt"); }
                catch { pick = null; }
                if (pick != null)
                {
                    var updated = await _storage.AttachPaymentReceiptAsync(Deal.CompanyId, payment, pick);
                    ClientPayments[0] = updated;
                }
            }
        });
    }

    [RelayCommand]
    private async Task DeleteAsync()
    {
        if (Deal == null) return;
        if (!await Shell.Current.DisplayAlertAsync("Delete Project", $"Delete '{Deal.Title}'?", "Delete", "Cancel"))
            return;

        await RunAsync(async () =>
        {
            await _storage.DeleteClientDealAsync(Deal!.Id);
            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task OpenLinkedJobAsync()
    {
        if (Deal?.JobId == null) return;
        await OpenProjectJobAsync(ProjectJobs.FirstOrDefault(j => j.Id == Deal.JobId) ?? ProjectJobs.FirstOrDefault());
    }

    [RelayCommand]
    private async Task OpenProjectJobAsync(Job? job)
    {
        if (job == null) return;
        await ShellNavigation.GoToAsync($"{nameof(HrJobDetailsPage)}?JobId={job.Id}");
    }

    [RelayCommand]
    private async Task CreateJobFromProjectAsync()
    {
        if (Deal == null)
        {
            await Shell.Current.DisplayAlertAsync("Save first", "Save the project before creating a job.", "OK");
            return;
        }

        var client = Client ?? SelectedClient;
        var args = new Dictionary<string, object> { ["DealId"] = Deal.Id.ToString() };
        if (client != null)
            args["ClientId"] = client.Id.ToString();
        await ShellNavigation.GoToAsync(nameof(HrCreateJobPage), args);
    }

    [RelayCommand]
    private async Task AddQuotationLineAsync()
    {
        if (Deal == null) return;
        var desc = await Shell.Current.DisplayPromptAsync("Quotation line", "Description:", "Next", "Cancel");
        if (string.IsNullOrWhiteSpace(desc)) return;
        var qtyStr = await Shell.Current.DisplayPromptAsync("Quantity", "Qty:", "Next", "Cancel", "1", keyboard: Keyboard.Numeric);
        if (!double.TryParse(qtyStr, out var qty) || qty <= 0) qty = 1;
        var priceStr = await Shell.Current.DisplayPromptAsync("Unit price", "R:", "Add", "Cancel", "0", keyboard: Keyboard.Numeric);
        if (!double.TryParse(priceStr, out var price)) price = 0;

        await RunAsync(async () =>
        {
            var line = await _storage.AddProjectQuotationLineAsync(new ProjectQuotationLine
            {
                Id = Guid.NewGuid(),
                CompanyId = Deal.CompanyId,
                DealId = Deal.Id,
                LineNo = QuotationLines.Count + 1,
                Description = desc.Trim(),
                Quantity = qty,
                UnitPrice = price
            });
            QuotationLines.Add(line);
            OnPropertyChanged(nameof(QuotationTotalDisplay));
        });
    }

    [RelayCommand]
    private async Task RemoveQuotationLineAsync(ProjectQuotationLine line)
    {
        if (Deal == null) return;
        if (!await Shell.Current.DisplayAlertAsync("Remove line", $"Remove '{line.Description}'?", "Remove", "Cancel"))
            return;

        await RunAsync(async () =>
        {
            await _storage.DeleteProjectQuotationLineAsync(line.Id);
            QuotationLines.Remove(line);
            OnPropertyChanged(nameof(QuotationTotalDisplay));
        });
    }

    private async Task DedupeQuotationSummaryLinesAsync()
    {
        if (Deal == null) return;
        var summaries = QuotationLines
            .Where(l => ProjectQuotationDisplay.IsSummaryLine(l.Description))
            .ToList();
        if (summaries.Count <= 1) return;

        var offer = Deal.OfferAmount > 0 ? Deal.OfferAmount : ParseOffer();
        var keep = summaries.OrderBy(l => Math.Abs(l.LineTotal - offer)).First();
        foreach (var dup in summaries.Where(s => s.Id != keep.Id))
        {
            await _storage.DeleteProjectQuotationLineAsync(dup.Id);
            QuotationLines.Remove(dup);
        }
        OnPropertyChanged(nameof(QuotationTotalDisplay));
    }

    private async Task EnsureQuotationOfferLineAsync()
    {
        if (Deal == null || IsNew) return;
        var offer = Deal.OfferAmount > 0 ? Deal.OfferAmount : ParseOffer();
        if (offer <= 0) return;

        const string lineDesc = ProjectQuotationDisplay.SummaryLineDescription;
        var existing = QuotationLines.FirstOrDefault(l =>
            l.Description.Equals(lineDesc, StringComparison.OrdinalIgnoreCase));

        if (existing != null)
        {
            if (Math.Abs(existing.UnitPrice - offer) > 0.009 || Math.Abs(existing.Quantity - 1) > 0.009)
            {
                await _storage.DeleteProjectQuotationLineAsync(existing.Id);
                QuotationLines.Remove(existing);
                existing = null;
            }
        }

        if (existing == null && !QuotationLines.Any(l => l.Description.Equals(lineDesc, StringComparison.OrdinalIgnoreCase)))
        {
            var line = await _storage.AddProjectQuotationLineAsync(new ProjectQuotationLine
            {
                Id = Guid.NewGuid(),
                CompanyId = Deal.CompanyId,
                DealId = Deal.Id,
                LineNo = QuotationLines.Count + 1,
                Description = lineDesc,
                Quantity = 1,
                UnitPrice = offer
            });
            QuotationLines.Insert(0, line);
            OnPropertyChanged(nameof(QuotationTotalDisplay));
        }
    }

    [RelayCommand]
    private async Task DownloadQuotationAsync()
    {
        if (Deal == null) return;
        var downloadToDevice = await _export.AskExportDeliveryAsync("Download quotation PDF");
        if (downloadToDevice == null) return;

        var client = Client ?? SelectedClient;
        var company = await _storage.GetCurrentCompanyAsync(Deal.CompanyId);
        try
        {
            await _export.ExportQuotationPdfAsync(client, Deal, QuotationLines, company?.Name, downloadToDevice.Value);
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Download failed", ex.Message, "OK");
        }
    }

    [RelayCommand]
    private async Task EmailQuotationAsync()
    {
        if (Deal == null) return;
        var client = Client ?? SelectedClient;
        if (client == null || string.IsNullOrWhiteSpace(client.Email))
        {
            await Shell.Current.DisplayAlertAsync("Email", "Add an email address on the client record first.", "OK");
            return;
        }

        var company = await _storage.GetCurrentCompanyAsync(Deal.CompanyId);
        var body = ProjectQuotationBuilder.Build(client, Deal, QuotationLines, company?.Name);
        if (Email.Default.IsComposeSupported)
        {
            await Email.Default.ComposeAsync(new EmailMessage
            {
                Subject = $"Quotation — {Deal.Title}",
                Body = body,
                To = [client.Email]
            });
        }
        else
        {
            await Clipboard.Default.SetTextAsync(body);
            await Shell.Current.DisplayAlertAsync("Email", "Quotation copied to clipboard (email not available on this device).", "OK");
        }
    }

    [RelayCommand]
    private async Task MarkQuotationSentAsync()
    {
        if (Deal == null) return;
        await RunAsync(async () =>
        {
            Deal.QuotationSentAt = DateTime.UtcNow;
            if (Deal.StatusRaw is "draft")
            {
                Deal.StatusRaw = "sent";
                SelectedStage = ProjectPipeline.Stages.FirstOrDefault(s => s.Value == "sent")
                                ?? SelectedStage;
            }
            Deal = await _storage.UpdateClientDealAsync(Deal);
            OnPropertyChanged(nameof(QuotationSentLabel));
            await Shell.Current.DisplayAlertAsync("Quotation", "Marked as sent. Client can view it in their portal.", "OK");
        });
    }

    [RelayCommand]
    private async Task AddContractorAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync("New contractor", "Company / contractor name:", "Create", "Cancel", "");
        if (string.IsNullOrWhiteSpace(name)) return;

        await RunAsync(async () =>
        {
            var created = await _storage.CreateContractorAsync(new Contractor
            {
                CompanyId = _state.CurrentEmployee!.CompanyId,
                Name = name.Trim(),
                CreatedAt = DateTime.UtcNow
            });
            Contractors.Add(created);
            SelectedContractor = created;
        });
    }

    private static DateOnly? NormalizeSaveDate(DateTime date)
    {
        var d = DateOnly.FromDateTime(date.Date);
        return d.Year >= PortalDateHelper.MinValidYear ? d : null;
    }
}
