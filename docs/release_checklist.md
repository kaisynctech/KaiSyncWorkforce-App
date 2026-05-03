# Release Checklist

Use this checklist before every production release.

## 1) Code Quality Gate

- [ ] `flutter pub get`
- [ ] `flutter analyze` passes (or only accepted existing info-level warnings)
- [ ] `flutter test` passes
- [ ] CI workflow (`.github/workflows/ci.yml`) is green

## 2) Database Rollout Gate

- [ ] Latest SQL migration scripts are applied in Supabase
- [ ] `sql/employee_rpc_smoke_test.sql` passes
- [ ] `sql/employee_rpc_negative_smoke_test.sql` passes
- [ ] HR login and employee login both verified in production-like data

## 3) Runtime Sanity Gate (App)

- [ ] HR dashboard loads all key sections (Dashboard, Attendance, Jobs, Inventory, Incidents, Payments)
- [ ] HR uses **System check** button and confirms all checks pass
- [ ] Employee can:
  - [ ] View assigned jobs
  - [ ] Submit incident
  - [ ] Save job card + inventory usage
  - [ ] Sign in/out once without duplication

## 4) Rollback Notes

Keep these ready before deploy:

- SQL rollback plan for latest migration(s)
- Feature flags/toggles to disable risky paths if needed
- Last known good app build/version reference

## 5) Post-Deploy Monitoring (First 30 Minutes)

- [ ] Watch telemetry logs for RPC permission or RLS failures
- [ ] Verify no spike in user-facing error snacks
- [ ] Confirm at least one successful end-to-end HR + employee workflow
