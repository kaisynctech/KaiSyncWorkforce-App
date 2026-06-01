using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Standard chart container: title + optional subtitle + optional trailing slot
/// (legend / range selector) above a host that accepts any chart view
/// (typically a <see cref="GraphicsView"/> backed by a KaiFlow chart drawable).
/// Keeps all dashboard charts framed consistently.
/// </summary>
public partial class ChartCard : ContentView
{
    public ChartCard()
    {
        InitializeComponent();
        Apply();
    }

    public static readonly BindableProperty TitleProperty = BindableProperty.Create(
        nameof(Title), typeof(string), typeof(ChartCard), string.Empty,
        propertyChanged: (b, _, _) => ((ChartCard)b).Apply());

    public static readonly BindableProperty SubtitleProperty = BindableProperty.Create(
        nameof(Subtitle), typeof(string), typeof(ChartCard), string.Empty,
        propertyChanged: (b, _, _) => ((ChartCard)b).Apply());

    public static readonly BindableProperty ChartContentProperty = BindableProperty.Create(
        nameof(ChartContent), typeof(View), typeof(ChartCard), null,
        propertyChanged: (b, _, v) => ((ChartCard)b).ChartHost.Content = v as View);

    public static readonly BindableProperty TrailingContentProperty = BindableProperty.Create(
        nameof(TrailingContent), typeof(View), typeof(ChartCard), null,
        propertyChanged: (b, _, v) => ((ChartCard)b).TrailingHost.Content = v as View);

    public static readonly BindableProperty ChartHeightProperty = BindableProperty.Create(
        nameof(ChartHeight), typeof(double), typeof(ChartCard), 180d,
        propertyChanged: (b, _, v) => ((ChartCard)b).ChartHost.MinimumHeightRequest = (double)v);

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public string Subtitle
    {
        get => (string)GetValue(SubtitleProperty);
        set => SetValue(SubtitleProperty, value);
    }

    public View? ChartContent
    {
        get => (View?)GetValue(ChartContentProperty);
        set => SetValue(ChartContentProperty, value);
    }

    public View? TrailingContent
    {
        get => (View?)GetValue(TrailingContentProperty);
        set => SetValue(TrailingContentProperty, value);
    }

    public double ChartHeight
    {
        get => (double)GetValue(ChartHeightProperty);
        set => SetValue(ChartHeightProperty, value);
    }

    private void Apply()
    {
        TitleLabel.Text = Title ?? string.Empty;

        var hasSub = !string.IsNullOrWhiteSpace(Subtitle);
        SubtitleLabel.IsVisible = hasSub;
        SubtitleLabel.Text = Subtitle ?? string.Empty;
    }
}
