using CommunityToolkit.Mvvm.ComponentModel;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.ViewModels.Hr;

/// <summary>Project row for tables with inline status picker.</summary>
public partial class ProjectRowItem : ObservableObject
{
    private readonly Func<ProjectRowItem, string, Task>? _onStatusChanged;

    public ClientDeal Deal { get; private set; }
    public string? ClientName { get; init; }
    public string? ManagerName { get; init; }

    public IReadOnlyList<string> StatusOptions { get; } =
        ProjectPipeline.Stages.Select(s => s.Label).ToList();

    public string ProjectCodeDisplay => Deal.ProjectCodeDisplay;
    public string Title => Deal.Title;
    public string OfferDisplay => Deal.OfferDisplay;
    public string PaidDisplay => Deal.PaidDisplay;
    public string BalanceDisplay => Deal.BalanceDisplay;
    public string ProgressDisplay => Deal.ProgressDisplay;
    public string JobCountLabel => Deal.JobCountLabel;
    public int JobCount => Deal.JobCount;

    [ObservableProperty] private string _selectedStatusLabel;

    public ProjectRowItem(ClientDeal deal, Func<ProjectRowItem, string, Task>? onStatusChanged = null,
        string? clientName = null, string? managerName = null)
    {
        Deal = deal;
        _onStatusChanged = onStatusChanged;
        ClientName = clientName;
        ManagerName = managerName;
        _selectedStatusLabel = ProjectPipeline.LabelFor(deal.StatusRaw);
    }

    public void ReplaceDeal(ClientDeal deal)
    {
        Deal = deal;
        RefreshFromDeal();
    }

    public void RefreshFromDeal()
    {
        SelectedStatusLabel = ProjectPipeline.LabelFor(Deal.StatusRaw);
        OnPropertyChanged(nameof(OfferDisplay));
        OnPropertyChanged(nameof(PaidDisplay));
        OnPropertyChanged(nameof(BalanceDisplay));
        OnPropertyChanged(nameof(ProgressDisplay));
        OnPropertyChanged(nameof(JobCountLabel));
    }

    partial void OnSelectedStatusLabelChanged(string value)
    {
        var stage = ProjectPipeline.Stages.FirstOrDefault(s => s.Label == value);
        if (stage == null || stage.Value == Deal.StatusRaw) return;
        if (_onStatusChanged != null)
            _ = _onStatusChanged(this, stage.Value);
    }
}
