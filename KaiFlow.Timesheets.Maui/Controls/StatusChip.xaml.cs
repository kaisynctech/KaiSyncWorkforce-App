using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Reusable enterprise status chip. Set <see cref="Text"/> and a semantic
/// <see cref="Status"/> ("success" | "warning" | "error" | "info" | "neutral").
/// Colours are resolved from the KaiFlow design tokens so chips stay consistent
/// across every module (invoices, jobs, incidents, payroll, etc.).
/// </summary>
public partial class StatusChip : ContentView
{
    public StatusChip()
    {
        InitializeComponent();
        Apply();
    }

    public static readonly BindableProperty TextProperty = BindableProperty.Create(
        nameof(Text), typeof(string), typeof(StatusChip), string.Empty,
        propertyChanged: (b, _, _) => ((StatusChip)b).Apply());

    public static readonly BindableProperty StatusProperty = BindableProperty.Create(
        nameof(Status), typeof(string), typeof(StatusChip), "neutral",
        propertyChanged: (b, _, _) => ((StatusChip)b).Apply());

    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    /// <summary>success | warning | error | info | neutral</summary>
    public string Status
    {
        get => (string)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    private void Apply()
    {
        ChipLabel.Text = Text ?? string.Empty;

        var (bg, fg) = ResolveColors(Status);
        ChipBorder.BackgroundColor = bg;
        ChipLabel.TextColor = fg;
    }

    private static (Color bg, Color fg) ResolveColors(string? status)
    {
        Color Lookup(string key, string fallback) =>
            Application.Current?.Resources != null
            && Application.Current.Resources.TryGetValue(key, out var v) && v is Color c
                ? c
                : Color.FromArgb(fallback);

        return (status?.Trim().ToLowerInvariant()) switch
        {
            "success" or "active" or "paid" or "approved" or "completed"
                => (Lookup("SuccessDark", "#DCFCE7"), Lookup("ChipSuccessText", "#15803D")),
            "warning" or "pending" or "partial" or "due"
                => (Lookup("WarningDark", "#FEF3C7"), Lookup("ChipWarningText", "#B45309")),
            "error" or "overdue" or "failed" or "cancelled" or "rejected"
                => (Lookup("ErrorDark", "#FEE2E2"), Lookup("ChipErrorText", "#B91C1C")),
            "info" or "draft" or "sent" or "open"
                => (Lookup("ChipInfoBg", "#DBEAFE"), Lookup("ChipInfoText", "#1D4ED8")),
            _ => (Lookup("ChipNeutralBg", "#EEF2F7"), Lookup("ChipNeutralText", "#475569")),
        };
    }
}
