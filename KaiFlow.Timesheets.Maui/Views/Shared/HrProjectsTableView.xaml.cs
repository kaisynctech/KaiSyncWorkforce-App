using System.Collections;
using System.Collections.Specialized;
using System.Windows.Input;

namespace KaiFlow.Timesheets.Views.Shared;

public partial class HrProjectsTableView : ContentView
{
    private INotifyCollectionChanged? _projectsWatch;

    public static readonly BindableProperty ProjectsProperty =
        BindableProperty.Create(
            nameof(Projects),
            typeof(IEnumerable),
            typeof(HrProjectsTableView),
            propertyChanged: OnProjectsChanged);

    public static readonly BindableProperty ViewProjectCommandProperty =
        BindableProperty.Create(nameof(ViewProjectCommand), typeof(ICommand), typeof(HrProjectsTableView));

    public static readonly BindableProperty AddClientPaymentCommandProperty =
        BindableProperty.Create(nameof(AddClientPaymentCommand), typeof(ICommand), typeof(HrProjectsTableView));

    public IEnumerable? Projects
    {
        get => (IEnumerable?)GetValue(ProjectsProperty);
        set => SetValue(ProjectsProperty, value);
    }

    public ICommand? ViewProjectCommand
    {
        get => (ICommand?)GetValue(ViewProjectCommandProperty);
        set => SetValue(ViewProjectCommandProperty, value);
    }

    public ICommand? AddClientPaymentCommand
    {
        get => (ICommand?)GetValue(AddClientPaymentCommandProperty);
        set => SetValue(AddClientPaymentCommandProperty, value);
    }

    public HrProjectsTableView()
    {
        InitializeComponent();
        UpdateVisibility();
    }

    private static void OnProjectsChanged(BindableObject bindable, object oldValue, object newValue)
    {
        var view = (HrProjectsTableView)bindable;
        if (view._projectsWatch != null)
            view._projectsWatch.CollectionChanged -= view.OnProjectsCollectionChanged;
        view._projectsWatch = newValue as INotifyCollectionChanged;
        if (view._projectsWatch != null)
            view._projectsWatch.CollectionChanged += view.OnProjectsCollectionChanged;
        view.UpdateVisibility();
    }

    private void OnProjectsCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e) => UpdateVisibility();

    private void UpdateVisibility()
    {
        var hasRows = Projects?.Cast<object>().Any() == true;
        EmptyStateLabel.IsVisible = !hasRows;
        TableContent.IsVisible = hasRows;
    }
}
