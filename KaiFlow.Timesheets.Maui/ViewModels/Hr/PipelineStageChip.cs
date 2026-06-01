using CommunityToolkit.Mvvm.ComponentModel;
using KaiFlow.Timesheets.Helpers;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class PipelineStageChip : ObservableObject
{
    public PipelineStageOption Stage { get; }

    [ObservableProperty] private bool _isSelected;

    public string Label => Stage.Label;

    public PipelineStageChip(PipelineStageOption stage) => Stage = stage;
}
