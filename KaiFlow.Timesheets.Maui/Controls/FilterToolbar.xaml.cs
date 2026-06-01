using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Reusable search + filter chip row. Bind <see cref="SearchText"/> from the
/// ViewModel; place status/category chips in <see cref="FilterContent"/> and
/// optional export/actions in <see cref="TrailingContent"/>.
/// </summary>
public partial class FilterToolbar : ContentView
{
    public FilterToolbar()
    {
        InitializeComponent();
        SearchEntry.TextChanged += (_, e) => SearchText = e.NewTextValue ?? string.Empty;
    }

    public static readonly BindableProperty SearchTextProperty = BindableProperty.Create(
        nameof(SearchText), typeof(string), typeof(FilterToolbar), string.Empty,
        BindingMode.TwoWay,
        propertyChanged: (b, oldVal, newVal) =>
        {
            var tb = (FilterToolbar)b;
            var text = newVal as string ?? string.Empty;
            if (tb.SearchEntry.Text != text)
                tb.SearchEntry.Text = text;
        });

    public static readonly BindableProperty SearchPlaceholderProperty = BindableProperty.Create(
        nameof(SearchPlaceholder), typeof(string), typeof(FilterToolbar), "Search…",
        propertyChanged: (b, _, v) => ((FilterToolbar)b).SearchEntry.Placeholder = v as string ?? "Search…");

    public static readonly BindableProperty FilterContentProperty = BindableProperty.Create(
        nameof(FilterContent), typeof(View), typeof(FilterToolbar), null,
        propertyChanged: (b, _, v) => ((FilterToolbar)b).FiltersHost.Content = v as View);

    public static readonly BindableProperty TrailingContentProperty = BindableProperty.Create(
        nameof(TrailingContent), typeof(View), typeof(FilterToolbar), null,
        propertyChanged: (b, _, v) => ((FilterToolbar)b).TrailingHost.Content = v as View);

    public string SearchText
    {
        get => (string)GetValue(SearchTextProperty);
        set => SetValue(SearchTextProperty, value);
    }

    public string SearchPlaceholder
    {
        get => (string)GetValue(SearchPlaceholderProperty);
        set => SetValue(SearchPlaceholderProperty, value);
    }

    public View? FilterContent
    {
        get => (View?)GetValue(FilterContentProperty);
        set => SetValue(FilterContentProperty, value);
    }

    public View? TrailingContent
    {
        get => (View?)GetValue(TrailingContentProperty);
        set => SetValue(TrailingContentProperty, value);
    }
}
