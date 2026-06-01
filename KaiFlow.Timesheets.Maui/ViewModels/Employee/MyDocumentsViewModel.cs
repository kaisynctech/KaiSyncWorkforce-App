using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyDocumentsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<EmployeeDocument> _documents = [];

    public string CompanyDocumentsSubtitle
    {
        get
        {
            var company = _state.CurrentCompany?.Name ?? "this company";
            var pending = _state.CurrentEmployee?.RegistrationStatus == "pending"
                || (_state.CurrentEmployee != null && !_state.CurrentEmployee.IsActive);
            return pending
                ? $"Documents — {company} (pending review)"
                : $"Documents — {company}";
        }
    }

    public MyDocumentsViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export  = export;
        _state   = state;
        _state.StateChanged += OnStateChanged;
        Title = "My Documents";
    }

    private void OnStateChanged(object? sender, EventArgs e)
        => OnPropertyChanged(nameof(CompanyDocumentsSubtitle));

    public async Task LoadAsync()
    {
        await RunAsync(FetchDocumentsAsync);
    }

    private async Task FetchDocumentsAsync()
    {
        var employee = _state.CurrentEmployee!;
        var docs = await _storage.GetMyDocumentsAsync(employee.CompanyId, employee.Id);
        Documents = new ObservableCollection<EmployeeDocument>(docs);
    }

    [RelayCommand]
    private async Task SubmitDocumentAsync()
    {
        var (docType, docName) = await EmployeeDocumentTypes.PickTypeAndNameAsync();
        if (docType == null || docName == null) return;

        try
        {
            var file = await EmployeeDocumentTypes.PickFileAsync("Select your document");
            if (file == null) return;

            await RunAsync(async () =>
            {
                var employee = _state.CurrentEmployee!;
                await _storage.UploadEmployeeDocumentAsync(
                    employee.CompanyId, employee.Id, file, docType, docName, "employee");
                await FetchDocumentsAsync();
            });
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Upload failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task OpenDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try
        {
            await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Could not open document: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task DownloadDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null || string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        try
        {
            await _export.DeliverRemoteFileAsync(doc.FileUrl, doc.DocumentName);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Download failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task ReplaceDocumentAsync(EmployeeDocument doc)
    {
        if (doc == null) return;

        var docName = await Shell.Current.DisplayPromptAsync(
            "Replace Document",
            $"Select a new file for \"{doc.DocumentName}\". You can update the label if needed:",
            "Continue", "Cancel",
            initialValue: doc.DocumentName);
        if (string.IsNullOrWhiteSpace(docName)) return;

        try
        {
            var file = await EmployeeDocumentTypes.PickFileAsync("Select replacement file");
            if (file == null) return;

            await RunAsync(async () =>
            {
                var employee = _state.CurrentEmployee!;
                await _storage.ReplaceEmployeeDocumentAsync(doc, file, doc.DocumentType, docName.Trim(), "employee");
                await FetchDocumentsAsync();
            });
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Update failed: {ex.Message}";
        }
    }
}
