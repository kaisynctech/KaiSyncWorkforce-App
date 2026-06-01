using System.Collections;
using System.Collections.Specialized;
using System.Windows.Input;

namespace KaiFlow.Timesheets.Views.Shared;

public partial class EmployeeJobsTableView : ContentView
{
    private INotifyCollectionChanged? _jobsWatch;

    public static readonly BindableProperty JobsProperty =
        BindableProperty.Create(nameof(Jobs), typeof(IEnumerable), typeof(EmployeeJobsTableView),
            propertyChanged: OnJobsChanged);

    public static readonly BindableProperty OpenJobCommandProperty =
        BindableProperty.Create(nameof(OpenJobCommand), typeof(ICommand), typeof(EmployeeJobsTableView));

    public static readonly BindableProperty EmptyMessageProperty =
        BindableProperty.Create(nameof(EmptyMessage), typeof(string), typeof(EmployeeJobsTableView),
            defaultValue: "No jobs found.");

    public IEnumerable? Jobs
    {
        get => (IEnumerable?)GetValue(JobsProperty);
        set => SetValue(JobsProperty, value);
    }

    public ICommand? OpenJobCommand
    {
        get => (ICommand?)GetValue(OpenJobCommandProperty);
        set => SetValue(OpenJobCommandProperty, value);
    }

    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    public EmployeeJobsTableView()
    {
        InitializeComponent();
        UpdateVisibility();
    }

    private static void OnJobsChanged(BindableObject bindable, object oldValue, object newValue)
    {
        var view = (EmployeeJobsTableView)bindable;
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
        EmptyStateLabel.IsVisible = !hasRows;
        TableContent.IsVisible = hasRows;
    }
}
