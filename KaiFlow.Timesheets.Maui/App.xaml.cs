using KaiFlow.Timesheets.Services;
using Supabase;

namespace KaiFlow.Timesheets;

public partial class App : Application
{
    private readonly IServiceProvider _services;
    private readonly Client _supabase;

    public App(IServiceProvider services, Client supabase)
    {
        InitializeComponent();
        _services = services;
        _supabase = supabase;
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        Page root;
        try
        {
            root = new AppShell(_services);
        }
        catch (Exception ex)
        {
            LogStartupFailure(ex);
            root = new ContentPage
            {
                Title = "Startup error",
                Content = new ScrollView
                {
                    Content = new Label
                    {
                        Text = ex.ToString(),
                        Margin = 16,
                        FontSize = 12
                    }
                }
            };
        }

        // Do not block here on Supabase/network — that deadlocks WinUI when SecureStorage
        // needs the UI thread, leaving a running process with no visible window.
        var window = new Window(root)
        {
            Title = "KaiSync Workforce",
            Width = 1280,
            Height = 800,
            MinimumWidth = 960,
            MinimumHeight = 640,
            X = 80,
            Y = 80
        };

        window.Created += (_, _) =>
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _supabase.InitializeAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Supabase init: {ex.Message}");
                }
            });
        };

        window.HandlerChanged += (_, _) =>
        {
#if WINDOWS
            try
            {
                if (window.Handler?.PlatformView is Microsoft.UI.Xaml.Window platformWindow)
                    platformWindow.Activate();
            }
            catch { /* best effort */ }
#endif
        };

        return window;
    }

    private static void LogStartupFailure(Exception ex) =>
        StartupDiagnostics.Write("app-shell", "Failed to create AppShell", ex);
}
