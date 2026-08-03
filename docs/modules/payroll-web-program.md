# Payroll web upgrade — KaiFlow.Payroll (C#) → TypeScript port

> Companion to `docs/modules/payroll.md`. Tracks the `kaisync-web/src/lib/payroll/*` port of
> `KaiFlow.Payroll` and what's now enforced vs still a gap relative to MAUI.

## Files

| File | Ports | Notes |
|------|-------|-------|
| `payroll/sars-paye.ts` | `SarsPayeCalculator.cs` | 2025/26 annual brackets + age-based rebates, tax-directive override |
| `payroll/period.ts` | `PayrollPeriodHelper.cs` | `isEmployedInPeriod`, `proRateFactor`, `monthlySalaryFactor` (ISO date strings, UTC day-number math) |
| `payroll/leave-days.ts` | `LeaveDayCalculator.cs` | `countDaysInPeriod`, `isUnpaidLeave` (half-day + fractional-day aware) |
| `payroll/salary-resolver.ts` | `SalaryResolver.cs` | `resolveAsOf` — picks the salary/rate row effective at period-end from history |
| `payroll/bank-export.ts` | `BankPaymentFileFormatter.cs` | `formatBankPaymentFile('generic'\|'fnb'\|'absa'\|'standard_bank', rows)` |
| `payroll/irp5.ts` | `PayrollYtdHelper.cs` + `Irp5RecordBuilder.cs` | SA tax-year (Mar–Feb) YTD aggregation/merge + IRP5 CSV rows |
| `payroll/calculator.ts` | `PayrollCalculator.cs` | Full pipeline: guard → resolve salary → pay basis → pro-rate → sessions → leave → earnings → deductions → statutory → notes → YTD merge |
| `payroll-engine.ts` | — | Thin adapter: maps `EngineEmployee` + `PayrollSettings` (flat prefs) ↔ the calculator's structured inputs/outputs. Public `calculatePayslip` / `sumPunchHours` API is unchanged. |
| `payroll/types.ts` | — | Local `PayrollLineItem` shim (`{ label, amount }`) so `payroll/*` has zero dependency on the `@/types/database` Next.js path alias — lets the files be copied verbatim into `supabase/functions/_shared/payroll/`. |

`policy_snapshot.source` is `'kaisync-web-payroll-engine-v2-server'` on all persisted `payment_approvals` rows (written by the `payroll-generate` Edge Function). The unsuffixed `'kaisync-web-payroll-engine-v2'` value comes from `payroll-engine.ts`'s `calculatePayslip`, which is no longer called from any production code path — it's kept only as an unused-in-prod helper exercised by `payroll-engine.test.ts` (regression coverage that the two hand-kept-in-sync copies of the engine agree).

## Server-side generate/recalculate (`payroll-generate` Edge Function)

Browser generate math is **replaced**. `kaisync-web/src/lib/payroll.ts`'s `generatePayrollPeriod` and `recalculatePayslip` no longer run the calculation client-side — they call `supabase/functions/payroll-generate` (POST, `Authorization: Bearer <user JWT>`), which:

- Verifies the caller via `employees.user_id`/`company_id`/`is_active`/`access_level` (owner/hr/hr_admin/admin), then does all data access with the service-role admin client (RLS-bypassing, since authorization was already enforced).
- Runs the **identical** engine — `supabase/functions/_shared/payroll/{types,period,leave-days,salary-resolver,sars-paye,irp5,calculator}.ts` are byte-for-byte copies of `kaisync-web/src/lib/payroll/*` (Deno-friendly `./file.ts` relative imports only), plus `_shared/payroll/prefs.ts` (mirrors `payroll-settings.ts`'s `PAYROLL_SETTINGS_DEFAULTS`/`prefsToPayrollSettings`) and `_shared/payroll/adapter.ts` (server port of `payroll-engine.ts`'s `calculatePayslip`).
- `action: 'generate'` — rejects locked periods (`payroll_period_locks`), loads `company_settings.payroll_preferences` via the `get_company_settings` RPC (called with the **caller's own session client**, since that RPC's `SECURITY DEFINER` body reads `auth.uid()` — the service-role client has none), loads active employees/existing payslips/time punches, and inserts one `pending` `payment_approvals` row per eligible, not-yet-generated employee.
- `action: 'recalculate'` — loads the pending payslip by `payment_id` + `company_id`, merges request `overrides` with the row's persisted override columns, recalculates, and updates the row, appending a `recalculated` audit-log entry attributed to the acting user.
- The web client (`payroll.ts`) never falls back to a client-side calculation on failure — it surfaces the Edge Function error directly, since a silently-different browser-computed payslip would defeat the purpose of moving generate server-side.

