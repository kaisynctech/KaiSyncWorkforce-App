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
