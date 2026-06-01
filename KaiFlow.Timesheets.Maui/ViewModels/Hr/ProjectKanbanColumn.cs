using System.Collections.ObjectModel;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public class ProjectKanbanColumn
{
    public PipelineStageOption Stage { get; }
    public ObservableCollection<ClientDeal> Cards { get; } = [];

    public string Title => Stage.Label;
    public string Hint => Stage.ColumnHint;
    public string StageValue => Stage.Value;
    public int Count => Cards.Count;

    public ProjectKanbanColumn(PipelineStageOption stage) => Stage = stage;
}
