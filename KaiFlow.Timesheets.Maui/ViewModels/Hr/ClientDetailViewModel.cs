using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record ClientJobRow(Job Job, string ProjectCode, string AssigneeName, string ContractorName);

[QueryProperty(nameof(ClientId), "ClientId")]
public partial class ClientDetailViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private Dictionary<Guid, ClientDeal> _projectById = new();
    private Dictionary<Guid, string> _employeeNames = new();
    private List<Job> _clientJobs = [];

    [ObservableProperty] private string _clientId = "";
    [ObservableProperty] private string _activeDetailTab = "info";
    [ObservableProperty] private Client? _client;
    [ObservableProperty] private string _companyCode = "";
    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string _selectedType = "individual";
    [ObservableProperty] private string _contactPerson = "";
    [ObservableProperty] private string _phone = "";
    [ObservableProperty] private string _email = "";
    [ObservableProperty] private string _address = "";
    [ObservableProperty] private string _notes = "";
    [ObservableProperty] private string _clientCode = "";
    [ObservableProperty] private ObservableCollection<Site> _sites = [];
    [ObservableProperty] private ObservableCollection<ClientJobRow> _jobRows = [];
    [ObservableProperty] private ObservableCollection<ClientDeal> _projects = [];
    [ObservableProperty] private ObservableCollection<ProjectRowItem> _projectRows = [];
    [ObservableProperty] private ObservableCollection<ProjectKanbanColumn> _kanbanColumns = [];
    [ObservableProperty] private string _projectsViewMode = "board";

    public bool IsInfoTab => ActiveDetailTab == "info";
    public bool IsProjectsTab => ActiveDetailTab == "projects";
    public bool IsJobsTab => ActiveDetailTab == "jobs";
    public bool IsProjectsBoard => ProjectsViewMode == "board";
    public bool IsProjectsTable => ProjectsViewMode == "table";

    public bool IsNew =>
        string.IsNullOrWhiteSpace(ClientId) ||
        ClientId.Equals("new", StringComparison.OrdinalIgnoreCase) ||
        !Guid.TryParse(ClientId, out var parsedId) ||
        parsedId == Guid.Empty;
    public bool IsExisting => !IsNew;
    public bool HasClientCode => !string.IsNullOrWhiteSpace(ClientCode);
    public bool ShowRelatedTabs => IsExisting;

    public IReadOnlyList<string> TypeOptions { get; } = ["individual", "company", "property"];

    public string PortalLoginSummary =>
        string.IsNullOrWhiteSpace(CompanyCode) || string.IsNullOrWhiteSpace(ClientCode)
            ? "Generate a client code after saving."
            : ClientCodeHelper.PortalLoginHint(CompanyCode, ClientCode);

    public ClientDetailViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Client";
    }

    partial void OnActiveDetailTabChanged(string value)
    {
        OnPropertyChanged(nameof(IsInfoTab));
        OnPropertyChanged(nameof(IsProjectsTab));
        OnPropertyChanged(nameof(IsJobsTab));
    }

    partial void OnProjectsViewModeChanged(string value)
    {
        OnPropertyChanged(nameof(IsProjectsBoard));
        OnPropertyChanged(nameof(IsProjectsTable));
    }

    [RelayCommand]
    private void SetDetailTab(string tab)
    {
        if (tab is not ("info" or "projects" or "jobs")) return;
        if ((tab is "projects" or "jobs") && IsNew)
        {
            Shell.Current.DisplayAlertAsync("Save client first", "Save client information before adding projects or jobs.", "OK");
            return;
        }
        ActiveDetailTab = tab;
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var company = await _storage.GetCurrentCompanyAsync(companyId);
            CompanyCode = company?.Code ?? "";

            var employees = await _storage.GetEmployeesAsync(companyId);
            _employeeNames = employees.ToDictionary(e => e.Id, e => e.FullName);
            if (IsNew)
            {
                Client = null;
                Name = "";
                SelectedType = "individual";
                ContactPerson = "";
                Phone = "";
                Email = "";
                Address = "";
                Notes = "";
                Sites = [];
                JobRows = [];
                Projects = [];
                ActiveDetailTab = "info";
                Title = "New Client";
                ClientCode = await _storage.GenerateNextClientCodeAsync(companyId);
                OnPropertyChanged(nameof(HasClientCode));
                OnPropertyChanged(nameof(PortalLoginSummary));
                NotifyClientModeChanged();
                return;
            }

            if (!Guid.TryParse(ClientId, out var id) || id == Guid.Empty) return;

            Client = await _storage.GetClientAsync(id);
            if (Client == null) return;

            BindClientFields();
            NotifyClientModeChanged();
            await LoadRelatedAsync(companyId, id);
        });
    }

    private void BindClientFields()
    {
        if (Client == null) return;
        Title = Client.Name;
        Name = Client.Name;
        SelectedType = Client.TypeRaw;
        ContactPerson = Client.ContactPerson ?? "";
        Phone = Client.Phone ?? "";
        Email = Client.Email ?? "";
        Address = Client.Address ?? "";
        Notes = Client.Notes ?? "";
        ClientCode = Client.ClientCode ?? "";
    }

    private async Task LoadRelatedAsync(Guid companyId, Guid clientId)
    {
        if (string.IsNullOrWhiteSpace(ClientCode))
            ClientCode = await _storage.GenerateNextClientCodeAsync(companyId);

        var sites = await _storage.GetSitesAsync(companyId, clientId);
        Sites = new ObservableCollection<Site>(sites);

        var projects = await _storage.GetClientDealsAsync(companyId, clientId);

        _clientJobs = await _storage.GetJobsAsync(companyId);
        await RefreshProjectsMetricsAsync(projects, _clientJobs);

        _projectById = projects.ToDictionary(p => p.Id);
        Projects = new ObservableCollection<ClientDeal>(projects);
        ProjectRows = new ObservableCollection<ProjectRowItem>(
            projects.Select(p => new ProjectRowItem(p, OnProjectStatusChangedAsync)));
        RebuildKanban(projects);
        var clientJobs = _clientJobs.Where(j => j.ClientId == clientId).OrderByDescending(j => j.CreatedAt).ToList();
        JobRows = new ObservableCollection<ClientJobRow>(clientJobs.Select(BuildJobRow));

        OnPropertyChanged(nameof(HasClientCode));
        OnPropertyChanged(nameof(PortalLoginSummary));
        OnPropertyChanged(nameof(Projects));
        OnPropertyChanged(nameof(JobRows));
    }

    private ClientJobRow BuildJobRow(Job job)
    {
        var projectCode = job.DealId.HasValue && _projectById.TryGetValue(job.DealId.Value, out var deal)
            ? deal.ProjectCodeDisplay
            : "—";
        var assignee = job.AssigneeEmployeeId.HasValue && _employeeNames.TryGetValue(job.AssigneeEmployeeId.Value, out var name)
            ? name
            : "—";
        var contractor = job.ContractorEmployeeId.HasValue && _employeeNames.TryGetValue(job.ContractorEmployeeId.Value, out var cname)
            ? cname
            : "—";
        return new ClientJobRow(job, projectCode, assignee, contractor);
    }

    [RelayCommand]
    private async Task GenerateClientCodeAsync()
    {
        await RunAsync(async () =>
        {
            ClientCode = await _storage.GenerateNextClientCodeAsync(_state.CurrentEmployee!.CompanyId);
            OnPropertyChanged(nameof(HasClientCode));
            OnPropertyChanged(nameof(PortalLoginSummary));
        });
    }

    [RelayCommand]
    private async Task CopyPortalCredentialsAsync()
    {
        if (string.IsNullOrWhiteSpace(ClientCode))
        {
            await Shell.Current.DisplayAlertAsync("Client code", "Save the client first or generate a client code.", "OK");
            return;
        }

        await Clipboard.Default.SetTextAsync(PortalLoginSummary);
        await Shell.Current.DisplayAlertAsync("Copied", "Portal login credentials copied to clipboard.", "OK");
    }

    [RelayCommand]
    private async Task RotateClientCodeAsync()
    {
        if (Client == null || Client.Id == Guid.Empty) return;

        var confirmed = await Shell.Current.DisplayAlert(
            "Rotate portal code",
            "The current code will stop working immediately. Display the new code to the client before navigating away. Continue?",
            "Rotate", "Cancel");
        if (!confirmed) return;

        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var newCode = await _storage.HrRotateClientCodeAsync(companyId, Client.Id);
            ClientCode = newCode;
            OnPropertyChanged(nameof(HasClientCode));
            OnPropertyChanged(nameof(PortalLoginSummary));
            await Shell.Current.DisplayAlert(
                "New portal code",
                $"New code: {newCode}\n\nShare this with the client. The old code no longer works.",
                "OK");
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(Name))
        {
            await Shell.Current.DisplayAlertAsync("Required", "Client name is required.", "OK");
            return;
        }

        if (_state.CurrentEmployee == null)
        {
            await Shell.Current.DisplayAlertAsync("Session", "You are not signed in. Open HR dashboard and try again.", "OK");
            return;
        }

        if (IsBusy) return;

        IsBusy = true;
        ErrorMessage = null;
        try
        {
            var companyId = _state.CurrentEmployee.CompanyId;

            if (IsNew)
            {
                var created = await _storage.CreateClientAsync(new Client
                {
                    CompanyId = companyId,
                    Name = Name.Trim(),
                    TypeRaw = SelectedType,
                    ContactPerson = NullIfEmpty(ContactPerson),
                    Phone = NullIfEmpty(Phone),
                    Email = NullIfEmpty(Email),
                    Address = NullIfEmpty(Address),
                    Notes = NullIfEmpty(Notes),
                    ClientCode = string.IsNullOrWhiteSpace(ClientCode)
                        ? await _storage.GenerateNextClientCodeAsync(companyId)
                        : ClientCode.Trim().ToUpperInvariant()
                });
                ClientId = created.Id.ToString();
                Client = created;
                ClientCode = created.ClientCode ?? ClientCode;
                Title = created.Name;
                NotifyClientModeChanged();
                await Shell.Current.DisplayAlertAsync("Saved", "Client created. You can now add projects and jobs.", "OK");
                ActiveDetailTab = "projects";
                await LoadAsync();
            }
            else
            {
                if (Client == null && Guid.TryParse(ClientId, out var existingId))
                    Client = await _storage.GetClientAsync(existingId);

                if (Client == null)
                {
                    ErrorMessage = "Client record could not be loaded.";
                    await Shell.Current.DisplayAlertAsync("Save failed", ErrorMessage, "OK");
                    return;
                }

                Client.Name = Name.Trim();
                Client.TypeRaw = SelectedType;
                Client.ContactPerson = NullIfEmpty(ContactPerson);
                Client.Phone = NullIfEmpty(Phone);
                Client.Email = NullIfEmpty(Email);
                Client.Address = NullIfEmpty(Address);
                Client.Notes = NullIfEmpty(Notes);
                Client.ClientCode = string.IsNullOrWhiteSpace(ClientCode)
                    ? Client.ClientCode
                    : ClientCode.Trim().ToUpperInvariant();
                Client = await _storage.UpdateClientAsync(Client);
                ClientCode = Client.ClientCode ?? ClientCode;
                Title = Client.Name;
                await Shell.Current.DisplayAlertAsync("Saved", "Client information updated.", "OK");
            }

            OnPropertyChanged(nameof(HasClientCode));
            OnPropertyChanged(nameof(PortalLoginSummary));
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            await Shell.Current.DisplayAlertAsync("Could not save", ex.Message, "OK");
        }
        finally
        {
            IsBusy = false;
        }
    }

    private void NotifyClientModeChanged()
    {
        OnPropertyChanged(nameof(IsNew));
        OnPropertyChanged(nameof(IsExisting));
        OnPropertyChanged(nameof(ShowRelatedTabs));
    }

    [RelayCommand]
    private async Task AddSiteAsync()
    {
        if (!Guid.TryParse(ClientId, out var clientGuid)) return;
        var siteName = await Shell.Current.DisplayPromptAsync("New Site", "Site name:", "Create", "Cancel", "");
        if (string.IsNullOrWhiteSpace(siteName)) return;
        var siteAddress = await Shell.Current.DisplayPromptAsync("New Site", "Address (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            await _storage.CreateSiteAsync(new Site
            {
                Name = siteName.Trim(),
                Address = NullIfEmpty(siteAddress),
                ClientId = clientGuid,
                CompanyId = _state.CurrentEmployee!.CompanyId
            });
            Sites = new ObservableCollection<Site>(
                await _storage.GetSitesAsync(_state.CurrentEmployee!.CompanyId, clientGuid));
        });
    }

    [RelayCommand]
    private async Task AddProjectAsync()
    {
        if (!Guid.TryParse(ClientId, out var clientGuid)) return;
        await ShellNavigation.GoToAsync(nameof(HrProjectDetailPage),
            new Dictionary<string, object> { ["ClientId"] = clientGuid.ToString() });
    }

    [RelayCommand]
    private async Task OpenProjectAsync(ClientDeal deal)
        => await ShellNavigation.GoToAsync(nameof(HrProjectDetailPage),
            new Dictionary<string, object> { ["DealId"] = deal.Id.ToString() });

    [RelayCommand]
    private async Task OpenJobAsync(ClientJobRow row)
        => await ShellNavigation.GoToAsync($"{nameof(HrJobDetailsPage)}?JobId={row.Job.Id}");

    [RelayCommand]
    private async Task AddJobAsync()
    {
        if (!Guid.TryParse(ClientId, out var clientGuid)) return;
        await ShellNavigation.GoToAsync(nameof(HrCreateJobPage),
            new Dictionary<string, object> { ["ClientId"] = clientGuid.ToString() });
    }

    [RelayCommand]
    private void SetProjectsViewMode(string mode)
    {
        if (mode is "table" or "board") ProjectsViewMode = mode;
    }

    [RelayCommand]
    private async Task AdvanceProjectStageAsync(ClientDeal deal)
    {
        if (deal == null) return;
        var next = ProjectPipeline.NextStage(deal.StatusRaw);
        if (next == null)
        {
            await Shell.Current.DisplayAlertAsync("Pipeline", "This project is already at the last active stage (use Won or Lost on the project screen).", "OK");
            return;
        }
        await MoveProjectCoreAsync(deal, next);
    }

    [RelayCommand]
    private async Task UploadProjectDocumentAsync(ClientDeal deal)
    {
        if (deal == null) return;

        var pick = await ProjectDocumentTypes.PickAsync("Attach file to this project");
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

        await RunAsync(async () =>
        {
            await _storage.UploadProjectDocumentAsync(
                deal.CompanyId, deal.Id, pick, typeKey, name.Trim());
            await Shell.Current.DisplayAlertAsync("Uploaded", "Document attached to project.", "OK");
        });
    }

    [RelayCommand]
    private async Task MoveProjectToStageAsync(MoveProjectRequest request)
    {
        if (request?.Deal == null || string.IsNullOrWhiteSpace(request.TargetStage)) return;
        await MoveProjectCoreAsync(request.Deal, request.TargetStage);
    }

    private async Task MoveProjectCoreAsync(ClientDeal deal, string stageValue)
    {
        if (deal.StatusRaw == stageValue) return;

        await RunAsync(async () =>
        {
            var from = deal.StatusRaw;
            deal.StatusRaw = stageValue;
            deal = await _storage.UpdateClientDealAsync(deal);

            await _storage.AddClientDealUpdateAsync(new ClientDealUpdate
            {
                CompanyId = deal.CompanyId,
                DealId = deal.Id,
                Body = $"Moved to {ProjectPipeline.LabelFor(stageValue)}.",
                StatusFrom = from,
                StatusTo = stageValue
            });

            _projectById[deal.Id] = deal;
            var list = Projects.ToList();
            var idx = list.FindIndex(p => p.Id == deal.Id);
            if (idx >= 0) list[idx] = deal;
            await RefreshProjectsMetricsAsync(list, _clientJobs);
            Projects = new ObservableCollection<ClientDeal>(list);
            ProjectRows = new ObservableCollection<ProjectRowItem>(
                list.Select(p => new ProjectRowItem(p, OnProjectStatusChangedAsync)));
            RebuildKanban(list);
        });
    }

    private async Task RefreshProjectsMetricsAsync(List<ClientDeal> projects, List<Job> jobs)
    {
        var jobCountByDeal = jobs
            .Where(j => j.DealId.HasValue)
            .GroupBy(j => j.DealId!.Value)
            .ToDictionary(g => g.Key, g => g.Count());

        foreach (var p in projects)
        {
            p.JobCount = jobCountByDeal.GetValueOrDefault(p.Id, 0);
            var payments = await _storage.GetProjectClientPaymentsAsync(p.Id);
            p.AmountPaid = payments.Sum(x => x.Amount);
            p.ProgressPercent = ProjectProgressHelper.ComputePercent(p, jobs);
        }
    }

    private async Task OnProjectStatusChangedAsync(ProjectRowItem row, string stageValue)
    {
        await MoveProjectCoreAsync(row.Deal, stageValue);
        row.RefreshFromDeal();
    }

    [RelayCommand]
    private async Task AddClientPaymentAsync(ProjectRowItem? row)
    {
        if (row?.Deal == null) return;
        await AddClientPaymentCoreAsync(row.Deal, () => row.RefreshFromDeal());
    }

    private async Task AddClientPaymentCoreAsync(ClientDeal deal, Action? onDone = null)
    {
        var amountStr = await Shell.Current.DisplayPromptAsync(
            "Client payment", $"Amount for '{deal.Title}' (R):", "Next", "Cancel", keyboard: Keyboard.Numeric);
        if (string.IsNullOrWhiteSpace(amountStr) || !double.TryParse(amountStr, out var amount) || amount <= 0)
            return;

        await RunAsync(async () =>
        {
            await _storage.AddProjectClientPaymentAsync(new ProjectClientPayment
            {
                CompanyId = deal.CompanyId,
                DealId = deal.Id,
                Amount = amount,
                PaidAt = DateTime.UtcNow
            });
            var updated = await _storage.SyncClientDealFinancialsAsync(deal.Id);

            var list = Projects.ToList();
            var idx = list.FindIndex(p => p.Id == deal.Id);
            if (idx >= 0) list[idx] = updated;
            Projects = new ObservableCollection<ClientDeal>(list);
            ProjectRows = new ObservableCollection<ProjectRowItem>(
                list.Select(p => new ProjectRowItem(p, OnProjectStatusChangedAsync)));
            RebuildKanban(list);
            onDone?.Invoke();
        });
    }

    [RelayCommand]
    private async Task CreateJobFromProjectAsync(ClientDeal deal)
    {
        if (deal == null) return;

        var args = new Dictionary<string, object> { ["DealId"] = deal.Id.ToString() };
        if (deal.HasClient && deal.ClientId.HasValue)
            args["ClientId"] = deal.ClientId.Value.ToString();
        await ShellNavigation.GoToAsync(nameof(HrCreateJobPage), args);
    }

    private void RebuildKanban(IEnumerable<ClientDeal> projects)
    {
        var cols = ProjectPipeline.Stages
            .Select(s => new ProjectKanbanColumn(s))
            .ToList();

        foreach (var deal in projects)
        {
            var col = cols.FirstOrDefault(c => c.StageValue == deal.StatusRaw) ?? cols[0];
            col.Cards.Add(deal);
        }

        KanbanColumns = new ObservableCollection<ProjectKanbanColumn>(cols);
    }

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
