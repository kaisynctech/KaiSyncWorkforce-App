using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

[QueryProperty(nameof(JobId), "JobId")]
public partial class HrJobDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private List<InventoryItem> _inventoryCatalog = [];

    [ObservableProperty] private string _jobId = "";
    [ObservableProperty] private Job? _job;
    [ObservableProperty] private JobCard? _card;
    [ObservableProperty] private Client? _client;
    [ObservableProperty] private Site? _site;
    [ObservableProperty] private ObservableCollection<LaborEntry> _laborEntries = [];
    [ObservableProperty] private ObservableCollection<IncidentReport> _incidents = [];
    [ObservableProperty] private ObservableCollection<JobChecklistItem> _checklist = [];
    [ObservableProperty] private ObservableCollection<InventoryUsageLine> _inventoryLines = [];
    [ObservableProperty] private ObservableCollection<JobDocument> _jobDocuments = [];
    [ObservableProperty] private ObservableCollection<JobSiteSession> _siteSessions = [];
    [ObservableProperty] private string _contractorHoursSummary = "";
    [ObservableProperty] private ObservableCollection<string> _photosBefore = [];
    [ObservableProperty] private ObservableCollection<string> _photosAfter = [];
    [ObservableProperty] private ObservableCollection<SelectableEmployee> _teamMembers = [];
    [ObservableProperty] private ObservableCollection<Contractor> _contractors = [];
    [ObservableProperty] private Contractor? _selectedContractor;
    [ObservableProperty] private string _contractorCostText = "0";
    [ObservableProperty] private ObservableCollection<JobContractor> _jobContractors = [];

    public bool HasJobContractors  => JobContractors.Count > 0;
    public bool HasNoJobContractors => JobContractors.Count == 0;
    [ObservableProperty] private string _selectedStatus = "";
    [ObservableProperty] private string _inventoryTotalDisplay = "R0.00";
    [ObservableProperty] private bool _isLoadingPage;
    [ObservableProperty] private bool _isPhotosBusy;
    [ObservableProperty] private bool _isDocumentsBusy;
    [ObservableProperty] private bool _isChecklistBusy;
    [ObservableProperty] private ClientDeal? _linkedProject;
    private List<ClientDeal> _allProjects = [];

    public List<string> StatusOptions { get; } = ["scheduled", "inProgress", "completed", "cancelled"];
    public IReadOnlyList<string> DocumentTypeLabels => ProjectDocumentTypes.TypeLabels;
    public string SelectedDocumentTypeKey =>
        ProjectDocumentTypes.TypeKeys[
            Math.Max(0, Array.IndexOf(ProjectDocumentTypes.TypeLabels, SelectedDocumentTypeLabel))];
    [ObservableProperty] private string _selectedDocumentTypeLabel = "Other";

    public bool HasJob => Job != null;
    public bool ShowLifecycleActions => Job?.IsOpen == true;
    public bool HasTeamSelected => TeamMembers.Any(t => t.IsSelected);
    public bool HasContractor => SelectedContractor != null || (Job?.ContractorId != null);
    public bool HasPhotosBefore => PhotosBefore.Count > 0;
    public bool HasPhotosAfter => PhotosAfter.Count > 0;

    partial void OnJobChanged(Job? value)
    {
        OnPropertyChanged(nameof(HasJob));
        OnPropertyChanged(nameof(ShowLifecycleActions));
    }

    partial void OnJobContractorsChanged(ObservableCollection<JobContractor> value)
    {
        OnPropertyChanged(nameof(HasJobContractors));
        OnPropertyChanged(nameof(HasNoJobContractors));
    }

    public HrJobDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Job Details";
    }

    public void RequestReload()
    {
        MainThread.BeginInvokeOnMainThread(async () =>
        {
            try
            {
                await LoadAsync();
            }
            catch (Exception ex)
            {
                ErrorMessage = ex.Message;
            }
        });
    }

    partial void OnJobIdChanged(string value) => RequestReload();

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(JobId, out var id)) return;
        if (IsLoadingPage) return;

        IsLoadingPage = true;
        ErrorMessage = null;
        try
        {
            Job = await _storage.GetJobAsync(id);
            if (Job == null)
            {
                ErrorMessage = "Job not found.";
                return;
            }

            Job.AssignedEmployeeIds ??= [];
            Title = Job.Title;
            SelectedStatus = Job.StatusRaw;
            ContractorCostText = Job.ContractorCost.ToString("F2");
            await ApplyPhotosFromDbAsync(id);

            Card = await _storage.GetJobCardAsync(id);
            var employee = _state.CurrentEmployee;
            if (employee == null)
            {
                ErrorMessage = "You must be signed in to view this job.";
                return;
            }

            var companyId = employee.CompanyId;

            if (Job?.ClientId.HasValue == true)
                Client = await _storage.GetClientAsync(Job.ClientId!.Value);

            _allProjects = await _storage.GetClientDealsAsync(companyId);
            // Enrich all deals with client names so every picker entry shows the full format.
            var allClients  = await _storage.GetClientsAsync(companyId);
            var clientById  = allClients.ToDictionary(c => c.Id);
            foreach (var d in _allProjects)
                if (d.ClientId.HasValue && clientById.TryGetValue(d.ClientId.Value, out var cl))
                    d.ClientName = cl.Name;
            LinkedProject = Job?.DealId.HasValue == true
                ? _allProjects.FirstOrDefault(d => d.Id == Job.DealId!.Value)
                : null;

            if (Job?.SiteId.HasValue == true)
            {
                var sites = await _storage.GetSitesAsync(companyId);
                Site = sites.FirstOrDefault(s => s.Id == Job.SiteId!.Value);
            }

            var labor = await _storage.GetLaborEntriesAsync(companyId, DateOnly.MinValue, DateOnly.MaxValue, jobId: id);
            LaborEntries = new ObservableCollection<LaborEntry>(labor);

            _inventoryCatalog = await _storage.GetInventoryItemsAsync(companyId);
            var inv = await _storage.GetInventoryUsageAsync(companyId, id);
            var invById = _inventoryCatalog.ToDictionary(i => i.Id);
            var usedByItem = new Dictionary<Guid, (double qty, double cost, double unitSum)>();
            foreach (var u in inv)
            {
                if (!usedByItem.TryGetValue(u.InventoryItemId, out var existing))
                    existing = (0, 0, 0);
                usedByItem[u.InventoryItemId] = (
                    existing.qty + u.QuantityUsed,
                    existing.cost + u.TotalCost,
                    existing.unitSum + u.UnitCostAtUse * u.QuantityUsed);
            }
            InventoryLines = new ObservableCollection<InventoryUsageLine>(
                usedByItem.Select(kv =>
                {
                    invById.TryGetValue(kv.Key, out var item);
                    var unit = kv.Value.qty > 0 ? kv.Value.unitSum / kv.Value.qty : item?.UnitCost ?? 0;
                    return new InventoryUsageLine(
                        item?.Name ?? kv.Key.ToString(),
                        item?.Supplier ?? "—",
                        kv.Value.qty,
                        unit,
                        kv.Value.cost);
                }).OrderBy(l => l.ItemName));
            RefreshInventoryTotal();

            var incidents = await _storage.GetIncidentsAsync(companyId);
            Incidents = new ObservableCollection<IncidentReport>(incidents.Where(i => i.JobId == id));

            var checklistItems = await _storage.GetChecklistItemsAsync(id);
            Checklist = new ObservableCollection<JobChecklistItem>(checklistItems.OrderBy(c => c.SortOrder));

            JobDocuments = new ObservableCollection<JobDocument>(await _storage.GetJobDocumentsAsync(id));

            var employees = (await _storage.GetEmployeesAsync(companyId)).Where(e => e.IsActive).OrderBy(e => e.FullName).ToList();
            var assigned = Job?.AssignedEmployeeIds ?? [];
            TeamMembers = new ObservableCollection<SelectableEmployee>(
                employees.Select(e => new SelectableEmployee(e) { IsSelected = assigned.Contains(e.Id) }));

            Contractors = new ObservableCollection<Contractor>(
                (await _storage.GetContractorsAsync(companyId)).Where(c => c.IsActive).OrderBy(c => c.Name));
            if (Job?.ContractorId != null)
                SelectedContractor = Contractors.FirstOrDefault(c => c.Id == Job.ContractorId);

            var jcRows = await _storage.GetJobContractorsAsync(id);
            var nameMap = Contractors.ToDictionary(c => c.Id, c => c.Name);
            foreach (var row in jcRows)
                row.ContractorDisplayName = nameMap.GetValueOrDefault(row.ContractorId, "Unknown");
            await EnrichJobContractorFinancialsAsync(jcRows, companyId, id);
            JobContractors = new ObservableCollection<JobContractor>(jcRows);

            try
            {
                var visits = await _storage.GetJobSiteVisitsAsync(id);
                SiteSessions = new ObservableCollection<JobSiteSession>(JobSiteSession.Build(visits));
                var assignedIds = JobContractors.Select(jc => jc.ContractorId).ToHashSet();
                if (Job?.ContractorId.HasValue == true) assignedIds.Add(Job.ContractorId.Value);
                var contractorHours = visits
                    .Where(v => v.IsContractor && assignedIds.Contains(v.ContractorId ?? Guid.Empty))
                    .Sum(v => JobSiteSession.Build([v]).Sum(s => s.TotalHours));
                ContractorHoursSummary = contractorHours > 0
                    ? $"{contractorHours:F1} hrs on site · {JobContractors.Count} contractor(s)"
                    : "No contractor site time yet";
            }
            catch
            {
                SiteSessions = [];
                ContractorHoursSummary = "Site time unavailable";
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsLoadingPage = false;
        }
    }

    private async Task ApplyPhotosFromDbAsync(Guid jobId)
    {
        var (before, after) = await _storage.GetJobPhotoUrlsAsync(jobId);
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            PhotosBefore = new ObservableCollection<string>(before);
            PhotosAfter = new ObservableCollection<string>(after);
            if (Job != null)
            {
                Job.PhotoUrlsBefore = before;
                Job.PhotoUrlsAfter = after;
            }
            OnPropertyChanged(nameof(HasPhotosBefore));
            OnPropertyChanged(nameof(HasPhotosAfter));
        });
    }

    private void RefreshInventoryTotal()
    {
        var total = InventoryLines.Sum(l => l.TotalCost);
        InventoryTotalDisplay = $"R{total:N2}";
        OnPropertyChanged(nameof(InventoryTotalDisplay));
    }

    private async Task EnrichJobContractorFinancialsAsync(
        IEnumerable<JobContractor> rows, Guid companyId, Guid jobId)
    {
        var allPayouts = await _storage.GetContractorPayoutsAsync(companyId);
        var jobPayouts = allPayouts.Where(p => p.JobId == jobId).ToList();
        foreach (var row in rows)
        {
            var rp = row.Id != Guid.Empty
                ? jobPayouts.Where(p => p.JobContractorId == row.Id).ToList()
                : jobPayouts.Where(p => p.ContractorId == row.ContractorId
                                     && !p.JobContractorId.HasValue).ToList();
            row.PaidAmount     = rp.Where(p => p.PayoutStatusRaw == "paid")    .Sum(p => p.TotalAmount);
            row.ApprovedAmount = rp.Where(p => p.PayoutStatusRaw == "approved").Sum(p => p.TotalAmount);
            row.PendingAmount  = rp.Where(p => p.PayoutStatusRaw == "pending") .Sum(p => p.TotalAmount);
        }
    }

    [RelayCommand]
    private async Task SaveJobAsync()
    {
        if (Job == null) return;
        await RunAsync(async () =>
        {
            var selected = TeamMembers.Where(t => t.IsSelected).Select(t => t.Employee.Id).ToList();
            Job.AssignedEmployeeIds = selected;
            Job.AssigneeEmployeeId = selected.FirstOrDefault() == Guid.Empty ? null : selected.FirstOrDefault();
            Job.ContractorId = SelectedContractor?.Id;
            Job.ContractorCost = double.TryParse(ContractorCostText, out var c) ? Math.Max(0, c) : 0;
            Job.StatusRaw = SelectedStatus;
            Job = await _storage.UpdateJobAsync(Job);
            foreach (var checklistItem in Checklist.ToList())
                await _storage.SaveChecklistItemAsync(checklistItem);
            await ApplyPhotosFromDbAsync(Job.Id);
            OnPropertyChanged(nameof(ShowLifecycleActions));
            await Shell.Current.DisplayAlertAsync("Saved", "All job changes have been saved.", "OK");
        });
    }

    [RelayCommand]
    private async Task SaveTeamAndContractorAsync()
    {
        if (Job == null) return;
        await RunAsync(async () =>
        {
            var selected = TeamMembers.Where(t => t.IsSelected).Select(t => t.Employee.Id).ToList();
            Job.AssignedEmployeeIds = selected;
            Job.AssigneeEmployeeId = selected.FirstOrDefault() == Guid.Empty ? null : selected.FirstOrDefault();
            Job.ContractorId = SelectedContractor?.Id;
            Job.ContractorCost = double.TryParse(ContractorCostText, out var c) ? Math.Max(0, c) : 0;
            Job = await _storage.UpdateJobAsync(Job);
            await Shell.Current.DisplayAlertAsync("Saved", "Team and contractor updated.", "OK");
        });
    }

    [RelayCommand]
    private async Task AddContractorToJobAsync()
    {
        if (Job == null) return;

        // Build list of contractors not already assigned to this job
        var alreadyAssigned = JobContractors.Select(jc => jc.ContractorId).ToHashSet();
        var available = Contractors
            .Where(c => !alreadyAssigned.Contains(c.Id))
            .OrderBy(c => c.Name)
            .ToList();

        // Always include the quick-create option as the first entry
        const string CreateNew = "➕ Create new contractor...";
        var names  = new[] { CreateNew }.Concat(available.Select(c => c.Name)).ToArray();
        var picked = await Shell.Current.DisplayActionSheetAsync(
            "Assign contractor", "Cancel", null, names);
        if (string.IsNullOrEmpty(picked) || picked == "Cancel") return;

        Contractor contractor;
        if (picked == CreateNew)
        {
            var name = await Shell.Current.DisplayPromptAsync(
                "New contractor",
                "Individual or company name:",
                "Next", "Cancel", "");
            if (string.IsNullOrWhiteSpace(name)) return;

            contractor = await _storage.CreateContractorAsync(new Contractor
            {
                CompanyId      = _state.CurrentEmployee!.CompanyId,
                Name           = name.Trim(),
                PartnerKindRaw = PartnerKinds.Contractor,
                IsActive       = true,
                CreatedAt      = DateTime.UtcNow
            });
            // Add to the in-memory picker collection so it appears in future uses this session
            Contractors.Add(contractor);
        }
        else
        {
            contractor = available.FirstOrDefault(c => c.Name == picked)!;
            if (contractor == null) return;
        }

        // Phase M — compliance enforcement gate
        if (contractor.ComplianceHold)
        {
            var proceed = await Shell.Current.DisplayAlert(
                "Compliance Hold Active",
                $"{contractor.Name} has an active compliance hold.\n\nAssigning them to this job may create a liability risk. Ensure outstanding compliance documents are resolved promptly.\n\nProceed with assignment?",
                "Proceed Anyway", "Cancel");
            if (!proceed) return;
        }

        // Optional role
        var role = await Shell.Current.DisplayPromptAsync(
            "Role (optional)",
            "e.g. Electrical, Plumbing, Civil — or leave blank:",
            "Assign", "Skip", "");

        // Optional agreed amount
        var amountStr = await Shell.Current.DisplayPromptAsync(
            "Agreed amount (optional)",
            "Contractor cost for this assignment (R):",
            "Assign", "Skip", "0",
            keyboard: Keyboard.Numeric);
        decimal.TryParse(amountStr, out var agreedAmount);

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.HrUpsertJobContractorAsync(
                companyId, Job.Id, contractor.Id,
                quoteId:      null,
                agreedAmount: agreedAmount,
                dealId:       Job.DealId);   // writes project_contractors if job has a project

            // Reload join table and enrich with names
            var jcRows = await _storage.GetJobContractorsAsync(Job.Id);
            var contractorMap = Contractors.ToDictionary(c => c.Id);
            foreach (var row in jcRows)
            {
                var c = contractorMap.GetValueOrDefault(row.ContractorId);
                row.ContractorDisplayName   = c?.Name                ?? "Unknown";
                row.ContractorComplianceHold = c?.ComplianceHold     ?? false;
            }

            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                JobContractors = new ObservableCollection<JobContractor>(jcRows);
                OnPropertyChanged(nameof(HasJobContractors));
                OnPropertyChanged(nameof(HasNoJobContractors));
            });

            // Backward compat: set legacy contractor_id to the first assignment if currently unset
            if (Job.ContractorId == null && jcRows.Count > 0)
            {
                Job.ContractorId = jcRows[0].ContractorId;
                await _storage.UpdateJobAsync(Job);
            }
        });
    }

    [RelayCommand]
    private async Task RemoveContractorFromJobAsync(JobContractor assignment)
    {
        if (assignment == null || Job == null) return;

        var confirmed = await Shell.Current.DisplayAlert(
            "Remove contractor",
            $"Remove {(string.IsNullOrEmpty(assignment.ContractorDisplayName) ? "this contractor" : assignment.ContractorDisplayName)} from the job?",
            "Remove", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.DeleteJobContractorAsync(companyId, assignment.Id);

            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                JobContractors.Remove(assignment);
                OnPropertyChanged(nameof(HasJobContractors));
                OnPropertyChanged(nameof(HasNoJobContractors));
            });
        });
    }

    [RelayCommand]
    private async Task EditContractorAssignmentAsync(JobContractor assignment)
    {
        if (assignment == null || Job == null) return;

        // Pre-fill with current values
        var currentRole   = assignment.Role == "general" ? "" : assignment.Role;
        var currentAmount = assignment.AgreedAmount.ToString("F2");

        var newRole = await Shell.Current.DisplayPromptAsync(
            "Edit role",
            "Contractor role (e.g. Plumbing, Electrical — leave blank for General):",
            "Next", "Cancel",
            initialValue: currentRole);
        if (newRole == null) return;   // user cancelled

        var amountStr = await Shell.Current.DisplayPromptAsync(
            "Edit amount",
            "Agreed amount (R):",
            "Save", "Cancel",
            initialValue: currentAmount,
            keyboard: Keyboard.Numeric);
        if (amountStr == null) return;  // user cancelled

        if (!decimal.TryParse(amountStr.Trim(), out var newAmount) || newAmount < 0)
        {
            await Shell.Current.DisplayAlertAsync("Invalid", "Please enter a valid amount.", "OK");
            return;
        }

        var finalRole = string.IsNullOrWhiteSpace(newRole) ? "general" : newRole.Trim();

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            await _storage.UpdateJobContractorAsync(
                companyId, assignment.Id, finalRole, newAmount);

            // Reload to reflect changes
            var jc = await _storage.GetJobContractorsAsync(Job.Id);
            await EnrichJobContractorFinancialsAsync(jc, _state.CurrentEmployee!.CompanyId, Job.Id);
            await MainThread.InvokeOnMainThreadAsync(() =>
            {
                JobContractors = new ObservableCollection<JobContractor>(jc);
                // Re-enrich with contractor names
                var nameMap = Contractors.ToDictionary(c => c.Id, c => c.Name);
                foreach (var row in JobContractors)
                    row.ContractorDisplayName =
                        nameMap.GetValueOrDefault(row.ContractorId, "Unknown");
                OnPropertyChanged(nameof(HasJobContractors));
            });
        });
    }

    [RelayCommand]
    private async Task OpenJobContractorDocsAsync(JobContractor assignment)
    {
        await Shell.Current.GoToAsync(
            $"{nameof(Views.Hr.HrJobContractorDocsPage)}?jobContractorId={assignment.Id}");
    }

    [RelayCommand]
    private async Task AddInventoryAsync()
    {
        if (Job == null) return;
        var active = _inventoryCatalog.Where(i => i.IsActive).ToList();
        if (active.Count == 0)
        {
            await Shell.Current.DisplayAlertAsync("Inventory", "Add inventory items under Inventory first.", "OK");
            return;
        }

        var names = active.Select(i => $"{i.Name} ({i.Supplier ?? "no supplier"})").ToArray();
        var picked = await Shell.Current.DisplayActionSheet("Select inventory", "Cancel", null, names);
        if (picked == null || picked == "Cancel") return;
        var idx = Array.IndexOf(names, picked);
        if (idx < 0) return;
        var item = active[idx];

        var qtyStr = await Shell.Current.DisplayPromptAsync(
            "Quantity", $"How many {item.Name}? ({item.UnitOfMeasure})", keyboard: Keyboard.Numeric, initialValue: "1");
        if (!double.TryParse(qtyStr, out var qty) || qty <= 0) return;

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            await _storage.CreateInventoryUsageAsync(new InventoryUsage
            {
                Id = Guid.NewGuid(),
                CompanyId = employee.CompanyId,
                JobId = Job.Id,
                InventoryItemId = item.Id,
                EmployeeId = employee.Id,
                QuantityUsed = qty,
                UnitCostAtUse = item.UnitCost,
                UsedAt = DateTime.UtcNow
            });

            var inv = await _storage.GetInventoryUsageAsync(employee.CompanyId, Job.Id);
            Job.InventoryCost = inv.Sum(u => u.TotalCost);
            Job = await _storage.UpdateJobAsync(Job);
            await LoadAsync();
        });
    }

    [RelayCommand]
    private async Task UploadPhotoAsync(string phase)
    {
        if (Job == null) return;
        var pick = await MediaPicker.Default.PickPhotoAsync();
        if (pick == null) return;

        IsPhotosBusy = true;
        try
        {
            var url = await _storage.UploadJobPhotoAsync(Job.CompanyId, Job.Id, pick, phase);
            await _storage.AppendJobPhotoAsync(Job.CompanyId, Job.Id, phase, url);
            await ApplyPhotosFromDbAsync(Job.Id);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlertAsync("Photos", $"Upload failed: {ex.Message}", "OK");
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
    private async Task UploadJobDocumentAsync()
    {
        if (Job == null) return;
        var pick = await ProjectDocumentTypes.PickAsync("Select job file");
        if (pick == null) return;

        var name = await Shell.Current.DisplayPromptAsync(
            "Document name", "Label:", "Upload", "Cancel", initialValue: pick.FileName ?? "Document");
        if (string.IsNullOrWhiteSpace(name)) return;

        IsDocumentsBusy = true;
        try
        {
            var doc = await _storage.UploadJobDocumentAsync(
                Job.CompanyId, Job.Id, pick, SelectedDocumentTypeKey, name.Trim());
            await MainThread.InvokeOnMainThreadAsync(() => JobDocuments.Insert(0, doc));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlertAsync("Documents", $"Upload failed: {ex.Message}", "OK");
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
    private async Task DeleteJobDocumentAsync(JobDocument doc)
    {
        if (!await Shell.Current.DisplayAlertAsync("Remove", $"Remove '{doc.DocumentName}'?", "Remove", "Cancel"))
            return;
        await RunAsync(async () =>
        {
            await _storage.DeleteJobDocumentAsync(doc);
            JobDocuments.Remove(doc);
        });
    }

    [RelayCommand]
    private async Task ReportIncidentAsync()
    {
        if (Job == null) return;
        await ShellNavigation.GoToAsync(
            nameof(Views.Employee.IncidentReportPage),
            new Dictionary<string, object>
            {
                ["JobId"] = Job.Id.ToString(),
                ["JobTitle"] = Job.Title,
            });
    }

    [RelayCommand]
    private async Task UpdateStatusAsync()
    {
        if (Job == null) return;
        await RunAsync(async () =>
        {
            Job.StatusRaw = SelectedStatus;
            if (SelectedStatus is "completed" or "cancelled")
                Job.ClosedAt = DateTime.UtcNow;
            await _storage.UpdateJobAsync(Job);
        });
    }

    [RelayCommand]
    private async Task MarkFirstResponseAsync()
    {
        if (Job == null || Job.FirstResponseAt.HasValue) return;
        await RunAsync(async () =>
        {
            Job.FirstResponseAt = DateTime.UtcNow;
            await _storage.UpdateJobAsync(Job);
        });
    }

    [RelayCommand]
    private async Task CloseJobAsync()
    {
        if (Job == null) return;
        var input = await Shell.Current.DisplayPromptAsync(
            "Close Job", "Enter actual cost (leave blank to skip):", "Close", "Cancel",
            keyboard: Keyboard.Numeric);
        if (input == null) return;
        await RunAsync(async () =>
        {
            Job.StatusRaw = "completed";
            Job.ClosedAt = DateTime.UtcNow;
            if (double.TryParse(input.Trim(), out var cost) && cost > 0)
                Job.ActualCost = cost;
            if (!Job.FirstResponseAt.HasValue)
                Job.FirstResponseAt = DateTime.UtcNow;
            await _storage.UpdateJobAsync(Job);
            SelectedStatus = "completed";
        });
    }

    [RelayCommand]
    private async Task AddChecklistItemAsync()
    {
        if (Job == null) return;
        var desc = await Shell.Current.DisplayPromptAsync("Add Checklist Item", "Description:", "Add", "Cancel");
        if (string.IsNullOrWhiteSpace(desc)) return;
        IsChecklistBusy = true;
        try
        {
            var item = new JobChecklistItem
            {
                Id = Guid.NewGuid(),
                JobId = Job.Id,
                Description = desc.Trim(),
                IsChecked = false,
                SortOrder = Checklist.Count,
                CompanyId = _state.CurrentEmployee!.CompanyId
            };
            var saved = await _storage.SaveChecklistItemAsync(item);
            await MainThread.InvokeOnMainThreadAsync(() => Checklist.Add(saved));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlertAsync("Checklist", $"Could not save item: {ex.Message}", "OK");
        }
        finally
        {
            IsChecklistBusy = false;
        }
    }

    [RelayCommand]
    private async Task ToggleChecklistItemAsync(JobChecklistItem item)
    {
        IsChecklistBusy = true;
        try
        {
            item.IsChecked = !item.IsChecked;
            var saved = await _storage.SaveChecklistItemAsync(item);
            var idx = Checklist.IndexOf(item);
            if (idx >= 0)
                await MainThread.InvokeOnMainThreadAsync(() => Checklist[idx] = saved);
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlertAsync("Checklist", $"Could not save: {ex.Message}", "OK");
        }
        finally
        {
            IsChecklistBusy = false;
        }
    }

    [RelayCommand]
    private async Task EditJobAsync()
    {
        if (Job == null) return;
        var newTitle = await Shell.Current.DisplayPromptAsync("Edit Job", "Title:", "Next", "Cancel", Job.Title);
        if (newTitle == null) return;
        var newDesc = await Shell.Current.DisplayPromptAsync("Edit Job", "Description:", "Save", "Cancel", Job.Description ?? "");
        if (newDesc == null) return;

        await RunAsync(async () =>
        {
            Job.Title = newTitle.Trim();
            Job.Description = string.IsNullOrWhiteSpace(newDesc) ? null : newDesc.Trim();
            await _storage.UpdateJobAsync(Job);
            Title = Job.Title;
            OnPropertyChanged(nameof(Job));
        });
    }

    [RelayCommand]
    private async Task OpenLinkedProjectAsync()
    {
        if (LinkedProject == null) return;
        try
        {
            await ShellNavigation.GoToAsync(
                nameof(Views.Hr.HrProjectDetailPage),
                new Dictionary<string, object> { ["DealId"] = LinkedProject.Id.ToString() });
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Navigation", $"Could not open project: {ex.Message}", "OK");
        }
    }

    [RelayCommand]
    private async Task ChangeProjectAsync()
    {
        if (Job == null) return;

        var active = _allProjects
            .Where(d => d.StatusRaw is not ("won" or "lost"))
            .OrderBy(d => d.ProjectCode)
            .ThenBy(d => d.Title)
            .ToList();

        var options = active.Select(d => d.PickerDisplay).ToArray();
        var choices = new[] { "No project (unlink)" }.Concat(options).ToArray();

        var picked = await Shell.Current.DisplayActionSheetAsync("Link to project", "Cancel", null, choices);
        if (picked == null || picked == "Cancel") return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;

            if (picked == "No project (unlink)")
            {
                Job.DealId = null;
                LinkedProject = null;
            }
            else
            {
                var deal = active.FirstOrDefault(d => d.PickerDisplay == picked);
                Job.DealId = deal?.Id;
                LinkedProject = deal;

                // Ensure every contractor already on this job is reflected in project_contractors.
                if (deal != null)
                {
                    // Sync ALL assigned contractors to the new project, not just the legacy field
                    foreach (var jc in JobContractors)
                        await _storage.UpsertProjectContractorAsync(companyId, deal.Id, jc.ContractorId);

                    // Fallback: also sync legacy field if not already covered by the join table
                    if (Job.ContractorId.HasValue &&
                        !JobContractors.Any(jc => jc.ContractorId == Job.ContractorId.Value))
                        await _storage.UpsertProjectContractorAsync(companyId, deal.Id, Job.ContractorId.Value);
                }
            }
            await _storage.UpdateJobAsync(Job);
        });
    }

    [RelayCommand]
    private async Task DeleteJobAsync()
    {
        if (Job == null) return;
        var confirm = await Shell.Current.DisplayAlert("Delete Job", $"Delete '{Job.Title}'?", "Delete", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            await _storage.DeleteJobAsync(Job.Id);
            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task OpenThreadAsync()
    {
        if (Job == null) return;
        try
        {
            var employee = _state.CurrentEmployee;
            if (employee == null)
            {
                await Shell.Current.DisplayAlertAsync("Chat", "You must be signed in to open chat.", "OK");
                return;
            }

            var thread = await _storage.GetOrCreateJobThreadAsync(employee.CompanyId, Job.Id, employee.Id);
            await ShellNavigation.GoToAsync(
                $"HrSimpleThreadChatPage?ThreadId={thread.Id}&ThreadSubject={Uri.EscapeDataString(Job.Title)}");
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlertAsync("Chat", $"Could not open chat: {ex.Message}", "OK");
        }
    }
}
