using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class SelectableEmployee : ObservableObject
{
    [ObservableProperty] private bool _isSelected;
    public Employee Employee { get; }
    public SelectableEmployee(Employee employee) => Employee = employee;
}

[QueryProperty(nameof(ClientId), "ClientId")]
[QueryProperty(nameof(DealId), "DealId")]
public partial class HrCreateJobViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _clientId = "";
    [ObservableProperty] private string _dealId = "";
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _description = "";
    [ObservableProperty] private string _priority = "medium";
    [ObservableProperty] private double _estimatedCost;
    [ObservableProperty] private DateTime _scheduledStartDate = DateTime.Today;
    [ObservableProperty] private TimeSpan _scheduledStartTime = new(8, 0, 0);
    [ObservableProperty] private DateTime _scheduledEndDate = DateTime.Today;
    [ObservableProperty] private TimeSpan _scheduledEndTime = new(17, 0, 0);
    [ObservableProperty] private ObservableCollection<Client> _clients = [];
    [ObservableProperty] private Client? _selectedClient;
    [ObservableProperty] private ObservableCollection<Site> _sites = [];
    [ObservableProperty] private Site? _selectedSite;
    [ObservableProperty] private ObservableCollection<SelectableEmployee> _selectableEmployees = [];
    [ObservableProperty] private ObservableCollection<Contractor> _contractors = [];
    [ObservableProperty] private Contractor? _selectedContractor;
    [ObservableProperty] private string _contractorCostText = "0";
    [ObservableProperty] private ClientDeal? _linkedProject;
    [ObservableProperty] private ObservableCollection<ClientDeal> _projects = [];
    [ObservableProperty] private ClientDeal? _selectedProject;

    public bool HasLinkedProject => LinkedProject != null;
    public bool ClientLocked => Guid.TryParse(ClientId, out _);
    // True when the form was opened via a project's "Add job" button — project cannot be changed.
    public bool ProjectLocked => Guid.TryParse(DealId, out var id) && id != Guid.Empty;

    public List<string> Priorities { get; } = ["none", "low", "medium", "high", "critical"];

    public HrCreateJobViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "New Job";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var clients = await _storage.GetClientsAsync(companyId);
            Clients = new ObservableCollection<Client>(clients);
            var employees = await _storage.GetEmployeesAsync(companyId);
            SelectableEmployees = new ObservableCollection<SelectableEmployee>(
                employees.Where(e => e.IsActive).Select(e => new SelectableEmployee(e)));
            Contractors = new ObservableCollection<Contractor>(
                (await _storage.GetContractorsAsync(companyId)).Where(c => c.IsActive).OrderBy(c => c.Name));

            // Load active projects for the optional project picker.
            var allDeals = await _storage.GetClientDealsAsync(companyId);
            // Enrich deals with client names so PickerDisplay shows "PRJ-001 — Title — Client".
            var clientById = clients.ToDictionary(c => c.Id);
            foreach (var d in allDeals)
                if (d.ClientId.HasValue && clientById.TryGetValue(d.ClientId.Value, out var cl))
                    d.ClientName = cl.Name;
            var activeProjects = allDeals
                .Where(d => d.StatusRaw is not ("won" or "lost"))
                .OrderBy(d => d.ProjectCode)
                .ThenBy(d => d.Title)
                .ToList();
            Projects = new ObservableCollection<ClientDeal>(activeProjects);

            if (Guid.TryParse(ClientId, out var presetClientId))
                SelectedClient = clients.FirstOrDefault(c => c.Id == presetClientId);

            if (Guid.TryParse(DealId, out var dealId) && dealId != Guid.Empty)
            {
                // Navigated from a project — lock in that project and pre-fill fields.
                LinkedProject = allDeals.FirstOrDefault(d => d.Id == dealId)
                    ?? await _storage.GetClientDealAsync(dealId);
                if (LinkedProject != null)
                {
                    SelectedProject = LinkedProject;
                    Title = LinkedProject.Title;
                    if (LinkedProject.ClientId.HasValue)
                        SelectedClient = clients.FirstOrDefault(c => c.Id == LinkedProject.ClientId.Value);
                    Description = $"Project: {LinkedProject.ProjectCodeDisplay}";
                    OnPropertyChanged(nameof(HasLinkedProject));
                    OnPropertyChanged(nameof(ProjectLocked));
                }
            }
        });
    }

    partial void OnSelectedProjectChanged(ClientDeal? value)
    {
        LinkedProject = value;
        OnPropertyChanged(nameof(HasLinkedProject));
        // Pre-fill client when the user picks a project that has one.
        if (value?.ClientId.HasValue == true && SelectedClient == null)
        {
            var match = Clients.FirstOrDefault(c => c.Id == value.ClientId!.Value);
            if (match != null) SelectedClient = match;
        }
    }

    [RelayCommand]
    private void ClearProject()
    {
        SelectedProject = null;
    }

    partial void OnSelectedClientChanged(Client? value)
    {
        if (value == null) return;
        _ = LoadSitesAsync(value.Id);
    }

    private async Task LoadSitesAsync(Guid clientId)
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        var sites = await _storage.GetSitesAsync(companyId, clientId);
        Sites = new ObservableCollection<Site>(sites);
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

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (string.IsNullOrWhiteSpace(Title))
        {
            ErrorMessage = "Job title is required.";
            return;
        }

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var selectedEmpIds = SelectableEmployees
                .Where(se => se.IsSelected)
                .Select(se => se.Employee.Id)
                .ToList();

            var scheduledStart = ScheduledStartDate.Date + ScheduledStartTime;
            var scheduledEnd = ScheduledEndDate.Date + ScheduledEndTime;
            double.TryParse(ContractorCostText, out var contractorCost);

            var job = new Job
            {
                Title = Title.Trim(),
                Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim(),
                PriorityRaw = Priority,
                ClientId = SelectedClient?.Id,
                SiteId = SelectedSite?.Id,
                DealId = LinkedProject?.Id,
                EstimatedCost = EstimatedCost,
                ScheduledStart = scheduledStart.ToUniversalTime(),
                ScheduledEnd = scheduledEnd.ToUniversalTime(),
                AssigneeEmployeeId = selectedEmpIds.FirstOrDefault() == Guid.Empty ? null : selectedEmpIds.FirstOrDefault(),
                AssignedEmployeeIds = selectedEmpIds,
                ContractorId = SelectedContractor?.Id,
                ContractorCost = contractorCost,
                StatusRaw = "scheduled",
                OpenedAt = DateTime.UtcNow,
                CompanyId = employee.CompanyId
            };

            var created = await _storage.CreateJobAsync(job);
            if (LinkedProject != null)
                await _storage.LinkClientDealToJobAsync(LinkedProject.Id, created.Id);

            if (SelectedContractor != null)
            {
                await _storage.UpsertJobContractorAsync(
                    created.CompanyId, created.Id, SelectedContractor.Id,
                    agreedAmount: (decimal)contractorCost);
                if (LinkedProject != null)
                    await _storage.UpsertProjectContractorAsync(
                        created.CompanyId, LinkedProject.Id, SelectedContractor.Id);
            }

            await ShellNavigation.GoToAsync("..");
        });
    }
}
