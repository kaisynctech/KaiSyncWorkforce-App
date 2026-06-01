using System.Collections;

namespace KaiFlow.Timesheets.Views.Shared;

public partial class AttendanceSessionTableView : ContentView
{
    public static readonly BindableProperty SessionsProperty =
        BindableProperty.Create(
            nameof(Sessions),
            typeof(IEnumerable),
            typeof(AttendanceSessionTableView),
            propertyChanged: OnSessionsChanged);

    public static readonly BindableProperty ShowEmployeeColumnProperty =
        BindableProperty.Create(
            nameof(ShowEmployeeColumn),
            typeof(bool),
            typeof(AttendanceSessionTableView),
            false,
            propertyChanged: OnLayoutChanged);

    public static readonly BindableProperty EmptyMessageProperty =
        BindableProperty.Create(
            nameof(EmptyMessage),
            typeof(string),
            typeof(AttendanceSessionTableView),
            "No sessions in this period.");

    public IEnumerable? Sessions
    {
        get => (IEnumerable?)GetValue(SessionsProperty);
        set => SetValue(SessionsProperty, value);
    }

    public bool ShowEmployeeColumn
    {
        get => (bool)GetValue(ShowEmployeeColumnProperty);
        set => SetValue(ShowEmployeeColumnProperty, value);
    }

    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    public AttendanceSessionTableView()
    {
        InitializeComponent();
        UpdateVisibility();
    }

    private static void OnSessionsChanged(BindableObject bindable, object _, object __)
        => ((AttendanceSessionTableView)bindable).UpdateVisibility();

    private static void OnLayoutChanged(BindableObject bindable, object _, object __)
        => ((AttendanceSessionTableView)bindable).UpdateVisibility();

    private void UpdateVisibility()
    {
        var hasSessions = Sessions?.Cast<object>().Any() == true;
        EmptyStateLabel.IsVisible = !hasSessions;
        MultiEmployeeTable.IsVisible = hasSessions && ShowEmployeeColumn;
        SingleEmployeeTable.IsVisible = hasSessions && !ShowEmployeeColumn;
    }
}
