# 01 — Authentication & Access

KaiFlow has **four authentication paths** feeding one backend. The defining distinction is **JWT (authenticated role)** vs **code (anon role + RPC routing)**.

```
                         ┌───────────────────────────┐
                         │   Supabase project          │
                         │   vcivtjwreybaxgtdhtou       │
                         └───────────────────────────┘
   JWT (authenticated)            ▲                 ▲   anon (code)
   ┌───────────────┐              │                 │   ┌──────────────────┐
   │ HR / Owner /   │  PostgREST   │                 │   │ Field employees   │ code → RPCs
   │ Admin / Mgr    │──── + RLS ───┘                 └───│ Contractors       │ code → RPCs
   │ (email+pwd)    │                                    │ Clients           │ code → RPCs
   └───────────────┘                                    └──────────────────┘
```

## 1. HR / management authentication (Supabase JWT)

- **UI:** `Views/Auth/HrSignInPage.xaml` → `HrSignInViewModel`.
- **Storage:** `SupabaseStorageService.SignInAsync(email, password)` calls `_supabase.Auth.SignIn(...)` then `GetCurrentEmployeeAsync()` (PostgREST `employees` filtered by `user_id = auth.uid()`).
- **Client config:** the singleton `Supabase.Client` is built with `AutoRefreshToken = true` and a `MauiSupabaseSessionHandler` for persistence (`MauiProgram.cs`); URL/anon key from `SupabaseEnvironment` → `SupabaseConfig`.
- **Post-login:** sets `TimesheetStateService` employee+company; `EnsureOwnerAccessLevelAsync` promotes the employee to `owner` if they are the company's `owner_user_id` but mis-leveled; routes to `//HrDashboard`.
- **Incomplete-registration path:** authenticated but no `employees` row → check `company_relationships` → route to company-details registration or `EmployeeLinkCompanyPage`.
- **Registration:** `HrRegisterViewModel` / OTP verify → `self_register_company` RPC.

HR is the only audience that reads/writes tables **directly via PostgREST under RLS**.

## 2. Employee code-login (the primary field path)

- **UI:** `Views/Auth/EmployeeLoginPage.xaml` → `EmployeeLoginViewModel`, with a toggle (`UseCodeMethod`) between **code** (default) and **email/password** (falls back to the JWT path).
- **Sequence:**
  1. `SignInWithCodeAsync(companyCode, employeeCode)` → RPC **`employee_sign_in_with_code`**.
  2. Returns `CodeLoginResult` (`SessionToken`, `Employee`, `Company`, `Memberships`).
  3. `CodeSessionStore` persists **only** company code, employee code, and session token (Preferences) — identity always re-fetched from RPCs.
  4. Optional mandatory-password gate, then `EmployeeAccountRouting.RouteAfterCompanySelectedAsync`.
- **Code matching** (`employee_resolve_by_code`): company by `companies.code` or numeric equality shim (`"28"` ↔ `"0028"`); employee by `employee_code`, `id_number`, or unexpired `temp_login_code`. Rejects `rejected` registrations; allows `pending`.
- **Session table:** `employee_code_sessions` (90-day expiry; RLS on, no SELECT policy — reached only via RPC).
- **Anon routing:** `IsCodeLoginSession()` returns true when there's no Supabase Auth user. All reads/writes then route through `employee_*` `SECURITY DEFINER` RPCs with explicit `(p_company_id, p_employee_id)`. Direct PostgREST writes are avoided (the punch insert throws rather than falling back).
- **PGRST303 mitigation:** an expired persisted JWT is signed out in `InitializeSessionAsync` so it can't block anon RPC calls.

## 3. Contractor portal login

- **Entry:** `IdEntryViewModel.OpenContractorPortalAsync()` prompts for company code + contractor code → `ResolveContractorByCodeAsync` (RPC `contractor_resolve_by_code`) → `ContractorPortalSessionStore.Save` → `ContractorPortalPage`.
- **Session:** Preferences only (`contractor_id`, `company_id`, codes, name). **No Supabase Auth session.**
- **Surface:** `ContractorPortalViewModel` (job list, open visit) + `ContractorPortalJobDetailViewModel` (site sign-in/out, messages, incidents, photos) via `contractor_portal_*` RPCs.
- **Auth model:** shared-secret codes → anon-granted `SECURITY DEFINER` RPCs. No server session table for contractors.

## 4. Client portal login

