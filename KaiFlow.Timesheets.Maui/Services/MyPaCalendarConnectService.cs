namespace KaiFlow.Timesheets.Services;

/// <summary>
/// Placeholder OAuth flow. Set MY_PA_GOOGLE_CLIENT_ID and MY_PA_OUTLOOK_CLIENT_ID in app settings when ready.
/// Edge Function callback URL: {SUPABASE_URL}/functions/v1/calendar-oauth-callback
/// </summary>
public class MyPaCalendarConnectService : IMyPaCalendarConnectService
{
    private const string GoogleClientIdKey = "MY_PA_GOOGLE_CLIENT_ID";
    private const string OutlookClientIdKey = "MY_PA_OUTLOOK_CLIENT_ID";

    public bool IsGoogleConfigured =>
        !string.IsNullOrWhiteSpace(Preferences.Default.Get(GoogleClientIdKey, ""));

    public bool IsOutlookConfigured =>
        !string.IsNullOrWhiteSpace(Preferences.Default.Get(OutlookClientIdKey, ""));

    public async Task ConnectGoogleAsync(Guid employeeId, Guid companyId)
    {
        if (!IsGoogleConfigured)
        {
            await Shell.Current.DisplayAlert(
                "Google Calendar",
                "Add your Google OAuth client ID in company settings (key: MY_PA_GOOGLE_CLIENT_ID), deploy the calendar-oauth Edge Function, then try again.",
                "OK");
            return;
        }

        var clientId = Preferences.Default.Get(GoogleClientIdKey, "")!;
        var redirect = Uri.EscapeDataString("kaiflow://calendar-oauth/google");
        var scope = Uri.EscapeDataString("https://www.googleapis.com/auth/calendar");
        var state = Uri.EscapeDataString($"{employeeId}|{companyId}|google");
        var url =
            $"https://accounts.google.com/o/oauth2/v2/auth?client_id={clientId}&response_type=code&redirect_uri={redirect}&scope={scope}&access_type=offline&prompt=consent&state={state}";
        await Launcher.Default.OpenAsync(new Uri(url));
    }

    public async Task ConnectOutlookAsync(Guid employeeId, Guid companyId)
    {
        if (!IsOutlookConfigured)
        {
            await Shell.Current.DisplayAlert(
                "Outlook Calendar",
                "Add your Microsoft app (client) ID in company settings (key: MY_PA_OUTLOOK_CLIENT_ID), deploy the calendar-oauth Edge Function, then try again.",
                "OK");
            return;
        }

        var clientId = Preferences.Default.Get(OutlookClientIdKey, "")!;
        var redirect = Uri.EscapeDataString("kaiflow://calendar-oauth/outlook");
        var scope = Uri.EscapeDataString("Calendars.ReadWrite offline_access");
        var state = Uri.EscapeDataString($"{employeeId}|{companyId}|outlook");
        var url =
            $"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id={clientId}&response_type=code&redirect_uri={redirect}&scope={scope}&state={state}";
        await Launcher.Default.OpenAsync(new Uri(url));
    }

    public Task DisconnectAsync(Guid employeeId, string provider) => Task.CompletedTask;
}
