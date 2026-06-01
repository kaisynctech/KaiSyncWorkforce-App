using KaiFlow.Timesheets.Services;

namespace KaiFlow.Timesheets.WinUI;

public partial class App : MauiWinUIApplication
{
    public App()
    {
        InitializeComponent();
        UnhandledException += (_, e) =>
        {
            StartupDiagnostics.Write("winui", e.Message, e.Exception);
        };
    }

    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
