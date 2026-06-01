using System.Windows.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr.Controls;

public partial class ProjectKanbanColumnView : Border
{
    public static readonly BindableProperty AccentColorProperty =
        BindableProperty.Create(nameof(AccentColor), typeof(Color), typeof(ProjectKanbanColumnView), Colors.Gray);

    public static readonly BindableProperty OpenProjectCommandProperty =
        BindableProperty.Create(nameof(OpenProjectCommand), typeof(ICommand), typeof(ProjectKanbanColumnView));

    public static readonly BindableProperty MoveToStageCommandProperty =
        BindableProperty.Create(nameof(MoveToStageCommand), typeof(ICommand), typeof(ProjectKanbanColumnView));

    public static readonly BindableProperty CreateJobCommandProperty =
        BindableProperty.Create(nameof(CreateJobCommand), typeof(ICommand), typeof(ProjectKanbanColumnView));

    public static readonly BindableProperty AdvanceStageCommandProperty =
        BindableProperty.Create(nameof(AdvanceStageCommand), typeof(ICommand), typeof(ProjectKanbanColumnView));

    public static readonly BindableProperty UploadDocumentCommandProperty =
        BindableProperty.Create(nameof(UploadDocumentCommand), typeof(ICommand), typeof(ProjectKanbanColumnView));

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

    public ICommand? MoveToStageCommand
    {
        get => (ICommand?)GetValue(MoveToStageCommandProperty);
        set => SetValue(MoveToStageCommandProperty, value);
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

    public ICommand? UploadDocumentCommand
    {
        get => (ICommand?)GetValue(UploadDocumentCommandProperty);
        set => SetValue(UploadDocumentCommandProperty, value);
    }

    private bool _isDropTarget;

    public ProjectKanbanColumnView()
    {
        InitializeComponent();
        BindingContextChanged += (_, _) =>
        {
            if (BindingContext is ProjectKanbanColumn col)
                AccentColor = Color.FromArgb(ProjectPipeline.StageAccentColor(col.StageValue));
        };
    }

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        if (BindingContext is not ProjectKanbanColumn col) return;
        if (!ResolveDraggedDeal(e, out var deal)) return;

        e.AcceptedOperation = DataPackageOperation.Copy;
        if (deal.StatusRaw == col.StageValue) return;

        HighlightDropTarget(true);
    }

    private void OnDragLeave(object? sender, EventArgs e) => HighlightDropTarget(false);

    private void OnDrop(object? sender, DropEventArgs e)
    {
        HighlightDropTarget(false);

        if (BindingContext is not ProjectKanbanColumn col) return;
        if (!ResolveDraggedDealForDrop(e, out var deal)) return;
        if (deal.StatusRaw == col.StageValue)
        {
            DraggedProjectRegistry.Clear();
            return;
        }

        var request = new MoveProjectRequest(deal, col.StageValue);
        if (MoveToStageCommand?.CanExecute(request) == true)
            MoveToStageCommand.Execute(request);

        DraggedProjectRegistry.Clear();
        e.Handled = true;
    }

    private void HighlightDropTarget(bool active)
    {
        if (active == _isDropTarget) return;
        _isDropTarget = active;
        DropZone.BackgroundColor = active
            ? Color.FromArgb("#2A2840")
            : (Color)Application.Current!.Resources["SurfaceElevated"];
        DropZone.Stroke = active
            ? AccentColor
            : (Color)Application.Current!.Resources["Divider"];
        DropHint.IsVisible = active;
    }

    private static bool ResolveDraggedDeal(DragEventArgs e, out ClientDeal deal)
        => ResolveDraggedDeal(out deal);

    private static bool ResolveDraggedDealForDrop(DropEventArgs e, out ClientDeal deal)
        => ResolveDraggedDeal(out deal);

    private static bool ResolveDraggedDeal(out ClientDeal deal)
    {
        deal = DraggedProjectRegistry.Current!;
        return deal != null;
    }
}
