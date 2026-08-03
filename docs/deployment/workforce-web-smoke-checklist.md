# Workforce web — staging smoke checklist

Run after Phases 1–5 changes. Assumes a staging tenant with module flags on.

## Foundation

- [ ] `/dashboard/employees` loads with module gate; disabling Employees module shows lock screen
- [ ] Create employee with branch + manager; DB has `branch_id`, `manager_id`, and mirrored `branch` / `manager_user_id`

## Scoping

- [ ] As **manager** with direct reports: employees / leave / attendance / team punch show only scoped rows
- [ ] As **owner/HR**: full company lists

## Teams & leave

- [ ] Create team → add member → set leader → deactivate → hidden from Team Punch default list
- [ ] Leave queue balances show Title Case types with sensible remaining days
- [ ] Approve/decline leave with optional note; permission failure shows banner (not silent)

## Payroll

- [ ] Settings gear opens `/dashboard/payroll/settings`; save round-trips OT/UIF/PAYE prefs
- [ ] Generate preview → generate creates `payment_approvals` with earnings/deductions breakdown (`policy_snapshot.source` = `kaisync-web-payroll-engine-v2`)
- [ ] Approve / reject use live RPCs; release sets `shared_with_employee`
- [ ] Enable "Use SARS tax tables"; generate/recalc uses bracket + rebate PAYE (not flat %)
- [ ] Mid-month joiner gets pro-rated monthly salary unless full-salary policy/override
- [ ] Recalculate pending payslip surfaces errors if any
- [ ] Bank CSV format picker (Generic/FNB/ABSA/Standard) downloads correct column layout
- [ ] IRP5 export includes YTD Gross / PAYE / UIF / Net columns
- [ ] Settings → Xero → Push Payroll creates Draft Manual Journals for approved `payment_approvals` and is idempotent on re-push
- [ ] Period cockpit shows pending/approved gross, approved net, lock status

## Import

- [ ] Template includes Branch, Manager, rates, banking
- [ ] Import row with salary + bank → employee detail payroll readiness improves

## Tests (local)

```bash
cd kaisync-web
npm test
npx tsc --noEmit
```

## Live API smoke — 2026-08-03 (test company)

Tenant: `test company` · Period under test: `2026-07-01` → `2026-07-31`  
Also re-pushed existing approved May payslips to Xero.

| Step | Result | Evidence |
|---|---|---|
| `payroll-generate` (server) | ✅ PASS | `generated: 3`, `skipped: 2`, `policy_snapshot.source = kaisync-web-payroll-engine-v2-server` |
| `approve_payment_run` without step-up | ⚠️ BLOCKED (expected) | `STEP_UP_REQUIRED` when `hr_check_step_up_valid` is false |
| `hr_confirm_step_up` then approve ×3 | ✅ PASS | All three July pending → `approved` |
| Release (`shared_with_employee`) | ✅ PASS | One July payslip released |
| `xero-push-payroll` May | ✅ PASS | `pushed: 2` Draft Manual Journals |
| `xero-push-payroll` July | ✅ PASS | `pushed: 3` Draft Manual Journals |
| Xero re-push idempotent | ✅ PASS | `pushed: 0` / “No new approved payslips…” |
| Local `npm test` / `tsc` | ✅ PASS | 53/53 tests (incl. company TZ helpers), `tsc` exit 0 |
| Company TZ late/early (unit) | ✅ PASS | Punch UTC vs `Africa/Johannesburg` wall clock; Edge `payroll-generate` redeployed with synced `_shared/payroll` |

### Gap found during smoke — fixed

Web payroll approve now matches MAUI: on `STEP_UP_REQUIRED`, prompt for password → `signInWithPassword` → `hr_confirm_step_up` → retry approve (`kaisync-web/src/lib/step-up.ts` + `StepUpDialog`).
