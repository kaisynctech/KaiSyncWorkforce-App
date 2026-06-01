using System.Windows.Input;
using Microsoft.Maui.Controls;

namespace KaiFlow.Timesheets.Controls;

/// <summary>
/// Standard empty-state placeholder: glyph + title + optional message + optional
/// call-to-action. Use inside CollectionView EmptyView or wherever a list/section
/// has no data, so empty states look consistent and intentional.
/// </summary>
public partial class EmptyStateView : ContentView
{
    public EmptyStateView()
    {
        InitializeComponent();
        Apply();
    }

    public static readonly BindableProperty GlyphProperty = BindableProperty.Create(
        nameof(Glyph), typeof(string), typeof(EmptyStateView), "\U0001F4ED",
        propertyChanged: (b, _, _) => ((EmptyStateView)b).Apply());

    public static readonly BindableProperty TitleProperty = BindableProperty.Create(
        nameof(Title), typeof(string), typeof(EmptyStateView), "Nothing here yet",
        propertyChanged: (b, _, _) => ((EmptyStateView)b).Apply());

    public static readonly BindableProperty MessageProperty = BindableProperty.Create(
        nameof(Message), typeof(string), typeof(EmptyStateView), string.Empty,
        propertyChanged: (b, _, _) => ((EmptyStateView)b).Apply());

    public static readonly BindableProperty ActionTextProperty = BindableProperty.Create(
        nameof(ActionText), typeof(string), typeof(EmptyStateView), string.Empty,
        propertyChanged: (b, _, _) => ((EmptyStateView)b).Apply());

    public static readonly BindableProperty ActionCommandProperty = BindableProperty.Create(
        nameof(ActionCommand), typeof(ICommand), typeof(EmptyStateView), null);

    public string Glyph
    {
        get => (string)GetValue(GlyphProperty);
        set => SetValue(GlyphProperty, value);
    }

    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public string Message
    {
        get => (string)GetValue(MessageProperty);
        set => SetValue(MessageProperty, value);
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

    private void Apply()
    {
        GlyphLabel.Text = Glyph ?? string.Empty;
        TitleLabel.Text = Title ?? string.Empty;

        var hasMessage = !string.IsNullOrWhiteSpace(Message);
        MessageLabel.IsVisible = hasMessage;
        MessageLabel.Text = Message ?? string.Empty;

        var hasAction = !string.IsNullOrWhiteSpace(ActionText);
        ActionButton.IsVisible = hasAction;
        ActionButton.Text = ActionText ?? string.Empty;
    }

    private void OnActionClicked(object? sender, EventArgs e)
    {
        if (ActionCommand?.CanExecute(null) == true)
            ActionCommand.Execute(null);
    }
}
