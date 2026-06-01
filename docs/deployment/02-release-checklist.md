# Release checklist

> **Full SOP:** [release-process.md](./release-process.md) · **Pilot gate:** [pilot-readiness-review.md](./pilot-readiness-review.md)

## Version bump

- [ ] Update `ApplicationDisplayVersion` in `KaiFlow.Timesheets.Maui.csproj`
- [ ] Increment `ApplicationVersion` (build number)
- [ ] Add row to `app_versions` with release notes and `minimum_required_version`
- [ ] Set `is_mandatory` if breaking schema or auth change
- [ ] Update platform download URLs

## Communication

- [ ] Release notes drafted for customers
- [ ] Support team briefed on new flags / settings
- [ ] Known issues documented

## Validation

- [ ] Full [deployment checklist](./01-deployment-checklist.md) completed on staging
- [ ] Regression: attendance punch in/out
- [ ] Regression: payroll approval flow
- [ ] Regression: finance invoice list
- [ ] Regression: client + contractor portals

## Go-live

- [ ] Production `supabase db push` completed
- [ ] Client packages published
- [ ] Monitor `application_errors` for 24h post-release
