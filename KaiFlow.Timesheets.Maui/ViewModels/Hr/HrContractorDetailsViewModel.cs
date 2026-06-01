using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record ContractorMemberDisplay(ContractorMemberLink Link, string EmployeeName);

[QueryProperty(nameof(ContractorId), "ContractorId")]
[QueryProperty(nameof(PartnerKind), "PartnerKind")]
public partial class HrContractorDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _contractorId = "";
    [ObservableProperty] private string _partnerKind = PartnerKinds.Contractor;
    [ObservableProperty] private Contractor? _contractor;
    [ObservableProperty] private ObservableCollection<ContractorMemberDisplay> _members = [];
    [ObservableProperty] private string _selectedPartnerKindLabel = "Contractor";

    private List<Employee> _allEmployees = [];

    public bool IsNew =>
        string.IsNullOrWhiteSpace(ContractorId) ||
        ContractorId.Equals("new", StringComparison.OrdinalIgnoreCase) ||
        !Guid.TryParse(ContractorId, out var id) ||
        id == Guid.Empty;

    public bool IsSupplierMode =>
        PartnerKinds.IsSupplierKind(PartnerKind) && !PartnerKinds.IsContractorKind(PartnerKind);

    public bool ShowMembersSection =>
        !IsNew && PartnerKinds.IsContractorKind(Contractor?.PartnerKindRaw ?? PartnerKind);

    public bool ShowPortalCodeSection =>
        Contractor != null && PartnerKinds.IsContractorKind(Contractor.PartnerKindRaw);
    public IReadOnlyList<string> PartnerKindLabels => PartnerKinds.KindLabels;

    public HrContractorDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Partner";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            _allEmployees = (await _storage.GetEmployeesAsync(companyId)).Where(e => e.IsActive).ToList();

            if (IsNew)
            {
                Contractor = new Contractor
                {
                    CompanyId = companyId,
                    PartnerKindRaw = string.IsNullOrWhiteSpace(PartnerKind) ? PartnerKinds.Contractor : PartnerKind,
                    IsActive = true,
                    CreatedAt = DateTime.UtcNow
                };
                SelectedPartnerKindLabel = PartnerKinds.LabelFor(Contractor.PartnerKindRaw);
                Title = IsSupplierMode ? "New Supplier" : "New Contractor";
                Members = [];
                return;
            }

            if (!Guid.TryParse(ContractorId, out var cid)) return;
            Contractor = await _storage.GetContractorsAsync(companyId) is var list
                ? list.FirstOrDefault(c => c.Id == cid)
                : null;
            if (Contractor == null) return;

            PartnerKind = Contractor.PartnerKindRaw;
            SelectedPartnerKindLabel = PartnerKinds.LabelFor(Contractor.PartnerKindRaw);
            Title = Contractor.Name;
            if (ShowPortalCodeSection && string.IsNullOrWhiteSpace(Contractor.ContractorCode))
                Contractor.ContractorCode = await _storage.GenerateNextContractorCodeAsync(companyId);

            var nameMap = _allEmployees.ToDictionary(e => e.Id, e => e.FullName);
            var links = await _storage.GetContractorMemberLinksAsync(Contractor.Id);
            Members = new ObservableCollection<ContractorMemberDisplay>(
                links.Select(l => new ContractorMemberDisplay(l, nameMap.GetValueOrDefault(l.EmployeeId, "Unknown"))));
        });
    }

    partial void OnSelectedPartnerKindLabelChanged(string value)
    {
        if (Contractor == null) return;
        var idx = Array.IndexOf(PartnerKinds.KindLabels, value);
        if (idx < 0) idx = 0;
        Contractor.PartnerKindRaw = PartnerKinds.All[idx];
        PartnerKind = Contractor.PartnerKindRaw;
        OnPropertyChanged(nameof(IsSupplierMode));
        OnPropertyChanged(nameof(ShowMembersSection));
        Title = IsSupplierMode ? (IsNew ? "New Supplier" : Contractor?.Name ?? "Supplier")
            : (IsNew ? "New Contractor" : Contractor?.Name ?? "Contractor");
    }

    [RelayCommand]
    private async Task GenerateContractorCodeAsync()
    {
        if (Contractor == null) return;
        await RunAsync(async () =>
        {
            Contractor.ContractorCode = await _storage.GenerateNextContractorCodeAsync(_state.CurrentEmployee!.CompanyId);
            OnPropertyChanged(nameof(Contractor));
        });
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (Contractor == null || string.IsNullOrWhiteSpace(Contractor.Name))
        {
            await Shell.Current.DisplayAlertAsync("Required", "Company / partner name is required.", "OK");
            return;
        }

        await RunAsync(async () =>
        {
            if (IsNew)
            {
                Contractor.CreatedAt = DateTime.UtcNow;
                Contractor = await _storage.CreateContractorAsync(Contractor);
            }
            else
                Contractor = await _storage.UpdateContractorAsync(Contractor);

            await ShellNavigation.GoToAsync("..");
        });
    }

    [RelayCommand]
    private async Task AddMemberAsync()
    {
        if (Contractor == null || IsNew || _allEmployees.Count == 0) return;

        var names = _allEmployees.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheetAsync("Add member", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var employee = _allEmployees.FirstOrDefault(e => e.FullName == chosen);
        if (employee == null) return;

        var role = await Shell.Current.DisplayPromptAsync("Role", "Role (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            var link = new ContractorMemberLink
            {
                ContractorId = Contractor!.Id,
                EmployeeId = employee.Id,
                Role = string.IsNullOrWhiteSpace(role) ? null : role.Trim(),
                CompanyId = _state.CurrentEmployee!.CompanyId
            };
            await _storage.CreateContractorMemberLinkAsync(link);
            Members.Add(new ContractorMemberDisplay(link, employee.FullName));
        });
    }

    [RelayCommand]
    private async Task InviteMemberAsync()
    {
        var email = await Shell.Current.DisplayPromptAsync("Invite member", "Email:", "Send", "Cancel", "", keyboard: Keyboard.Email);
        if (string.IsNullOrWhiteSpace(email)) return;

        await RunAsync(async () =>
        {
            await _storage.SendOtpAsync(email.Trim());
            await Shell.Current.DisplayAlertAsync("Invited", $"Login link sent to {email.Trim()}.", "OK");
        });
    }
}
