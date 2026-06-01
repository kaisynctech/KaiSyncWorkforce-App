using System.Collections;
using System.Collections.Specialized;
using System.Windows.Input;

namespace KaiFlow.Timesheets.Views.Shared;

public partial class HrJobsTableView : ContentView
{
    private INotifyCollectionChanged? _jobsWatch;

    public static readonly BindableProperty JobsProperty =
        BindableProperty.Create(
            nameof(Jobs),
            typeof(IEnumerable),
            typeof(HrJobsTableView),
            propertyChanged: OnJobsChanged);

    public static readonly BindableProperty ViewJobCommandProperty =
        BindableProperty.Create(nameof(ViewJobCommand), typeof(ICommand), typeof(HrJobsTableView));

    public static readonly BindableProperty ViewLinkedProjectCommandProperty =
        BindableProperty.Create(nameof(ViewLinkedProjectCommand), typeof(ICommand), typeof(HrJobsTableView));

    public IEnumerable? Jobs
    {
        get => (IEnumerable?)GetValue(JobsProperty);
        set => SetValue(JobsProperty, value);
    }

    public ICommand? ViewJobCommand
    {
        get => (ICommand?)GetValue(ViewJobCommandProperty);
        set => SetValue(ViewJobCommandProperty, value);
    }

    public ICommand? ViewLinkedProjectCommand
    {
        get => (ICommand?)GetValue(ViewLinkedProjectCommandProperty);
        set => SetValue(ViewLinkedProjectCommandProperty, value);
    }

    public HrJobsTableView()
    {
        InitializeComponent();
        UpdateVisibility();
    }

    private static void OnJobsChanged(BindableObject bindable, object oldValue, object newValue)
    {
        var view = (HrJobsTableView)bindable;
        if (view._jobsWatch != null)
            view._jobsWatch.CollectionChanged -= view.OnJobsCollectionChanged;
        view._jobsWatch = newValue as INotifyCollectionChanged;
        if (view._jobsWatch != null)
            view._jobsWatch.CollectionChanged += view.OnJobsCollectionChanged;
        view.UpdateVisibility();
    }

    private void OnJobsCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e) => UpdateVisibility();

    private void UpdateVisibility()
    {
        var hasRows = Jobs?.Cast<object>().Any() == true;
        EmptyState.IsVisible = !hasRows;
        TableContent.IsVisible = hasRows;
    }
}
