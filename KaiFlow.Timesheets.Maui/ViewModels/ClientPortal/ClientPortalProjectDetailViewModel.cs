using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.ClientPortal;

[QueryProperty(nameof(DealId), "DealId")]
public partial class ClientPortalProjectDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _dealId = "";
    [ObservableProperty] private ClientDeal? _project;
    [ObservableProperty] private string _agreementText = "No agreement notes shared yet.";
    [ObservableProperty] private string _updateText = "No project updates yet.";
    [ObservableProperty] private string _workOrderLabel = "—";
    [ObservableProperty] private string? _quotationIntro;
    [ObservableProperty] private ObservableCollection<ProjectQuotationLine> _quotationLineItems = [];
    [ObservableProperty] private string _quotationTotalDisplay = "R0.00";
    [ObservableProperty] private ObservableCollection<ProjectDocument> _documents = [];
    [ObservableProperty] private ObservableCollection<ClientDealUpdate> _activity = [];
    [ObservableProperty] private ObservableCollection<ClientPortalPhotoItem> _progressPhotos = [];
    [ObservableProperty] private ObservableCollection<ProjectClientPayment> _payments = [];
    [ObservableProperty] private ObservableCollection<ClientDealMessage> _messages = [];
    [ObservableProperty] private string _newMessageText = "";

    public double ProgressFraction => (Project?.ProgressPercent ?? 0) / 100.0;
    public bool HasDocuments => Documents.Count > 0;
    public bool HasActivity => Activity.Count > 0;
    public bool HasProgressPhotos => ProgressPhotos.Count > 0;
    public bool HasQuotationLines => QuotationLineItems.Count > 0;
    public bool HasPayments => Payments.Count > 0;
    public bool HasMessages => Messages.Count > 0;
    public bool HasMilestones => Project?.HasMilestones == true;

    public ClientPortalProjectDetailViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Project";
    }

    public async Task LoadAsync()
    {
        if (ClientPortalSessionStore.IsSigningOut)
            return;

        var session = ClientPortalSessionStore.Get();
        if (session == null)
        {
            await ClientPortalNavigation.ExitToLoginAsync(_state);
            return;
        }

        if (!Guid.TryParse(DealId, out var dealId) || dealId == Guid.Empty)
        {
            await Shell.Current.DisplayAlertAsync("Project", "Invalid project link.", "OK");
            await ShellNavigation.GoToAsync("..");
            return;
        }

        await RunAsync(async () =>
        {
            var deal = await _storage.GetClientPortalProjectAsync(
                session.Value.CompanyCode,
                session.Value.ClientCode,
                dealId);

            if (deal == null)
            {
                await Shell.Current.DisplayAlertAsync("Project", "This project is not available or may be private.", "OK");
                await ShellNavigation.GoToAsync("..");
                return;
            }

            Project = deal;
            Title = deal.Title;
            AgreementText = BuildAgreementText(deal);
            UpdateText = string.IsNullOrWhiteSpace(deal.LastUpdateNote)
                ? "No project updates yet."
                : deal.LastUpdateNote!;
            WorkOrderLabel = deal.HasLinkedJob ? "Work order linked" : "Not started on site yet";
            QuotationIntro = string.IsNullOrWhiteSpace(deal.QuotationNotes) ? null : deal.QuotationNotes;
            QuotationLineItems = new ObservableCollection<ProjectQuotationLine>(deal.ClientQuotationLineItems);
            QuotationTotalDisplay = deal.ClientQuotationTotalDisplay;
            Documents = new ObservableCollection<ProjectDocument>(deal.PortalDocuments);
            Activity = new ObservableCollection<ClientDealUpdate>(deal.PortalActivity);
            ProgressPhotos = new ObservableCollection<ClientPortalPhotoItem>(deal.PortalPhotos);
            Payments = new ObservableCollection<ProjectClientPayment>(deal.PortalPayments);
            Messages = new ObservableCollection<ClientDealMessage>(deal.PortalMessages);
            var lastHr = deal.PortalMessages
                .Where(m => m.IsFromHr)
                .OrderByDescending(m => m.CreatedAt)
                .FirstOrDefault();
            if (lastHr != null)
                ClientPortalSessionStore.MarkDealMessagesRead(dealId, lastHr.CreatedAt);
            NotifySectionFlags();
        });
    }

    private void NotifySectionFlags()
    {
        OnPropertyChanged(nameof(ProgressFraction));
        OnPropertyChanged(nameof(HasDocuments));
        OnPropertyChanged(nameof(HasActivity));
        OnPropertyChanged(nameof(HasProgressPhotos));
        OnPropertyChanged(nameof(HasQuotationLines));
        OnPropertyChanged(nameof(HasPayments));
        OnPropertyChanged(nameof(HasMessages));
        OnPropertyChanged(nameof(HasMilestones));
    }

    private static string BuildAgreementText(ClientDeal deal)
    {
        if (!string.IsNullOrWhiteSpace(deal.AgreementNotes))
            return deal.AgreementNotes!;

        if (!string.IsNullOrWhiteSpace(deal.QuotationNotes))
            return deal.QuotationNotes!;

        return "No agreement or contract notes have been shared yet. Your project manager can add these from the HR project screen.";
    }

    [RelayCommand]
    private async Task OpenDocumentAsync(ProjectDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc?.FileUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
    }

    [RelayCommand]
    private async Task OpenPhotoAsync(ClientPortalPhotoItem photo)
    {
        if (string.IsNullOrWhiteSpace(photo?.Url)) return;
        await Launcher.Default.OpenAsync(new Uri(photo.Url));
    }

    [RelayCommand]
    private async Task OpenPaymentReceiptAsync(ProjectClientPayment payment)
    {
        if (string.IsNullOrWhiteSpace(payment?.ReceiptUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(payment.ReceiptUrl));
    }

    [RelayCommand]
    private async Task UploadDocumentAsync()
    {
        var session = ClientPortalSessionStore.Get();
        if (session == null || Project == null) return;

        FileResult? pick;
        try
        {
            pick = await ProjectDocumentTypes.PickAsync("Upload a file for your contractor");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Upload", ex.Message, "OK");
            return;
        }

        if (pick == null) return;

        var name = await Shell.Current.DisplayPromptAsync(
            "Document name", "Label for this file:", "Upload", "Cancel",
            initialValue: pick.FileName ?? "My document");
        if (string.IsNullOrWhiteSpace(name)) return;

        try
        {
            IsBusy = true;
            var doc = await _storage.ClientPortalUploadDocumentAsync(
                session.Value.CompanyCode,
                session.Value.ClientCode,
                Project.Id,
                Project.CompanyId,
                pick,
                name.Trim());
            Documents.Insert(0, doc);
            OnPropertyChanged(nameof(HasDocuments));
            await Shell.Current.DisplayAlertAsync("Uploaded", "Your file was shared with the team.", "OK");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Upload", ex.Message, "OK");
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task ShareDocumentLinkAsync()
    {
        var session = ClientPortalSessionStore.Get();
        if (session == null || Project == null) return;

        var name = await Shell.Current.DisplayPromptAsync(
            "Share a document", "Document name:", "Next", "Cancel", initialValue: "Client document");
        if (string.IsNullOrWhiteSpace(name)) return;

        var url = await Shell.Current.DisplayPromptAsync(
            "Document link", "Paste a link to the file (Google Drive, Dropbox, etc.):", "Save", "Cancel");
        if (string.IsNullOrWhiteSpace(url)) return;

        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            await Shell.Current.DisplayAlertAsync("Document", "Please enter a valid http or https link.", "OK");
            return;
        }

        try
        {
            await _storage.ClientPortalAddDocumentLinkAsync(
                session.Value.CompanyCode,
                session.Value.ClientCode,
                Project.Id,
                name.Trim(),
                url.Trim());

            Documents.Insert(0, new ProjectDocument
            {
                DealId = Project.Id,
                CompanyId = Project.CompanyId,
                DocumentName = name.Trim(),
                DocumentType = "client_upload",
                FileUrl = url.Trim(),
                CreatedAt = DateTime.UtcNow
            });
            OnPropertyChanged(nameof(HasDocuments));
            await Shell.Current.DisplayAlertAsync("Saved", "Your document link was shared with the team.", "OK");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Document", ex.Message, "OK");
        }
    }

    [RelayCommand]
    private async Task SendMessageAsync()
    {
        var session = ClientPortalSessionStore.Get();
        if (session == null || Project == null || string.IsNullOrWhiteSpace(NewMessageText)) return;

        var body = NewMessageText.Trim();
        try
        {
            var sent = await _storage.ClientPortalSendMessageAsync(
                session.Value.CompanyCode,
                session.Value.ClientCode,
                Project.Id,
                body);

            var posted = ClientDealMessage.FromAppMessage(sent);
            posted.DealId = Project.Id;
            Messages.Add(posted);
            NewMessageText = "";
            OnPropertyChanged(nameof(HasMessages));
            await Shell.Current.DisplayAlertAsync("Sent", "Your message was sent. The team will see it in the app.", "OK");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Message", ex.Message, "OK");
        }
    }

    [RelayCommand]
    private async Task GoBackAsync()
    {
        if (Shell.Current.Navigation.NavigationStack.Count > 1)
            await ShellNavigation.GoToAsync("..");
        else
            await ShellNavigation.GoToAsync(ClientPortalNavigation.PortalRoute);
    }

    [RelayCommand]
    private async Task ExitToMainMenuAsync() => await ClientPortalNavigation.ExitToLoginAsync(_state);
}
