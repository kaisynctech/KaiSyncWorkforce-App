using System.Windows.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr.Controls;

public partial class ProjectKanbanCardView : Border
{
    public static readonly BindableProperty AccentColorProperty =
        BindableProperty.Create(nameof(AccentColor), typeof(Color), typeof(ProjectKanbanCardView), Colors.Gray);

    public static readonly BindableProperty OpenProjectCommandProperty =
        BindableProperty.Create(nameof(OpenProjectCommand), typeof(ICommand), typeof(ProjectKanbanCardView));

    public static readonly BindableProperty CreateJobCommandProperty =
        BindableProperty.Create(nameof(CreateJobCommand), typeof(ICommand), typeof(ProjectKanbanCardView));

    public static readonly BindableProperty AdvanceStageCommandProperty =
        BindableProperty.Create(nameof(AdvanceStageCommand), typeof(ICommand), typeof(ProjectKanbanCardView));

    public static readonly BindableProperty MoveStageCommandProperty =
        BindableProperty.Create(nameof(MoveStageCommand), typeof(ICommand), typeof(ProjectKanbanCardView));

    public static readonly BindableProperty UploadDocumentCommandProperty =
        BindableProperty.Create(nameof(UploadDocumentCommand), typeof(ICommand), typeof(ProjectKanbanCardView));

    public Color AccentColor
    {
        get => (Color)GetValue(AccentColorProperty);
        set => SetValue(AccentColorProperty, value);
    }

    public ICommand? OpenProjectCommand
    {
        get => (ICommand?)GetValue(OpenProjectCommandProperty);
        set => SetValue(OpenProjectCommandProperty, value);
    }

    public ICommand? CreateJobCommand
    {
        get => (ICommand?)GetValue(CreateJobCommandProperty);
        set => SetValue(CreateJobCommandProperty, value);
    }

    public ICommand? AdvanceStageCommand
    {
        get => (ICommand?)GetValue(AdvanceStageCommandProperty);
        set => SetValue(AdvanceStageCommandProperty, value);
    }

    public ICommand? MoveStageCommand
    {
        get => (ICommand?)GetValue(MoveStageCommandProperty);
        set => SetValue(MoveStageCommandProperty, value);
    }

    public ICommand? UploadDocumentCommand
    {
        get => (ICommand?)GetValue(UploadDocumentCommandProperty);
        set => SetValue(UploadDocumentCommandProperty, value);
    }

    public bool ShowCreateJob => BindingContext is ClientDeal;

    public string JobBadgeText => (BindingContext as ClientDeal)?.JobCountLabel ?? "No jobs";

    public Color JobBadgeForeground => (BindingContext as ClientDeal)?.JobCount > 0
        ? Color.FromArgb("#6EE7B7") : Color.FromArgb("#94A3B8");

    public double ProgressFraction
    {
        get
        {
            if (BindingContext is ClientDeal d)
                return Math.Clamp(d.ProgressPercent, 0, 100) / 100.0;
            return 0;
        }
    }

    public ProjectKanbanCardView()
    {
        InitializeComponent();
        BindingContextChanged += (_, _) =>
        {
            if (BindingContext is ClientDeal deal)
                AccentColor = Color.FromArgb(ProjectPipeline.StageAccentColor(deal.StatusRaw));
            OnPropertyChanged(nameof(JobBadgeText));
            OnPropertyChanged(nameof(JobBadgeForeground));
            OnPropertyChanged(nameof(ShowCreateJob));
            OnPropertyChanged(nameof(ProgressFraction));
        };
    }

    private void OnDragStarting(object? sender, DragStartingEventArgs e)
    {
        if (BindingContext is not ClientDeal deal) return;

        DraggedProjectRegistry.Register(deal);
        e.Data.Properties[DraggedProjectRegistry.PropertyKey] = deal.Id.ToString();
        e.Data.Text = deal.Title;
    }

    private async void OnMoveHandleTapped(object? sender, TappedEventArgs e)
    {
        if (BindingContext is not ClientDeal deal) return;

        var options = ProjectPipeline.Stages.Select(s => s.Label).ToArray();
        var pick = await Shell.Current.DisplayActionSheetAsync(
            $"Move “{deal.Title}” to", "Cancel", null, options);
        if (pick == null || pick == "Cancel") return;

        var stage = ProjectPipeline.Stages.FirstOrDefault(s => s.Label == pick);
        if (stage == null || stage.Value == deal.StatusRaw) return;

        var request = new MoveProjectRequest(deal, stage.Value);
        if (MoveStageCommand?.CanExecute(request) == true)
            MoveStageCommand.Execute(request);
    }

    private void OnCardTapped(object? sender, TappedEventArgs e)
    {
        if (BindingContext is ClientDeal deal)
            OpenProjectCommand?.Execute(deal);
    }

    private void OnCreateJobClicked(object? sender, EventArgs e)
    {
        if (BindingContext is ClientDeal deal)
            CreateJobCommand?.Execute(deal);
    }

    private void OnAdvanceClicked(object? sender, EventArgs e)
    {
        if (BindingContext is ClientDeal deal)
            AdvanceStageCommand?.Execute(deal);
    }

    private void OnUploadDocClicked(object? sender, EventArgs e)
    {
        if (BindingContext is ClientDeal deal)
            UploadDocumentCommand?.Execute(deal);
    }
}

/// <summary>Drag payload registry (Windows often drops DataPackage properties).</summary>
public static class DraggedProjectRegistry
{
    public const string PropertyKey = "KaiFlow.ProjectId";

    private static readonly Dictionary<Guid, ClientDeal> _byId = new();

    public static ClientDeal? Current { get; private set; }

    public static void Register(ClientDeal deal)
    {
        Current = deal;
        _byId[deal.Id] = deal;
    }

    public static bool TryResolve(Guid id, out ClientDeal deal) => _byId.TryGetValue(id, out deal!);

    public static void Clear()
    {
        Current = null;
        _byId.Clear();
    }
}
