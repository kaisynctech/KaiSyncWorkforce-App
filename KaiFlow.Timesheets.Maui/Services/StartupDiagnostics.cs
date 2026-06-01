namespace KaiFlow.Timesheets.Services;

/// <summary>Writes startup / WinUI crash details under %LocalAppData%\KaiFlow\.</summary>
public static class StartupDiagnostics
{
    private static readonly object Gate = new();

    public static string LogDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "KaiFlow");

    public static void Write(string tag, string message, Exception? ex = null)
    {
        try
        {
            lock (Gate)
            {
                Directory.CreateDirectory(LogDirectory);
                var path = Path.Combine(LogDirectory, "startup-error.log");
                var body =
                    $"{DateTime.Now:u} [{tag}] {message}{Environment.NewLine}" +
                    (ex == null ? "" : $"{ex}{Environment.NewLine}") +
                    Environment.NewLine;
                File.AppendAllText(path, body);
            }
        }
        catch
        {
            // ignore logging failures
        }

        System.Diagnostics.Debug.WriteLine(ex == null ? $"[{tag}] {message}" : $"[{tag}] {message}{Environment.NewLine}{ex}");
    }
}
