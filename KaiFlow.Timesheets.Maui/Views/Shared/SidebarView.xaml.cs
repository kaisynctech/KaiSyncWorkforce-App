using System.ComponentModel;
using KaiFlow.Timesheets.Services;

namespace KaiFlow.Timesheets.Views.Shared;

/// <summary>
/// Shared sidebar navigation for ALL top-level module pages.
///
/// BindingContext is set to NavigationStateService (singleton) as soon as the
/// DI container is reachable — either via the element's own Handler or via the
/// Application-level MauiContext (whichever resolves first).
///
/// WidthRequest is set programmatically (not via XAML binding) so the sidebar
/// is never width-0 during the brief window before BindingContext resolves.
/// </summary>
public partial class SidebarView : ContentView
{
    private NavigationStateService? _service;

    public SidebarView()
    {
        InitializeComponent();
        // Sidebar starts at the expanded default so layout is never 0-wide.
        WidthRequest = 220;
    }

    // Called when the element's own platform handler is attached.
    protected override void OnHandlerChanged()
    {
        base.OnHandlerChanged();
        TryResolve();
    }

    // Called when the element is added to / removed from its parent.
    protected override void OnParentChanged()
    {
        base.OnParentChanged();
        TryResolve();
    }

    private void TryResolve()
    {
        if (_service is not null) return;

        // Try element-level MauiContext first; fall back to Application-level.
        var services = Handler?.MauiContext?.Services
            ?? Application.Current?.Handler?.MauiContext?.Services;

        if (services is null) return;

        var svc = services.GetService<NavigationStateService>();
        if (svc is null) return;

        _service      = svc;
        BindingContext = svc;

        // Sync width immediately — avoids the 0→220 layout jump.
        WidthRequest = svc.SidebarWidthRequest;

        // Keep WidthRequest live as the user cycles sidebar modes.
        svc.PropertyChanged += OnServicePropertyChanged;
    }

    private void OnServicePropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(NavigationStateService.SidebarWidthRequest))
            MainThread.BeginInvokeOnMainThread(() =>
                WidthRequest = _service?.SidebarWidthRequest ?? 220);
    }
}
