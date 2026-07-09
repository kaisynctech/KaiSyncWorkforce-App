using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.ContractorPortal;

public record ContractorChatLine(string Sender, string Body, DateTime At, bool IsContractor);

[QueryProperty(nameof(JobId), "JobId")]
public partial class ContractorPortalJobDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly ILocationService _location;

    [ObservableProperty] private string _jobId = "";
    [ObservableProperty] private Job? _job;
    [ObservableProperty] private bool _isOnThisJob;
    [ObservableProperty] private string _siteStatus = "Not on site";
    [ObservableProperty] private string _hoursOnJob = "";
    [ObservableProperty] private ObservableCollection<JobSiteSession> _visitHistory = [];
    [ObservableProperty] private ObservableCollection<string> _photosBefore = [];
    [ObservableProperty] private ObservableCollection<string> _photosAfter = [];
    [ObservableProperty] private ObservableCollection<ContractorChatLine> _messages = [];
    [ObservableProperty] private string _newMessage = "";
    [ObservableProperty] private string _incidentText = "";

    // ── Phase E: invoice submission ───────────────────────────────────────────
    [ObservableProperty] private decimal _invoiceAmount;
    [ObservableProperty] private string  _invoiceReference = "";
    [ObservableProperty] private string  _invoiceNotes     = "";
    [ObservableProperty] private bool    _isInvoiceBusy;

    private string _companyCode = "";
    private string _contractorCode = "";

    public ContractorPortalJobDetailViewModel(IStorageService storage, ILocationService location)
    {
        _storage = storage;
        _location = location;
        Title = "Job";
    }

    public async Task LoadAsync()
    {
        var session = ContractorPortalSessionStore.Get();
        if (session == null || !Guid.TryParse(JobId, out var jobGuid))
        {
            await ShellNavigation.GoToAsync("//IdEntry");
            return;
        }

        _companyCode = session.Value.CompanyCode;
        _contractorCode = session.Value.ContractorCode;

        await RunAsync(async () =>
        {
            var jobs = await _storage.GetContractorPortalJobsAsync(_companyCode, _contractorCode);
            Job = jobs.FirstOrDefault(j => j.Id == jobGuid);
            if (Job != null) Title = Job.Title;

            PhotosBefore = new ObservableCollection<string>(Job?.PhotoUrlsBefore ?? []);
            PhotosAfter = new ObservableCollection<string>(Job?.PhotoUrlsAfter ?? []);

            var open = await _storage.ContractorPortalOpenVisitAsync(_companyCode, _contractorCode);
            IsOnThisJob = open?.JobId == jobGuid;
            SiteStatus = IsOnThisJob
                ? $"On site since {open!.SignInAt.ToLocalTime():h:mm tt}"
                : open != null ? "Signed in on another job" : "Not on site";

            var visits = await _storage.ContractorPortalVisitHistoryAsync(_companyCode, _contractorCode, jobGuid);
            VisitHistory = new ObservableCollection<JobSiteSession>(JobSiteSession.Build(visits));
            var hrs = VisitHistory.Sum(v => v.TotalHours);
            HoursOnJob = hrs > 0 ? $"{hrs:F1} hours on this job" : "No completed visits yet";

            var raw = await _storage.ContractorPortalGetJobMessagesAsync(_companyCode, _contractorCode, jobGuid);
            Messages = new ObservableCollection<ContractorChatLine>(raw.Select(m => new ContractorChatLine(
                m.SenderDisplayName ?? "Manager",
                m.Body,
                m.CreatedAt,
                m.SenderContractorId.HasValue)));
        });
    }

    [RelayCommand]
    private async Task SignInOnSiteAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var name = await Shell.Current.DisplayPromptAsync("On site", "Who is on site? (optional)", "Sign in", "Cancel");
        if (name == null) return;

        await RunAsync(async () =>
        {
            var (lat, lng, addr) = await CaptureLocationAsync();
            await _storage.ContractorPortalSignInAsync(
                _companyCode, _contractorCode, jobGuid, lat, lng, addr,
                string.IsNullOrWhiteSpace(name) ? null : name.Trim());
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task SignOutOnSiteAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;

        await RunAsync(async () =>
        {
            var (lat, lng, addr) = await CaptureLocationAsync();
            await _storage.ContractorPortalSignOutAsync(_companyCode, _contractorCode, jobGuid, lat, lng, addr);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task AddPhotoAsync(string phase)
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var session = ContractorPortalSessionStore.Get();
        if (session == null) return;

        var file = await MediaPicker.PickPhotoAsync();
        if (file == null) return;

        await RunAsync(async () =>
        {
            var url = await _storage.UploadContractorPortalJobPhotoAsync(session.Value.CompanyId, jobGuid, file, phase);
            await _storage.ContractorPortalAppendJobPhotoAsync(_companyCode, _contractorCode, jobGuid, phase, url);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task ReportIncidentAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var desc = string.IsNullOrWhiteSpace(IncidentText)
            ? await Shell.Current.DisplayPromptAsync("Incident", "Describe the incident:", "Report", "Cancel")
            : IncidentText;
        if (string.IsNullOrWhiteSpace(desc)) return;

        await RunAsync(async () =>
        {
            var name = await Shell.Current.DisplayPromptAsync("Reporter", "Your name (optional):", "OK", "Skip");
            await _storage.ContractorPortalCreateIncidentAsync(
                _companyCode, _contractorCode, jobGuid, desc.Trim(), "medium",
                name == null || name == "Skip" ? null : name.Trim());
            IncidentText = "";
            await Shell.Current.DisplayAlert("Reported", "Incident sent to the manager.", "OK");
        });
    }

    [RelayCommand]
    private async Task SendMessageAsync()
    {
        var body = NewMessage.Trim();
        if (string.IsNullOrEmpty(body) || !Guid.TryParse(JobId, out var jobGuid)) return;

        await RunAsync(async () =>
        {
            var name = ContractorPortalSessionStore.Get()?.ContractorName;
            await _storage.ContractorPortalSendJobMessageAsync(_companyCode, _contractorCode, jobGuid, body, name);
            NewMessage = "";
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task SubmitInvoiceAsync()
    {
        if (InvoiceAmount <= 0)
        {
            await Shell.Current.DisplayAlert("Amount required", "Enter the invoice amount before submitting.", "OK");
            return;
        }

        if (!Guid.TryParse(JobId, out var jobGuid)) return;

        var confirm = await Shell.Current.DisplayAlert(
            "Submit invoice",
            $"Submit an invoice for R{InvoiceAmount:N2} on this job?",
            "Submit", "Cancel");
        if (!confirm) return;

        IsInvoiceBusy = true;
        try
        {
            await _storage.ContractorPortalSubmitInvoiceAsync(
                _companyCode, _contractorCode,
                jobGuid,
                InvoiceAmount,
                InvoiceReference,
                InvoiceNotes);

            InvoiceAmount    = 0;
            InvoiceReference = "";
            InvoiceNotes     = "";

            await Shell.Current.DisplayAlert(
                "Invoice submitted",
                "Your invoice has been sent to the manager for review.",
                "OK");
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsInvoiceBusy = false;
        }
    }

    private async Task<(double? Lat, double? Lng, string? Address)> CaptureLocationAsync()
    {
        try
        {
            var pos = await _location.GetCurrentPositionAsync(highAccuracy: true);
            if (pos == null) return (null, null, null);
            var address = await _location.ReverseGeocodeAsync(pos.Latitude, pos.Longitude);
            return (pos.Latitude, pos.Longitude, address);
        }
        catch { return (null, null, null); }
    }
}