- **Entry:** `IdEntryViewModel.OpenClientPortalAsync()` → `ResolveClientByCodeAsync` (RPC `client_resolve_by_code`) → `ClientPortalSessionStore.Save` → `//ClientPortalPage`. (A guest variant opens an external web URL.)
- **Session:** Preferences, with sign-out guards and per-deal message read timestamps. Exit via `ClientPortalNavigation.ExitToLoginAsync` (sets `SuppressAutoLogin`).
- **Surface:** `ClientPortalViewModel` (projects + message inbox) + `ClientPortalProjectDetailViewModel`, via `client_portal_*` RPCs. Private deals (`visibility='private'`) are excluded.

## Session persistence & restore

`IdEntryViewModel.InitializeAsync` runs the restore decision tree on startup (after `App.xaml.cs` kicks off background `Supabase.InitializeAsync()`):

1. Complete any pending client-portal sign-out.
2. Respect `SuppressAutoLogin` (user pressed Back from a dashboard) → stay on login.
3. **JWT session** restored → load employee → company picker / HR dashboard.
4. **Client portal** session → client portal.
5. **Contractor portal** session → contractor portal.
6. **Code session** → `RefreshCodeSessionAsync` → employee/HR dashboard.
7. Authenticated but no employee → `EmployeeLinkCompanyPage`.

| Store | Mechanism | Holds |
|-------|-----------|-------|
| `MauiSupabaseSessionHandler` | Preferences + async SecureStorage | Full Supabase JWT session |
| `CodeSessionStore` | Preferences | company/employee codes + session token |
| `ClientPortalSessionStore` | Preferences | client/company ids + codes + read marks |
| `ContractorPortalSessionStore` | Preferences | contractor/company ids + codes |
| `TimesheetStateService` | in-memory singleton | `CurrentEmployee`, `CurrentCompany`, `LastPunch`, `SuppressAutoLogin` |

## Multi-company membership

A person can belong to several companies (one `employees` row each, sharing `user_id`/code).

- **Model:** `EmployeeMembership` (per-company `RegistrationStatus`, `AccessLevel`, `UsesCompanyDashboard`).
- **Load:** JWT → `employee_get_my_memberships(user_id)`; code → `employee_get_my_memberships_by_code(...)`.
- **Selection:** `EmployeeCompanySelectorViewModel` → `GetEmployeeForCompanyAsync` → set state → route.
- **Routing rule** (`EmployeeAccountRouting`): `UsesCompanyDashboard` (access level in owner/hr_admin/admin/manager) → HR dashboard; otherwise employee dashboard.

## Permissions (summary)

See `security/02-permissions-and-rls.md` for the full matrix. In brief: Owner = all; others load from `my_permissions` RPC with a client-side `PermissionDefaults` fallback. Note the `company_role_permissions` table was dropped in the uuid cutover and not recreated, so production permission enforcement currently leans on the fallback — a documented drift risk.

## Security architecture & why RPC routing exists

- **RLS needs `auth.uid()`.** Code-login/portal users are anon, so they cannot satisfy any table policy. **`SECURITY DEFINER` RPCs** are therefore the only data path for untrusted roles; they validate identity internally and run with definer privileges (`row_security off`).
- **The session token is not a per-request bearer.** Worker RPCs trust client-supplied `(company_id, employee_id)` validated by existence/assignment helpers, not the token. Combined with the publishable anon key, this means **knowledge of valid IDs is sufficient to call worker RPCs** — an accepted trade-off for code-login UX, flagged for hardening (rate limiting, token-bound RPCs) in the roadmap.
- **Anon key is publishable** by design (committed in `SupabaseConfig.cs`), overridable via env at build.

### Anon vs authenticated behavior

| Capability | Authenticated (HR/JWT) | Anon (code/portal) |
|------------|------------------------|--------------------|
| Read own employee row | PostgREST + RLS | RPC only |
| Company data (jobs, punches) | PostgREST + RLS | `employee_*` RPCs with explicit IDs |
| Permissions | `my_permissions` RPC | `PermissionDefaults` fallback |
| Client/contractor data | HR via PostgREST | Portal RPCs with codes |
| Realtime | Authenticated subscriptions | Account/company channels where applicable |
| Telemetry | Direct `app_events` insert | `employee_log_app_event` RPC |

---

_Next: per-module docs in `modules/`, or `workflows/01-core-workflows.md` for end-to-end flows._
