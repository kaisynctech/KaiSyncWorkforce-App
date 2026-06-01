using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.ViewModels;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

[QueryProperty(nameof(JobId), "JobId")]
public partial class JobCardViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly ILocationService _location;

    [ObservableProperty] private string _jobId = "";
    [ObservableProperty] private Job? _job;
    [ObservableProperty] private JobSiteVisit? _openVisit;
    [ObservableProperty] private string _onSiteStatus = "Not on site";
    [ObservableProperty] private bool _isOnThisJob;
    [ObservableProperty] private bool _isOnOtherJobSite;
    [ObservableProperty] private string _onSiteHelpText =
        "This is separate from Clock In/Out on your dashboard. Use this section to tell your manager you are physically on this job site.";
    [ObservableProperty] private JobCard? _card;
    [ObservableProperty] private ObservableCollection<JobChecklistItem> _checklist = [];
    [ObservableProperty] private ObservableCollection<InventoryUsageLine> _usedInventory = [];
    [ObservableProperty] private ObservableCollection<InventoryItem> _inventoryItems = [];
    [ObservableProperty] private ObservableCollection<IncidentReport> _incidents = [];
    [ObservableProperty] private ObservableCollection<string> _photosBefore = [];
    [ObservableProperty] private ObservableCollection<string> _photosAfter = [];
    [ObservableProperty] private ObservableCollection<string> _photos = [];
    [ObservableProperty] private string _workPerformed = "";
    [ObservableProperty] private string _materialsUsed = "";
    [ObservableProperty] private bool _isCompleted;
    [ObservableProperty] private DateTime? _actualStart;
    [ObservableProperty] private DateTime? _actualEnd;
    [ObservableProperty] private bool _isPhotosBusy;
    [ObservableProperty] private string? _loadError;
    [ObservableProperty] private JobFeedback? _latestFeedback;
    [ObservableProperty] private string _feedbackSummary = "No client feedback recorded yet.";
    [ObservableProperty] private ObservableCollection<JobDocument> _jobDocuments = [];
    [ObservableProperty] private string _clientName = "";
    [ObservableProperty] private string _siteName = "";
    [ObservableProperty] private bool _isDocumentsBusy;
    [ObservableProperty] private bool _isChecklistBusy;

    public bool HasPhotosBefore => PhotosBefore.Count > 0;
    public bool HasPhotosAfter => PhotosAfter.Count > 0;
    public bool ShowIncidentsModule => CompanyModules.IsIncidentsEnabled(_state.CurrentCompany);

    public JobCardViewModel(IStorageService storage, TimesheetStateService state, ILocationService location)
    {
        _storage = storage;
        _state = state;
        _location = location;
        Title = "Job Card";
    }

    partial void OnJobIdChanged(string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
            _ = LoadAsync();
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid))
        {
            LoadError = "Invalid job.";
            return;
        }

        await RunAsync(async () =>
        {
            LoadError = null;
            var employee = _state.CurrentEmployee!;
            Job = await _storage.GetJobAsync(jobGuid, employee.CompanyId, employee.Id);
            if (Job == null)
            {
                LoadError = "Job not found or you do not have access.";
                return;
            }

            Title = Job.Title;
            var companyId = employee.CompanyId;

            if (Job.ClientId.HasValue)
            {
                var client = await _storage.GetClientAsync(Job.ClientId.Value);
                ClientName = client?.Name ?? "";
            }
            else ClientName = "";

            if (Job.SiteId.HasValue)
            {
                var sites = await _storage.GetSitesAsync(companyId);
                SiteName = sites.FirstOrDefault(s => s.Id == Job.SiteId)?.Name ?? "";
            }
            else SiteName = "";

            JobDocuments = new ObservableCollection<JobDocument>(
                await _storage.GetJobDocumentsAsync(jobGuid, companyId, employee.Id));

            await ApplyPhotosFromDbAsync(jobGuid, employee);
            Card = await _storage.GetJobCardAsync(jobGuid, employee.Id, employee.CompanyId);
            if (Card != null)
            {
                WorkPerformed = Card.WorkPerformed ?? "";
                MaterialsUsed = Card.MaterialsUsed ?? "";
                Photos = new ObservableCollection<string>(Card.PhotoUrls);
                IsCompleted = Card.IsCompleted;
                ActualStart = Card.StartTime;
                ActualEnd = Card.EndTime;
            }

            var items = await _storage.GetChecklistItemsAsync(jobGuid, employee.Id, employee.CompanyId);
            Checklist = new ObservableCollection<JobChecklistItem>(items.OrderBy(c => c.SortOrder));

            InventoryItems = new ObservableCollection<InventoryItem>(
                await _storage.GetInventoryItemsAsync(companyId));

            var usage = await _storage.GetInventoryUsageAsync(companyId, jobGuid);
            var invById = InventoryItems.ToDictionary(i => i.Id);
            var usedByItem = new Dictionary<Guid, (double qty, double cost)>();
            foreach (var u in usage)
            {
                if (!usedByItem.TryGetValue(u.InventoryItemId, out var existing))
                    existing = (0, 0);
                usedByItem[u.InventoryItemId] = (existing.qty + u.QuantityUsed, existing.cost + u.TotalCost);
            }
            UsedInventory = new ObservableCollection<InventoryUsageLine>(
                usedByItem.Select(kv =>
                {
                    invById.TryGetValue(kv.Key, out var item);
                    var unit = kv.Value.qty > 0 ? kv.Value.cost / kv.Value.qty : item?.UnitCost ?? 0;
                    return new InventoryUsageLine(
                        item?.Name ?? kv.Key.ToString(),
                        item?.Supplier ?? "—",
                        kv.Value.qty,
                        unit,
                        kv.Value.cost);
                }).OrderBy(l => l.ItemName));

            var incidents = await _storage.GetIncidentsAsync(companyId, employee.Id, jobGuid);
            Incidents = new ObservableCollection<IncidentReport>(incidents);

            var feedback = await _storage.GetJobFeedbackAsync(companyId, employee.Id, jobGuid);
            LatestFeedback = feedback.FirstOrDefault();
            FeedbackSummary = LatestFeedback?.DisplaySummary ?? "No client feedback recorded yet.";

            await RefreshOnSiteStatusAsync(employee, jobGuid);
        });
    }

    private async Task RefreshOnSiteStatusAsync(Employee employee, Guid jobGuid)
    {
        var open = await _storage.EmployeeJobSiteOpenVisitAsync(employee.CompanyId, employee.Id);
        OpenVisit = open;
        IsOnThisJob = open != null && open.JobId == jobGuid;
        IsOnOtherJobSite = open != null && !IsOnThisJob;

        if (IsOnThisJob && open != null)
        {
            OnSiteStatus = $"On this job as {open.ReporterDisplay} since {open.SignInAt.ToLocalTime():h:mm tt}";
            return;
        }

        if (IsOnOtherJobSite && open != null)
        {
            var other = await _storage.GetJobAsync(open.JobId, employee.CompanyId, employee.Id);
            var otherTitle = string.IsNullOrWhiteSpace(other?.Title) ? "another job" : other!.Title;
            OnSiteStatus =
                $"You are on site at \"{otherTitle}\" since {open.SignInAt.ToLocalTime():h:mm tt}. Finish that visit or switch to this job below.";
            return;
        }

        OnSiteStatus = "Not on site for this job";
    }

    private JobCard BuildCardFromForm()
    {
        if (!Guid.TryParse(JobId, out var jobGuid))
            throw new InvalidOperationException("Invalid job.");
        var employee = _state.CurrentEmployee!;
        var card = Card ?? new JobCard();
        card.JobId = jobGuid;
        card.EmployeeId = employee.Id;
        card.CompanyId = employee.CompanyId;
        card.WorkPerformed = WorkPerformed;
        card.MaterialsUsed = MaterialsUsed;
        card.PhotoUrls = Photos.ToList();
        card.IsCompleted = IsCompleted;
        card.StartTime = ActualStart ?? Card?.StartTime;
        card.EndTime = ActualEnd ?? Card?.EndTime;
        return card;
    }

    private async Task PersistCardAsync(bool showConfirmation = false)
    {
        var employee = _state.CurrentEmployee!;
        var card = BuildCardFromForm();
        Card = await _storage.SaveJobCardAsync(card, employee.Id);
        ActualStart = Card.StartTime;
        ActualEnd = Card.EndTime;
        if (Job != null && card.IsCompleted)
        {
            Job.StatusRaw = "completed";
            Job.ClosedAt ??= DateTime.UtcNow;
        }
        if (showConfirmation)
            await Shell.Current.DisplayAlert("Saved", "Job card saved.", "OK");
    }

    private async Task ApplyPhotosFromDbAsync(Guid jobId, Employee employee)
    {
        var (before, after) = await _storage.GetJobPhotoUrlsAsync(jobId, employee.CompanyId, employee.Id);
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            PhotosBefore = new ObservableCollection<string>(before);
            PhotosAfter = new ObservableCollection<string>(after);
            OnPropertyChanged(nameof(HasPhotosBefore));
            OnPropertyChanged(nameof(HasPhotosAfter));
        });
    }

    [RelayCommand]
    private async Task StartOnSiteAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var employee = _state.CurrentEmployee!;
        var name = await Shell.Current.DisplayPromptAsync("On site", "Your name (optional):", "Start", "Cancel");
        if (name == null) return;

        await RunAsync(async () =>
        {
            try
            {
                var (lat, lng, address) = await CaptureLocationAsync();
                await _storage.EmployeeJobSiteSignInAsync(
                    employee.CompanyId, employee.Id, jobGuid, lat, lng, address,
                    string.IsNullOrWhiteSpace(name) ? null : name.Trim());
                await RefreshOnSiteStatusAsync(employee, jobGuid);
                await Shell.Current.DisplayAlert("On site", "You are now reported on this job site.", "OK");
            }
            catch (Exception ex) when (ex.Message.Contains("ALREADY_ON_SITE", StringComparison.OrdinalIgnoreCase))
            {
                var switchJob = await Shell.Current.DisplayAlert(
                    "On another job site",
                    "You already have an open site visit. Switch to this job instead?",
                    "Switch to this job",
                    "Cancel");
                if (!switchJob) return;
                await PerformSwitchToThisJobSiteAsync(employee, jobGuid, name);
            }
        });
    }

    [RelayCommand]
    private async Task SwitchToThisJobSiteAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var employee = _state.CurrentEmployee!;
        var name = await Shell.Current.DisplayPromptAsync("Switch job site", "Your name (optional):", "Switch", "Cancel");
        if (name == null) return;
        await RunAsync(async () => await PerformSwitchToThisJobSiteAsync(employee, jobGuid, name));
    }

    private async Task PerformSwitchToThisJobSiteAsync(Employee employee, Guid jobGuid, string? name)
    {
        var (lat, lng, address) = await CaptureLocationAsync();
        await _storage.EmployeeJobSiteSwitchToJobAsync(
            employee.CompanyId, employee.Id, jobGuid, lat, lng, address,
            string.IsNullOrWhiteSpace(name) ? null : name.Trim());
        await RefreshOnSiteStatusAsync(employee, jobGuid);
        await Shell.Current.DisplayAlert("On site", "You are now reported on this job site.", "OK");
    }

    [RelayCommand]
    private async Task EndOtherSiteVisitAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var employee = _state.CurrentEmployee!;
        if (!await Shell.Current.DisplayAlert(
                "End site visit",
                "End your open site visit on the other job? You can start this job after that.",
                "End visit",
                "Cancel"))
            return;

        await RunAsync(async () =>
        {
            await _storage.EmployeeJobSiteSignOutOpenVisitAsync(employee.CompanyId, employee.Id);
            await RefreshOnSiteStatusAsync(employee, jobGuid);
            await Shell.Current.DisplayAlert("Done", "Site visit ended. Tap \"I'm on this job\" when you are on site here.", "OK");
        });
    }

    [RelayCommand]
    private async Task FinishOnSiteAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var employee = _state.CurrentEmployee!;

        await RunAsync(async () =>
        {
            var (lat, lng, address) = await CaptureLocationAsync();
            await _storage.EmployeeJobSiteSignOutAsync(
                employee.CompanyId, employee.Id, jobGuid, lat, lng, address);
            await RefreshOnSiteStatusAsync(employee, jobGuid);
            await Shell.Current.DisplayAlert("Finished", "You have signed off this job site.", "OK");
        });
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
        catch
        {
            return (null, null, null);
        }
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        await RunAsync(async () => await PersistCardAsync(showConfirmation: true));
    }

    [RelayCommand]
    private async Task UploadPhotoAsync(string phase)
    {
        if (Job == null || !Guid.TryParse(JobId, out var jobGuid)) return;
        var employee = _state.CurrentEmployee!;
        var pick = await MediaPicker.Default.PickPhotoAsync();
        if (pick == null) return;

        IsPhotosBusy = true;
        try
        {
            var url = await _storage.UploadJobPhotoAsync(Job.CompanyId, jobGuid, pick, phase);
            await _storage.AppendJobPhotoAsync(Job.CompanyId, jobGuid, phase, url, employee.Id);
            await ApplyPhotosFromDbAsync(jobGuid, employee);
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Photos", $"Upload failed: {ex.Message}", "OK");
        }
        finally
        {
            IsPhotosBusy = false;
        }
    }

    [RelayCommand]
    private async Task OpenPhotoAsync(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        await Launcher.Default.OpenAsync(new Uri(url));
    }

    [RelayCommand]
    private async Task AddPhotoAsync()
    {
        var result = await MediaPicker.PickPhotoAsync();
        if (result != null)
            Photos.Add(result.FullPath);
    }

    [RelayCommand]
    private async Task OpenJobChatAsync()
    {
        if (Job == null || !Guid.TryParse(JobId, out var jobGuid)) return;
        try
        {
            var employee = _state.CurrentEmployee!;
            var thread = await _storage.GetOrCreateJobThreadAsync(employee.CompanyId, jobGuid, employee.Id);
            await ShellNavigation.GoToAsync(
                $"HrSimpleThreadChatPage?ThreadId={thread.Id}&ThreadSubject={Uri.EscapeDataString(Job.Title)}");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Chat", ex.Message, "OK");
        }
    }

    [RelayCommand]
    private async Task UploadJobDocumentAsync()
    {
        if (Job == null || !Guid.TryParse(JobId, out var jobGuid)) return;
        var pick = await ProjectDocumentTypes.PickAsync("Select job file");
        if (pick == null) return;

        var name = await Shell.Current.DisplayPromptAsync(
            "Document name", "Label:", "Upload", "Cancel", initialValue: pick.FileName ?? "Document");
        if (string.IsNullOrWhiteSpace(name)) return;

        IsDocumentsBusy = true;
        try
        {
            var employee = _state.CurrentEmployee!;
            var doc = await _storage.UploadJobDocumentAsync(
                employee.CompanyId, jobGuid, pick, "other", name.Trim(), employee.Id);
            JobDocuments.Insert(0, doc);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlert("Documents", ex.Message, "OK");
        }
        finally
        {
            IsDocumentsBusy = false;
        }
    }

    [RelayCommand]
    private async Task OpenJobDocumentAsync(JobDocument doc)
    {
        if (string.IsNullOrWhiteSpace(doc.FileUrl)) return;
        await Launcher.Default.OpenAsync(new Uri(doc.FileUrl));
    }

    [RelayCommand]
    private async Task AddChecklistItemAsync()
    {
        if (!Guid.TryParse(JobId, out var jobGuid)) return;
        var desc = await Shell.Current.DisplayPromptAsync("Add Checklist Item", "Description:", "Add", "Cancel");
        if (string.IsNullOrWhiteSpace(desc)) return;

        IsChecklistBusy = true;
        try
        {
            var employee = _state.CurrentEmployee!;
            var item = await _storage.CreateChecklistItemForJobAsync(
                employee.CompanyId, employee.Id, jobGuid, desc.Trim());
            Checklist.Add(item);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlert("Checklist", ex.Message, "OK");
        }
        finally
        {
            IsChecklistBusy = false;
        }
    }

    [RelayCommand]
    private async Task ReportIncidentAsync()
    {
        if (Job == null || !Guid.TryParse(JobId, out var jobGuid)) return;
        await ShellNavigation.GoToAsync(
            nameof(Views.Employee.IncidentReportPage),
            new Dictionary<string, object>
            {
                ["JobId"] = jobGuid.ToString(),
                ["JobTitle"] = Job.Title,
            });
    }

    [RelayCommand]
    private async Task ViewIncidentAsync(IncidentReport incident)
        => await ShellNavigation.GoToAsync(
            nameof(Views.Hr.HrIncidentDetailsPage),
            new Dictionary<string, object> { ["incidentId"] = incident.Id.ToString() });

    [RelayCommand]
    private async Task ToggleChecklistItemAsync(JobChecklistItem item)
    {
        item.IsChecked = !item.IsChecked;
        OnPropertyChanged(nameof(Checklist));
        var employee = _state.CurrentEmployee!;
        await RunAsync(async () =>
        {
            await _storage.SaveChecklistItemAsync(item, employee.Id);
        });
    }

    [RelayCommand]
    private async Task StampActualStartAsync()
    {
        ActualStart = DateTime.Now;
        await RunAsync(async () => await PersistCardAsync());
    }

    [RelayCommand]
    private async Task StampActualEndAsync()
    {
        ActualEnd = DateTime.Now;
        await RunAsync(async () => await PersistCardAsync());
    }

    [RelayCommand]
    private async Task RecordInventoryAsync()
    {
        if (InventoryItems.Count == 0)
        {
            await Shell.Current.DisplayAlert("No Items", "No inventory items found.", "OK");
            return;
        }
        if (!Guid.TryParse(JobId, out var jobGuid)) return;

        var names = InventoryItems.Select(i => i.Name).ToArray();
        var picked = await Shell.Current.DisplayActionSheet("Select Item", "Cancel", null, names);
        if (picked == null || picked == "Cancel") return;

        var item = InventoryItems.FirstOrDefault(i => i.Name == picked);
        if (item == null) return;

        var qtyStr = await Shell.Current.DisplayPromptAsync("Quantity", $"How many {item.Name}?", keyboard: Keyboard.Numeric);
        if (!double.TryParse(qtyStr, out var qty) || qty <= 0) return;

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var usage = new InventoryUsage
            {
                Id = Guid.NewGuid(),
                InventoryItemId = item.Id,
                JobId = jobGuid,
                EmployeeId = employee.Id,
                QuantityUsed = qty,
                UnitCostAtUse = item.UnitCost,
                UsedAt = DateTime.UtcNow,
                CompanyId = employee.CompanyId
            };
            await _storage.CreateInventoryUsageAsync(usage);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task CaptureClientFeedbackAsync()
    {
        if (!Guid.TryParse(JobId, out _)) return;

        var ratingStr = await Shell.Current.DisplayPromptAsync(
            "Client Feedback", "Rating (1-5):", "Next", "Cancel",
            keyboard: Keyboard.Numeric);
        if (ratingStr == null) return;
        if (!int.TryParse(ratingStr.Trim(), out var rating) || rating < 1 || rating > 5)
        {
            await Shell.Current.DisplayAlert("Invalid", "Enter a rating from 1 to 5.", "OK");
            return;
        }

        var comments = await Shell.Current.DisplayPromptAsync(
            "Client Feedback", "Comments (optional):", "Submit", "Cancel");
        if (comments == null) return;

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var saved = await _storage.SubmitJobFeedbackAsync(
                employee.CompanyId, employee.Id, Guid.Parse(JobId), rating, comments);
            LatestFeedback = saved;
            FeedbackSummary = saved.DisplaySummary;
            await Shell.Current.DisplayAlert("Submitted", $"Feedback saved: {rating}/5", "OK");
        });
    }
}
