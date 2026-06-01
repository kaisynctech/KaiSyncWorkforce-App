# Pilot customer readiness review

**Product:** KaiFlow Workforce (`KaiFlow.Timesheets.Maui`)  
**Review date:** May 2026  
**Scope:** First pilot customer deployment — distribution, updates, core modules (no new features)

---

## Executive summary

KaiFlow is **ready for controlled pilot deployment** with manual distribution (Windows installer + Android APK + web for iOS). Core workforce, payroll, finance, and platform administration are production-grade. Payment collection and automated backup execution remain post-pilot.

**Recommendation:** Proceed with 1–3 pilot tenants after completing the go-live checklist below.

---

## Readiness matrix

| Area | Status | Notes |
|------|--------|-------|
| **Versioning** | ✅ Ready | `app_versions`, csproj sync, RPCs |
| **Windows distribution** | ✅ Ready | `KaiFlowSetup.exe` via Inno Setup script |
| **Android distribution** | ⚠️ Ready with setup | Requires release keystore creation |
| **Download Center** | ✅ Ready | Dynamic version/notes from Supabase |
| **In-app updates** | ✅ Ready | Optional + mandatory flows |
| **Release hosting** | ⚠️ Action required | Create `releases` bucket + upload artifacts |
| **Error logging** | ✅ Ready | `application_errors` + AppTelemetry |
| **Telemetry** | ✅ Ready | `app_events`, platform events |
| **Backup framework** | ⚠️ Partial | Metadata only — no scheduled restore |
| **Attendance** | ✅ Ready | Punches, RLS, offline idempotency |
| **Payroll** | ✅ Ready | Engine + approvals (do not modify for pilot) |
| **Finance** | ✅ Ready | Invoices, VAT, approvals |
| **Platform admin** | ✅ Ready | Billing, health, feedback |
| **iOS native app** | ⏳ Web only | Add to Home Screen — documented |
| **Code signing** | ⏳ Recommended | Reduces SmartScreen / Play Protect warnings |
| **Stripe/PayFast** | ⏳ Post-pilot | Manual billing acceptable for pilot |

---

## Versioning & updates

### What works

- `VersionService` compares installed vs `get_latest_app_version` RPC
- **Optional updates:** alert on login with View update / Later
- **Mandatory updates:** `is_mandatory` or below `minimum_required_version` blocks skip
- **UpdatePage** shows installed version, latest version, release notes, download button

### Gaps

| Gap | Risk | Mitigation |
|-----|------|------------|
| No auto-install on Windows | Low | Expected — opens browser/download |
| Legacy `app-version.json` fallback still in code | Low | Prefer `app_versions`; deprecate JSON when pilots stable |
| iOS has no native update path | Medium | Document web + Home Screen in client pack |

---

## Downloads

### What works

- Website reads `windows_download_url` / `android_download_url` (RPC aliases)
- `/download` and `/releases` pages
- Fallback URLs in `website/config.js` if DB empty

### Required before first pilot

1. Create Supabase `releases` bucket
2. Build and upload `KaiFlowSetup.exe` + signed APK
3. Update `app_versions` download URLs
4. Send [07-client-onboarding-pack.md](./07-client-onboarding-pack.md) email

---

## Error logging & telemetry

| Capability | Implementation |
|------------|----------------|
| Client errors | `AppTelemetry` → `application_errors` |
| Platform KPIs | Platform Console error count |
| Update checks | `update_check` events |
| SaaS events | `feedback_submitted`, `billing_calculated`, etc. |

**Pilot action:** Check `application_errors` daily for first week.

---

## Backup framework

- Tables: `backup_jobs`, `company_backups`
- **Gap:** Cron schedules stored but not executed; no one-click restore UI
- **Pilot mitigation:** Supabase project-level backups (Pro plan); document manual export for critical tenants

---

## Core modules (unchanged — audit only)

| Module | Pilot-ready | Notes |
|--------|-------------|-------|
| Attendance | ✅ | GPS punches, exports |
| Jobs / Projects | ✅ | Field + CRM projects |
| Payroll | ✅ | Do not modify calculations during pilot |
| Finance | ✅ | Do not modify calculations during pilot |
| Leave | ✅ | Apply/approve flows |
| Incidents | ✅ | Enterprise module |
| Inventory / Suppliers | ✅ | Toggle per company |
| Contractors | ✅ | + Contractor Portal |
| Messaging / My PA | ✅ | |
| Property Management | ✅ | |
| Reports | ✅ | Excel/PDF exports |
| Client Portal | ✅ | Code login |
| Platform admin | ✅ | `kaisynctech@gmail.com` seed |

---

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Download URLs not configured | **High** | Complete release-hosting before onboarding |
| 2 | Android keystore lost | **High** | Secure backup; never regenerate |
| 3 | SmartScreen blocks Windows install | Medium | Code sign or document bypass |
| 4 | Pilot exceeds 25 employees | Low | Billing refresh in Platform Console |
| 5 | No payment automation | Low | Manual invoicing for pilot |
| 6 | iOS users expect App Store | Medium | Set expectation — web app only |
| 7 | Mandatory update misconfigured | Medium | Test on staging before forcing |

---

## Recommendations

1. **Complete one full release dry-run** using [release-process.md](./release-process.md) before first customer email.
2. **Create Android keystore** this week — required for any APK updates.
3. **Code-sign** `KaiFlowSetup.exe` when budget allows.
4. **Limit pilot to 3 tenants** — monitor `application_errors` and Platform Console health scores.
5. **Do not modify** payroll/finance/attendance logic during pilot window.
6. **Use Platform Console** for suspend/billing/feedback — not ad-hoc SQL.

---

## Go-live checklist

### Infrastructure

- [ ] Supabase migrations current (`supabase db push --linked`)
- [ ] `releases` Storage bucket created (public read)
- [ ] `app_versions` row with Windows + Android URLs
- [ ] Platform admin access verified (`kaisynctech@gmail.com`)

### Build & host

- [ ] `KaiFlowSetup.exe` built and uploaded
- [ ] Signed `KaiFlow-v1.0.0.apk` built and uploaded
- [ ] Website deployed to Vercel
- [ ] Download Center verified live

### Customer

- [ ] Pilot tenant registered (or pre-provisioned)
- [ ] Company code documented
- [ ] Onboarding email sent ([07-client-onboarding-pack.md](./07-client-onboarding-pack.md))
- [ ] HR completes setup wizard
- [ ] 2+ test employees + punch verified

### Post go-live (48h)

- [ ] `application_errors` reviewed
- [ ] Platform Console health checked
- [ ] Customer feedback channel confirmed (Settings → Send Feedback)
- [ ] Support email monitored (kaisynctech@gmail.com)

---

## Sign-off

| Role | Name | Date | Approved |
|------|------|------|----------|
| Engineering | | | ☐ |
| Product / Owner | | | ☐ |
| Operations | | | ☐ |

---

## Related docs

- [release-process.md](./release-process.md)
- [05-production-readiness-report.md](./05-production-readiness-report.md)
- [06-platform-admin-smoke-test.md](./06-platform-admin-smoke-test.md)
- [07-client-onboarding-pack.md](./07-client-onboarding-pack.md)
