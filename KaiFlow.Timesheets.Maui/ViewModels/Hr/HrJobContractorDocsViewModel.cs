using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

/// <summary>
/// Phase D — Documents for a single contractor assignment on a job.
/// Navigated to via Shell query param: jobContractorId=&lt;guid&gt;
/// </summary>
[QueryProperty(nameof(JobContractorIdStr), "jobContractorId")]
public partial class HrJobContractorDocsViewModel : BaseViewModel
{
    private readonly IStorageService       _storage;
    private readonly TimesheetStateService _state;

    public HrJobContractorDocsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state   = state;
        Title    = "Assignment Documents";
    }

    // ── Query param ───────────────────────────────────────────────────────────

    [ObservableProperty] private string _jobContractorIdStr = "";

    partial void OnJobContractorIdStrChanged(string value)
    {
        if (Guid.TryParse(value, out var id))
        {
            JobContractorId = id;
            _ = LoadAsync();
        }
    }

    // ── State ─────────────────────────────────────────────────────────────────

    [ObservableProperty] private Guid   _jobContractorId;
    [ObservableProperty] private string _pageTitle = "Assignment Documents";
    [ObservableProperty] private string _subTitle  = "";
    [ObservableProperty] private bool   _isDocsBusy;

    // ── Documents list ────────────────────────────────────────────────────────

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDocs))]
    [NotifyPropertyChangedFor(nameof(HasNoDocs))]
    private ObservableCollection<JobContractorDocument> _docs = [];

    public bool HasDocs   => Docs.Count > 0;
    public bool HasNoDocs => Docs.Count == 0;

    // ── Document type picker ──────────────────────────────────────────────────

    public IReadOnlyList<string> DocumentTypeLabels => JobContractorDocumentTypes.TypeLabels;

    [ObservableProperty] private string _selectedDocTypeLabel =
        JobContractorDocumentTypes.TypeLabels[0]; // "Method Statement"

    private string SelectedDocTypeKey =>
        JobContractorDocumentTypes.TypeKeys[
            Math.Max(0, Array.IndexOf(JobContractorDocumentTypes.TypeLabels, SelectedDocTypeLabel))];

    // ── Cached assignment data ────────────────────────────────────────────────

    private Guid _companyId;
    private Guid _jobId;
    private Guid _contractorId;

    // ── Load ──────────────────────────────────────────────────────────────────

    public async Task LoadAsync()
    {
        if (JobContractorId == Guid.Empty) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee?.CompanyId ?? Guid.Empty;
            _companyId    = companyId;

            // Load the assignment row (with jobs embed) for header metadata.
            var jc = await _storage.GetJobContractorByIdAsync(JobContractorId, companyId);
            if (jc != null)
            {
                _jobId        = jc.JobId;
                _contractorId = jc.ContractorId;

                var jobCode  = jc.Job?.JobCodeDisplay ?? "Job";
                var jobTitle = jc.Job?.Title ?? "";

                var contractor = await _storage.GetContractorByIdAsync(companyId, jc.ContractorId);
                var cName      = contractor?.Name ?? "Contractor";

                await MainThread.InvokeOnMainThreadAsync(() =>
                {
                    PageTitle = $"{cName} — {jobCode}";
                    SubTitle  = jobTitle;
                });
            }

            var docs = await _storage.GetJobContractorDocumentsAsync(companyId, JobContractorId);
            await MainThread.InvokeOnMainThreadAsync(() =>
                Docs = new ObservableCollection<JobContractorDocument>(docs));
        });
    }

    // ── Commands ──────────────────────────────────────────────────────────────

    [RelayCommand]
    private async Task UploadDocAsync()
    {
        var pick = await JobContractorDocumentTypes.PickAsync();
        if (pick == null) return;

        var name = await Shell.Current.DisplayPromptAsync(
            "Document name", "Label:", "Upload", "Cancel",
            initialValue: pick.FileName ?? "Document");
        if (string.IsNullOrWhiteSpace(name)) return;

        IsDocsBusy = true;
        try
        {
            var doc = await _storage.UploadJobContractorDocumentAsync(
                _companyId, _jobId, _contractorId, JobContractorId,
                pick, SelectedDocTypeKey, name.Trim(),
                _state.CurrentEmployee?.Id);

            await MainThread.InvokeOnMainThreadAsync(() => Docs.Insert(0, doc));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsDocsBusy = false;
        }
    }

    [RelayCommand]
    private async Task OpenDocAsync(JobContractorDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
    }

    [RelayCommand]
    private async Task DeleteDocAsync(JobContractorDocument doc)
    {
        if (!await Shell.Current.DisplayAlertAsync(
                "Remove", $"Remove '{doc.DocumentName}'?", "Remove", "Cancel"))
            return;

        await RunAsync(async () =>
        {
            await _storage.DeleteJobContractorDocumentAsync(doc);
            await MainThread.InvokeOnMainThreadAsync(() => Docs.Remove(doc));
        });
    }
}
