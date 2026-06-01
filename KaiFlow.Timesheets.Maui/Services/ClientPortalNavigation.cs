namespace KaiFlow.Timesheets.Services;

public static class ClientPortalNavigation
{
    /// <summary>Reset shell stack to the main login menu (IdEntry ShellContent).</summary>
    public const string LoginRoute = "///IdEntry";
    public const string PortalRoute = "//ClientPortalPage";

    /// <summary>Absolute route to a portal project (required for ShellContent on Windows).</summary>
    public static string ProjectDetailRoute(Guid dealId, bool openMessages = false)
    {
        var query = $"DealId={dealId}";
        if (openMessages)
            query += "&OpenMessages=true";
        return $"///ClientPortalProjectDetailPage?{query}";
    }

    private static int _exitInProgress;

    public static async Task ExitToLoginAsync(TimesheetStateService? state = null)
    {
        if (Interlocked.CompareExchange(ref _exitInProgress, 1, 0) != 0)
            return;

        try
        {
            ClientPortalSessionStore.ClearForSignOut();
            if (state != null)
                state.SuppressAutoLogin = true;

            await MainThread.InvokeOnMainThreadAsync(async () =>
            {
                if (Shell.Current == null)
                    return;

                await ShellNavigation.GoToAsync(LoginRoute);
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Client portal sign-out navigation failed: {ex}");
        }
        finally
        {
            Interlocked.Exchange(ref _exitInProgress, 0);
        }
    }
}
