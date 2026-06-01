using System.Windows.Input;
using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Enterprise table shell: sticky header slot, virtualised rows, empty state,
/// and pagination footer. Sort/filter logic lives in the ViewModel via
/// <see cref="TableQuery"/>; this control is presentational.
/// </summary>
public partial class EnterpriseTableView : ContentView
{
    public EnterpriseTableView()
    {
        InitializeComponent();
        ApplyEmptyState();
        ApplyPaginationVisibility();
    }

    public static readonly BindableProperty ItemsSourceProperty = BindableProperty.Create(
        nameof(ItemsSource), typeof(System.Collections.IEnumerable), typeof(EnterpriseTableView), null,
        propertyChanged: (b, _, v) => ((EnterpriseTableView)b).RowsView.ItemsSource = v as System.Collections.IEnumerable);

    public static readonly BindableProperty ItemTemplateProperty = BindableProperty.Create(
        nameof(ItemTemplate), typeof(DataTemplate), typeof(EnterpriseTableView), null,
        propertyChanged: (b, _, v) => ((EnterpriseTableView)b).RowsView.ItemTemplate = v as DataTemplate);

    public static readonly BindableProperty HeaderContentProperty = BindableProperty.Create(
        nameof(HeaderContent), typeof(View), typeof(EnterpriseTableView), null,
        propertyChanged: (b, _, v) => ((EnterpriseTableView)b).HeaderHost.Content = v as View);

    public static readonly BindableProperty EmptyTitleProperty = BindableProperty.Create(
        nameof(EmptyTitle), typeof(string), typeof(EnterpriseTableView), "No rows",
        propertyChanged: (b, _, _) => ((EnterpriseTableView)b).ApplyEmptyState());

    public static readonly BindableProperty EmptyMessageProperty = BindableProperty.Create(
        nameof(EmptyMessage), typeof(string), typeof(EnterpriseTableView), string.Empty,
        propertyChanged: (b, _, _) => ((EnterpriseTableView)b).ApplyEmptyState());

    public static readonly BindableProperty ShowPaginationProperty = BindableProperty.Create(
        nameof(ShowPagination), typeof(bool), typeof(EnterpriseTableView), true,
        propertyChanged: (b, _, _) => ((EnterpriseTableView)b).ApplyPaginationVisibility());

    public static readonly BindableProperty PageSummaryProperty = BindableProperty.Create(
        nameof(PageSummary), typeof(string), typeof(EnterpriseTableView), string.Empty);

    public static readonly BindableProperty CanGoPreviousProperty = BindableProperty.Create(
        nameof(CanGoPrevious), typeof(bool), typeof(EnterpriseTableView), false);

    public static readonly BindableProperty CanGoNextProperty = BindableProperty.Create(
        nameof(CanGoNext), typeof(bool), typeof(EnterpriseTableView), false);

    public static readonly BindableProperty PreviousPageCommandProperty = BindableProperty.Create(
        nameof(PreviousPageCommand), typeof(ICommand), typeof(EnterpriseTableView), null);

    public static readonly BindableProperty NextPageCommandProperty = BindableProperty.Create(
        nameof(NextPageCommand), typeof(ICommand), typeof(EnterpriseTableView), null);

    public System.Collections.IEnumerable? ItemsSource
    {
        get => (System.Collections.IEnumerable?)GetValue(ItemsSourceProperty);
        set => SetValue(ItemsSourceProperty, value);
    }

    public DataTemplate? ItemTemplate
    {
        get => (DataTemplate?)GetValue(ItemTemplateProperty);
        set => SetValue(ItemTemplateProperty, value);
    }

    public View? HeaderContent
    {
        get => (View?)GetValue(HeaderContentProperty);
        set => SetValue(HeaderContentProperty, value);
    }

    public string EmptyTitle
    {
        get => (string)GetValue(EmptyTitleProperty);
        set => SetValue(EmptyTitleProperty, value);
    }

    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    public bool ShowPagination
    {
        get => (bool)GetValue(ShowPaginationProperty);
        set => SetValue(ShowPaginationProperty, value);
    }

    public string PageSummary
    {
        get => (string)GetValue(PageSummaryProperty);
        set => SetValue(PageSummaryProperty, value);
    }

    public bool CanGoPrevious
    {
        get => (bool)GetValue(CanGoPreviousProperty);
        set => SetValue(CanGoPreviousProperty, value);
    }

    public bool CanGoNext
    {
        get => (bool)GetValue(CanGoNextProperty);
        set => SetValue(CanGoNextProperty, value);
    }

    public ICommand? PreviousPageCommand
    {
        get => (ICommand?)GetValue(PreviousPageCommandProperty);
        set => SetValue(PreviousPageCommandProperty, value);
    }

    public ICommand? NextPageCommand
    {
        get => (ICommand?)GetValue(NextPageCommandProperty);
        set => SetValue(NextPageCommandProperty, value);
    }

    private void ApplyEmptyState()
    {
        EmptyView.Title = EmptyTitle ?? "No rows";
        EmptyView.Message = EmptyMessage ?? string.Empty;
    }

    private void ApplyPaginationVisibility()
        => PaginationBar.IsVisible = ShowPagination;
}