This closes remaining gap #2 below (server/RPC generate using the same TS engine for non-repudiation).

## Preferences vs engine — what's enforced now

| `PayrollSettings` field | Phase 4/5 engine (old) | v2 engine (this port) |
|---|---|---|
| `overtime_multiplier`, `allow_overtime_for_salary` | ✅ | ✅ |
| `uif_enabled`, `uif_rate_percent`, `uif_ceiling_monthly` | ✅ (flat, no ceiling pro-rate) | ✅ + ceiling pro-rated by period factor; employee-level `uif_rate_percent`/`uif_fixed_amount` override company rate |
| `paye_enabled`, `default_paye_rate_percent` | ✅ (flat %, no precedence chain) | ✅ full precedence: manual override → employee `paye_fixed_amount` → SARS tables (if enabled) → employee `paye_rate_percent` → company `default_paye_rate_percent` |
| `use_sars_tax_tables` | ❌ stored only, web showed a warning | ✅ real bracket + rebate calculation (`sars-paye.ts`) |
| `salary_ignore_attendance_deductions` | ❌ unused | ✅ gates attendance penalties for monthly-salary employees |
| `absent_penalty_mode/threshold/deduct_days`, `deduct_absent_from_pay` (legacy) | ❌ unused | ✅ `per_day` / `threshold` modes; legacy `deduct_absent_from_pay=true` still falls back to `per_day` when mode is `none` |
| `late_penalty_*`, `early_penalty_*` | ❌ unused | ✅ same modes as absent, in hours × hourly rate. **Gap:** late/early flags require punch-vs-shift-schedule comparison, which the web punch pipeline doesn't have yet — see P3 below |
| `pay_full_salary_for_mid_month_joiners` | ❌ unused | ✅ |
| `pay_salary_on_public_holidays`, `pay_hourly_on_public_holidays`, `public_holidays_text` | ❌ unused | ✅ `public_holidays_text` parsed (newline or comma separated `YYYY-MM-DD`) |
| `payroll_default_pay_basis` | ✅ (string match) | ✅ (same, now feeds `Policy.defaultPayBasis` when employee has no explicit basis or rates) |
| Employee `pay_full_monthly_salary`, `overtime_rate`, `work_days_weekly`, `tax_directive_rate_percent`, `date_of_birth`, `employment_date`/`termination_date` | ❌ not in `EngineEmployee` | ✅ added as optional `EngineEmployee` fields; drive employment guard, pro-rating, SARS rebates/directive |

### Intentional deviations from the C# reference

`PayrollCalculator.cs`'s `AddStatutoryDeductions` only reads **employee-level** `UifRatePercent`/`PayeRatePercent` — it never falls back to a company-wide rate. Most KaiSync web companies don't set a per-employee UIF/PAYE rate (they rely on one company-wide `payroll_preferences` value), so `calculator.ts` adds two enterprise-pragmatic fallbacks, documented at the top of the file:

1. **UIF** — gated by `policy.statutory.uifEnabled`; uses `employee.uifRatePercent` if set and > 0, else `policy.statutory.uifRatePercent`.
2. **PAYE** — after the SARS/employee-rate precedence chain, falls back to `policy.statutory.defaultPayeRatePercent` if nothing else applied. Manual override always applies regardless of `payeEnabled`, matching the legacy adapter's tested behavior.

