using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrWorkTeamsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<WorkTeam> _teams = [];

    public HrWorkTeamsViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Work Teams";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var teams = await _storage.GetWorkTeamsAsync(_state.CurrentEmployee!.CompanyId);
            Teams = new ObservableCollection<WorkTeam>(teams);
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();

    [RelayCommand]
    private async Task ViewTeamAsync(WorkTeam team)
        => await ShellNavigation.GoToAsync(nameof(Views.Hr.HrWorkTeamDetailsPage),
            new Dictionary<string, object> { ["TeamId"] = team.Id.ToString() });

    [RelayCommand]
    private async Task CreateTeamAsync()
    {
        var name = await Shell.Current.DisplayPromptAsync("New Work Team", "Team name:", "Create", "Cancel", "e.g. Morning Shift Team");
        if (string.IsNullOrWhiteSpace(name)) return;

        var desc = await Shell.Current.DisplayPromptAsync("New Work Team", "Description (optional):", "Add", "Skip", "");

        await RunAsync(async () =>
        {
            var team = new WorkTeam
            {
                Name = name.Trim(),
                Description = string.IsNullOrWhiteSpace(desc) ? null : desc.Trim(),
                CompanyId = _state.CurrentEmployee!.CompanyId,
                IsActive = true
            };
            await _storage.CreateWorkTeamAsync(team);
            await LoadAsync();
        });
    }
}
