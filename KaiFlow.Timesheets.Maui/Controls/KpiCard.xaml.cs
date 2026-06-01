using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Reusable KPI tile for dashboards. Shows a title, a large value, an optional
/// delta (▲/▼ with positive/negative colouring) and a muted caption. An accent
/// colour drives a small status dot so a grid of tiles reads at a glance.
/// </summary>
public partial class KpiCard : ContentView
{
    public KpiCard()
    {
        InitializeComponent();
        Apply();
    }

    public static readonly BindableProperty TitleProperty = BindableProperty.Create(
        nameof(Title), typeof(string), typeof(KpiCard), string.Empty,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public static readonly BindableProperty ValueProperty = BindableProperty.Create(
        nameof(Value), typeof(string), typeof(KpiCard), string.Empty,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public static readonly BindableProperty CaptionProperty = BindableProperty.Create(
        nameof(Caption), typeof(string), typeof(KpiCard), string.Empty,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public static readonly BindableProperty DeltaProperty = BindableProperty.Create(
        nameof(Delta), typeof(string), typeof(KpiCard), string.Empty,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public static readonly BindableProperty DeltaPositiveProperty = BindableProperty.Create(
        nameof(DeltaPositive), typeof(bool), typeof(KpiCard), true,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public static readonly BindableProperty AccentProperty = BindableProperty.Create(
        nameof(Accent), typeof(Color), typeof(KpiCard), null,
        propertyChanged: (b, _, _) => ((KpiCard)b).Apply());

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public string Value
    {
        get => (string)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    public string Caption
    {
        get => (string)GetValue(CaptionProperty);
        set => SetValue(CaptionProperty, value);
    }

    /// <summary>Delta text, e.g. "12.4%". Hidden when empty.</summary>
    public string Delta
    {
        get => (string)GetValue(DeltaProperty);
        set => SetValue(DeltaProperty, value);
    }

    public bool DeltaPositive
    {
        get => (bool)GetValue(DeltaPositiveProperty);
        set => SetValue(DeltaPositiveProperty, value);
    }

    public Color? Accent
    {
        get => (Color?)GetValue(AccentProperty);
        set => SetValue(AccentProperty, value);
    }

    private void Apply()
    {
        TitleLabel.Text = (Title ?? string.Empty).ToUpperInvariant();
        ValueLabel.Text = Value ?? string.Empty;
        CaptionLabel.Text = Caption ?? string.Empty;

        var accent = Accent ?? Lookup("Primary", "#3B82F6");
        AccentDot.Color = accent;

        var hasDelta = !string.IsNullOrWhiteSpace(Delta);
        DeltaLabel.IsVisible = hasDelta;
        if (hasDelta)
        {
            var glyph = DeltaPositive ? "\u25B2" : "\u25BC"; // ▲ / ▼
            DeltaLabel.Text = $"{glyph} {Delta}";
            DeltaLabel.TextColor = DeltaPositive
                ? Lookup("Success", "#22C55E")
                : Lookup("Error", "#EF4444");
        }
    }

    private static Color Lookup(string key, string fallback) =>
        Application.Current?.Resources != null
        && Application.Current.Resources.TryGetValue(key, out var v) && v is Color c
            ? c
            : Color.FromArgb(fallback);
}
