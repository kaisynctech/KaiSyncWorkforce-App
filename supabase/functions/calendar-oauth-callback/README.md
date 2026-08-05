# Calendar OAuth callback (Google / Outlook)

Deploy when `MY_PA_GOOGLE_CLIENT_ID` and `MY_PA_OUTLOOK_CLIENT_ID` are configured.

## Flow

1. MAUI app opens provider authorize URL with `state={employeeId}|{companyId}|{provider}`.
2. Provider redirects to `kaiflow://calendar-oauth/{provider}?code=...&state=...`.
3. This Edge Function exchanges `code` for tokens and upserts `employee_calendar_connections`.
4. Scheduled sync (cron) pulls events into `external_calendar_events`.

## Env vars

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

## Finish later

Implement `index.ts` with token exchange and `sync-calendar` worker. Until then, use **Export** (.ics) in the app.
