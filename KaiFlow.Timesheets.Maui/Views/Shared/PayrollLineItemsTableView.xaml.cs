using System.Collections;

namespace KaiFlow.Timesheets.Views.Shared;

public partial class PayrollLineItemsTableView : ContentView
{
    public static readonly BindableProperty ItemsSourceProperty =
        BindableProperty.Create(nameof(ItemsSource), typeof(IEnumerable), typeof(PayrollLineItemsTableView),
            propertyChanged: OnItemsChanged);

    public static readonly BindableProperty EmptyMessageProperty =
        BindableProperty.Create(nameof(EmptyMessage), typeof(string), typeof(PayrollLineItemsTableView),
            "No line items.");

    public static readonly BindableProperty ShowAsDeductionsProperty =
        BindableProperty.Create(nameof(ShowAsDeductions), typeof(bool), typeof(PayrollLineItemsTableView), false);

    public IEnumerable? ItemsSource
    {
        get => (IEnumerable?)GetValue(ItemsSourceProperty);
        set => SetValue(ItemsSourceProperty, value);
    }

    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    public bool ShowAsDeductions
    {
        get => (bool)GetValue(ShowAsDeductionsProperty);
        set => SetValue(ShowAsDeductionsProperty, value);
    }

    public PayrollLineItemsTableView()
    {
        InitializeComponent();
        UpdateEmptyState();
    }

    private static void OnItemsChanged(BindableObject bindable, object _, object __)
        => ((PayrollLineItemsTableView)bindable).UpdateEmptyState();

    private void UpdateEmptyState()
    {
        var hasItems = ItemsSource?.Cast<object>().Any() == true;
        EmptyStateLabel.IsVisible = !hasItems;
        TableFrame.IsVisible = hasItems;
    }
}
