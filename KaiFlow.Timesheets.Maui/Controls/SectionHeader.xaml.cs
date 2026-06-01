using System.Windows.Input;
using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Standard section header: title + optional subtitle on the left, optional
/// action link on the right (e.g. "View all"). Keeps section spacing/typography
/// consistent across every screen.
/// </summary>
public partial class SectionHeader : ContentView
{
    public SectionHeader()
    {
        InitializeComponent();
        Apply();
    }

    public static readonly BindableProperty TitleProperty = BindableProperty.Create(
        nameof(Title), typeof(string), typeof(SectionHeader), string.Empty,
        propertyChanged: (b, _, _) => ((SectionHeader)b).Apply());

    public static readonly BindableProperty SubtitleProperty = BindableProperty.Create(
        nameof(Subtitle), typeof(string), typeof(SectionHeader), string.Empty,
        propertyChanged: (b, _, _) => ((SectionHeader)b).Apply());

    public static readonly BindableProperty ActionTextProperty = BindableProperty.Create(
        nameof(ActionText), typeof(string), typeof(SectionHeader), string.Empty,
        propertyChanged: (b, _, _) => ((SectionHeader)b).Apply());

    public static readonly BindableProperty ActionCommandProperty = BindableProperty.Create(
        nameof(ActionCommand), typeof(ICommand), typeof(SectionHeader), null);

    public static readonly BindableProperty ActionCommandParameterProperty = BindableProperty.Create(
        nameof(ActionCommandParameter), typeof(object), typeof(SectionHeader), null);

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

    public string ActionText
    {
        get => (string)GetValue(ActionTextProperty);
        set => SetValue(ActionTextProperty, value);
    }

    public ICommand? ActionCommand
    {
        get => (ICommand?)GetValue(ActionCommandProperty);
        set => SetValue(ActionCommandProperty, value);
    }

    public object? ActionCommandParameter
    {
        get => GetValue(ActionCommandParameterProperty);
        set => SetValue(ActionCommandParameterProperty, value);
    }

    private void Apply()
    {
        TitleLabel.Text = Title ?? string.Empty;

        var hasSub = !string.IsNullOrWhiteSpace(Subtitle);
        SubtitleLabel.IsVisible = hasSub;
        SubtitleLabel.Text = Subtitle ?? string.Empty;

        var hasAction = !string.IsNullOrWhiteSpace(ActionText);
        ActionButton.IsVisible = hasAction;
        ActionButton.Text = ActionText ?? string.Empty;
    }

    private void OnActionClicked(object? sender, EventArgs e)
    {
        if (ActionCommand?.CanExecute(ActionCommandParameter) == true)
            ActionCommand.Execute(ActionCommandParameter);
    }
}
