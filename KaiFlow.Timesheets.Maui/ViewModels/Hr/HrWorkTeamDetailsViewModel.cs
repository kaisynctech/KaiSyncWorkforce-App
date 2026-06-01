using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record TeamMemberDisplay(Guid EmployeeId, string FullName, string? Branch, bool IsLeader);

[QueryProperty(nameof(TeamId), "TeamId")]
public partial class HrWorkTeamDetailsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _teamId = "";
    [ObservableProperty] private WorkTeam? _team;
    [ObservableProperty] private ObservableCollection<TeamMemberDisplay> _members = [];
    [ObservableProperty] private string _name = "";
    [ObservableProperty] private string _description = "";

    private List<Employee> _allEmployees = [];

    public HrWorkTeamDetailsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Team Details";
    }

    public async Task LoadAsync()
    {
        if (string.IsNullOrEmpty(TeamId)) return;
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            var teams = await _storage.GetWorkTeamsAsync(companyId);
            Team = teams.FirstOrDefault(t => t.Id.ToString() == TeamId);
            if (Team == null) return;

            Title = Team.Name;
            Name = Team.Name;
            Description = Team.Description ?? "";

            _allEmployees = await _storage.GetEmployeesAsync(companyId);
            RefreshMembers();
        });
    }

    public bool HasMixedBranches =>
        Members.Select(m => m.Branch ?? "").Where(b => b.Length > 0)
               .Distinct(StringComparer.OrdinalIgnoreCase).Count() > 1;

    public string BranchSummary =>
        string.Join(", ",
            Members.Select(m => m.Branch ?? "").Where(b => b.Length > 0)
                   .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(b => b));

    private void RefreshMembers()
    {
        if (Team == null) return;
        var empMap = _allEmployees.ToDictionary(e => e.Id);
        Members = new ObservableCollection<TeamMemberDisplay>(
            Team.MemberIds
                .Select(id =>
                {
                    empMap.TryGetValue(id, out var emp);
                    return new TeamMemberDisplay(id, emp?.FullName ?? id.ToString()[..8], emp?.Branch, id == Team.LeaderEmployeeId);
                })
                .OrderByDescending(m => m.IsLeader)
                .ThenBy(m => m.FullName));
        OnPropertyChanged(nameof(HasMixedBranches));
        OnPropertyChanged(nameof(BranchSummary));
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (Team == null) return;
        if (string.IsNullOrWhiteSpace(Name))
        {
            ErrorMessage = "Team name is required.";
            return;
        }
        await RunAsync(async () =>
        {
            Team.Name = Name.Trim();
            Team.Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim();
            await _storage.UpdateWorkTeamAsync(Team);
            Title = Team.Name;
            await Shell.Current.DisplayAlert("Saved", "Team updated.", "OK");
        });
    }

    [RelayCommand]
    private async Task AddMemberAsync()
    {
        if (Team == null || _allEmployees.Count == 0) return;

        var available = _allEmployees
            .Where(e => !Team.MemberIds.Contains(e.Id))
            .ToList();

        if (available.Count == 0)
        {
            await Shell.Current.DisplayAlert("No Employees", "All employees are already members.", "OK");
            return;
        }

        var names = available.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheet("Add Member", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var employee = available.FirstOrDefault(e => e.FullName == chosen);
        if (employee == null) return;

        var hrBranch = _state.CurrentEmployee?.Branch;
        if (!string.IsNullOrEmpty(hrBranch) && !string.IsNullOrEmpty(employee.Branch)
            && !hrBranch.Equals(employee.Branch, StringComparison.OrdinalIgnoreCase))
        {
            var proceed = await Shell.Current.DisplayAlert(
                "Different Branch",
                $"You are from \"{hrBranch}\" but {employee.FullName} is from \"{employee.Branch}\". Add them to this team anyway?",
                "Yes, Add", "Cancel");
            if (!proceed) return;
        }

        await RunAsync(async () =>
        {
            Team.MemberIds.Add(employee.Id);
            await _storage.UpdateWorkTeamAsync(Team);
            RefreshMembers();
        });
    }

    [RelayCommand]
    private async Task RemoveMemberAsync(TeamMemberDisplay member)
    {
        if (Team == null) return;
        var confirm = await Shell.Current.DisplayAlert(
            "Remove Member", $"Remove {member.FullName} from this team?", "Remove", "Cancel");
        if (!confirm) return;

        await RunAsync(async () =>
        {
            Team.MemberIds.Remove(member.EmployeeId);
            if (Team.LeaderEmployeeId == member.EmployeeId)
                Team.LeaderEmployeeId = null;
            await _storage.UpdateWorkTeamAsync(Team);
            RefreshMembers();
        });
    }

    [RelayCommand]
    private async Task SetLeaderAsync(TeamMemberDisplay member)
    {
        if (Team == null) return;
        await RunAsync(async () =>
        {
            Team.LeaderEmployeeId = Team.LeaderEmployeeId == member.EmployeeId ? null : member.EmployeeId;
            await _storage.UpdateWorkTeamAsync(Team);
            RefreshMembers();
        });
    }
}
