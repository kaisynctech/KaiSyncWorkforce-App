# Deployment checklist

Use before every production deploy to Supabase + client stores.

## Pre-deploy

- [ ] All migrations applied locally and reviewed (`supabase db push --dry-run` or diff)
- [ ] `supabase migration list --linked` shows local = remote (except pending release)
- [ ] Build succeeds: `dotnet build KaiFlow.Timesheets.Maui.csproj`
- [ ] No secrets in migration files or committed `.env`
- [ ] RLS policies use `= ANY(user_company_ids())` not `IN (SELECT user_company_ids())`
- [ ] New RPCs have `GRANT EXECUTE` for `authenticated` / `anon` as required
- [ ] `app_versions` row updated if client minimum version changes

## Database deploy

```powershell
cd KaiFlow.Timesheets.Maui
supabase db push --linked --yes
supabase migration list --linked
```

- [ ] Migration applied without errors
- [ ] Smoke: `SELECT * FROM app_versions WHERE is_active LIMIT 1`
- [ ] Smoke: `SELECT count(*) FROM company_settings`

## Client deploy

- [ ] Bump `ApplicationDisplayVersion` and `ApplicationVersion` in `.csproj`
- [ ] Insert matching row in `app_versions` (or platform admin tooling)
- [ ] Publish Windows / Android packages per store pipeline
- [ ] Update store URLs in `app_versions.download_url_*` if applicable
- [ ] Legacy `config/app-version.json` in Supabase Storage updated (fallback)

## Post-deploy verification

- [ ] IdEntry loads; update check runs without crash
- [ ] HR sign-in + dashboard load
- [ ] Employee code-login + punch
- [ ] Payroll run (read-only smoke)
- [ ] Finance dashboard opens for entitled tenant
- [ ] Reports hub loads
- [ ] `application_errors` empty or expected only
- [ ] Platform admin console accessible (if applicable)

## Rollback pointer

See [03-rollback-checklist.md](./03-rollback-checklist.md).
