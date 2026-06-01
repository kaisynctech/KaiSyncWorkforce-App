using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

[QueryProperty(nameof(JobId), "JobId")]
[QueryProperty(nameof(JobTitle), "JobTitle")]
public partial class IncidentReportViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IOfflineQueueService _offline;
    private readonly ILocationService _location;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _jobId = "";
    [ObservableProperty] private string _jobTitle = "";
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string _severity = "low";
    [ObservableProperty] private string _category = "general";
    [ObservableProperty] private DateTime _occurredDate = DateTime.Today;
    [ObservableProperty] private TimeSpan _occurredTime = DateTime.Now.TimeOfDay;
    [ObservableProperty] private string _locationText = "";
    [ObservableProperty] private ObservableCollection<string> _photos = [];
    [ObservableProperty] private ObservableCollection<Client> _clients = [];
    [ObservableProperty] private Client? _selectedClient;
    [ObservableProperty] private ObservableCollection<Site> _sites = [];
    [ObservableProperty] private Site? _selectedSite;
    [ObservableProperty] private ObservableCollection<Employee> _managers = [];
    [ObservableProperty] private Employee? _selectedManager;
    [ObservableProperty] private ObservableCollection<Job> _linkableJobs = [];
    [ObservableProperty] private Job? _selectedJob;
    [ObservableProperty] private bool _captureGps = true;

    public List<string> SeverityOptions { get; } = ["low", "medium", "high", "critical"];
    public List<string> CategoryOptions { get; } = IncidentCategories.All.ToList();
    public bool IsJobLinkedFlow => !string.IsNullOrWhiteSpace(JobId);
    public bool ShowJobPicker => !IsJobLinkedFlow;

    public IncidentReportViewModel(
        IStorageService storage,
        IOfflineQueueService offline,
        ILocationService location,
        TimesheetStateService state)
    {
        _storage = storage;
        _offline = offline;
        _location = location;
        _state = state;
        Title = "Report Incident";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var companyId = employee.CompanyId;

            if (IsJobLinkedFlow && Guid.TryParse(JobId, out var jobGuid))
            {
                var job = await _storage.GetJobAsync(jobGuid, companyId, employee.Id);
                if (job != null)
                {
                    JobTitle = job.Title;
                    SelectedJob = job;
                    if (job.SiteId.HasValue)
                    {
                        var sites = await _storage.GetSitesAsync(companyId);
                        SelectedSite = sites.FirstOrDefault(s => s.Id == job.SiteId);
                    }
                }
            }
            else
            {
                var clients = await _storage.GetClientsAsync(companyId);
                Clients = new ObservableCollection<Client>(clients);
                var jobs = await _storage.GetJobsAsync(companyId, employee.Id);
                LinkableJobs = new ObservableCollection<Job>(jobs.Where(j => j.IsOpen).OrderByDescending(j => j.CreatedAt));
            }

            var managers = await _storage.GetEmployeesAsync(companyId, employee.Id);
            Managers = new ObservableCollection<Employee>(managers.Where(e => e.IsManager && e.IsActive));
        });
    }

    partial void OnSelectedClientChanged(Client? value)
    {
        if (value == null) { Sites.Clear(); return; }
        _ = LoadSitesAsync(value.Id);
    }

    private async Task LoadSitesAsync(Guid clientId)
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        var sites = await _storage.GetSitesAsync(companyId, clientId);
        Sites = new ObservableCollection<Site>(sites);
    }

    [RelayCommand]
    private async Task AddPhotoAsync()
    {
        var result = await MediaPicker.PickPhotoAsync();
        if (result != null)
            Photos.Add(result.FullPath);
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (string.IsNullOrWhiteSpace(Description))
        {
            ErrorMessage = "Description is required.";
            return;
        }

        var employee = _state.CurrentEmployee!;
        Guid? jobId = null;
        if (IsJobLinkedFlow && Guid.TryParse(JobId, out var parsedJob))
            jobId = parsedJob;
        else if (SelectedJob != null)
            jobId = SelectedJob.Id;

        double? lat = null, lng = null;
        if (CaptureGps)
        {
            try
            {
                var loc = await _location.GetCurrentPositionAsync();
                if (loc != null)
                {
                    lat = loc.Latitude;
                    lng = loc.Longitude;
                }
            }
            catch { /* GPS optional */ }
        }

        var occurredAt = OccurredDate.Date + OccurredTime;

        var incident = new IncidentReport
        {
            EmployeeId = employee.Id,
            Title = string.IsNullOrWhiteSpace(Title) ? null : Title.Trim(),
            Description = Description.Trim(),
            SeverityRaw = Severity,
            CategoryRaw = Category,
            JobId = jobId,
            SiteId = SelectedSite?.Id ?? SelectedJob?.SiteId,
            AssigneeId = SelectedManager?.Id,
            CompanyId = employee.CompanyId,
            OccurredAt = occurredAt.ToUniversalTime(),
            Latitude = lat,
            Longitude = lng,
            LocationText = string.IsNullOrWhiteSpace(LocationText) ? null : LocationText.Trim(),
            CreatedAt = DateTime.UtcNow,
        };

        if (Connectivity.NetworkAccess != NetworkAccess.Internet)
        {
            await _offline.EnqueueIncidentAsync(new PendingIncident
            {
                Incident = incident,
                LocalPhotoPaths = Photos.ToList(),
            });
            await Shell.Current.DisplayAlert(
                "Saved offline",
                "Your incident was queued and will sync when you are back online.",
                "OK");
            await ShellNavigation.GoToAsync("..");
            return;
        }

        await RunAsync(async () =>
        {
            try
            {
                await _storage.CreateIncidentAsync(incident, Photos.ToList());
                await Shell.Current.DisplayAlert(
                    "Submitted",
                    jobId.HasValue
                        ? "Incident linked to job and visible in the Incident Module."
                        : "Standalone incident submitted successfully.",
                    "OK");
                await ShellNavigation.GoToAsync("..");
            }
            catch (Exception ex)
            {
                ErrorMessage = ex.Message;
                throw;
            }
        });
    }
}