### Adapter simplifications (`payroll-engine.ts`)

The calculator's full pipeline takes structured `LeaveSnapshot[]` (start/end/half-day) and `AbsenceSnapshot[]` (per-date) so it can precisely separate "leave that overlaps a worked day" from "leave-only days" (relevant for daily/hourly earnings lines). `payroll.ts` (the caller) currently only loads **aggregate** paid/unpaid leave day counts per period, not per-day leave records, and has no absence-date source at all. `calculatePayslip()` therefore passes these as `leaveOverride`/`absentDaysOverride` on `CalculationInput`, which bypass the day-by-day overlap logic and treat the whole count as leave-only days with no session overlap. Direct callers of `calculator.ts` (e.g. `calculator.parity.test.ts`) that have real per-day records get the full-fidelity C# behavior.

Session/OT derivation (`buildSessionsFromPunches`) pairs `in`/`out` punches per day and splits `dailyHours` into regular vs overtime. **Late/early flags are always `false`** — punches alone don't carry a scheduled shift start/end to compare against, so late/early penalties never trigger through the web adapter today (they do work correctly if a caller supplies real `SessionSnapshot.isLate`/`isLeftEarly` values, e.g. a future shift-template-aware punch pipeline).

## Phase status (approved full program)

| Phase | Status | Evidence |
|---|---|---|
| **P0 Truth & guardrails** | ✅ | Anon `EXECUTE` revoked on `hr_generate_*` / lock RPCs; migrations in repo; prefs matrix documented |
| **P1 Server/engine v1** | ✅ | Full `calculator.ts` + SARS; generate/recalc load salary history + leave snapshots. `payroll-generate` Deno Edge Function now runs the same engine server-side (non-repudiation) |
| **P2 Policy completeness** | ✅ | Holidays, pro-rate, penalties, SARS; late/early via `employee_shift_templates` + `punch-session` metrics; `daily_absences` loaded on generate |
| **P3 Exports** | ✅ | Bank format picker (generic/FNB/ABSA/Standard) + IRP5 YTD PAYE/UIF CSV on payroll page |
| **P4 Xero payroll** | ✅ | `xero-push-payroll` v3 deployed against `payment_approvals` + `payment_approval_id` links (was broken inventing `payslips`) |
| **P5 Ops UX** | ✅ partial | Period cockpit KPIs, readiness preview, bulk approve, bank/IRP5 exports |
| **P6 Hardening** | ✅ | Anon revoke, JWT Xero push, step-up approve UI, live generate→approve→Xero smoke (2026-08-03), 49 unit tests |

### Remaining gaps (honest)

1. ~~Late/early penalties~~ / ~~server generate~~ / ~~step-up UI~~ / ~~live smoke~~ — closed (see phase table).
2. Optional polish: company timezone for punch local-time vs device TZ; sync Deno/`kaisync-web` payroll copies via a single package to avoid drift.

## Testing

- `sars-paye.test.ts` — bracket boundaries + rebate smoke tests.
- `calculator.parity.test.ts` — mid-month pro-rate, termination-before-period guard, absent `per_day` penalty, `waivePenalties` override, SARS PAYE path.
- `bank-export.test.ts` — header/row shape per bank format.
- `payroll-engine.test.ts` — adapter-level backward compatibility (monthly + UIF/PAYE/medical, contractor/exempt UIF skip, hourly OT split, manual PAYE + bonus).

Run `npm test` and `npx tsc --noEmit` in `kaisync-web` after any change to these files. There is no separate Deno test suite for `supabase/functions/_shared/payroll/*` yet — those files must be kept byte-for-byte identical (module-body) to `kaisync-web/src/lib/payroll/*` (only the relative-import extensions differ, e.g. `./period` → `./period.ts`), so the web unit tests above are the effective regression coverage for the server engine too. Any future edit to one copy must be mirrored to the other.
