using CommunityToolkit.Mvvm.ComponentModel;

namespace KaiFlow.Timesheets.Models;

public partial class ModuleToggleItem : ObservableObject
{
    public string Key { get; init; } = "";
    public string Title { get; init; } = "";
    public string Description { get; init; } = "";

    [ObservableProperty] private bool _isEnabled;
    [ObservableProperty] private bool _isPlanEntitled = true;

    public bool CanToggle => IsPlanEntitled;
}
