# MISSION BRIEF — Auth Flow Wave 1
## Full App Authentication Audit

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Files changed:**
- `kaisync-web/src/app/dashboard/layout.tsx`
- `kaisync-web/src/app/auth/id-entry/page.tsx`
- `kaisync-web/src/components/EmployeeSidebar.tsx`

**No migrations required.**

---

## Auth Paths in the App

| User type | Sign-in method | Session type |
|-----------|---------------|--------------|
| HR / Employer | Email + password | Supabase JWT |
| Employee (email) | Email + password | Supabase JWT |
| Employee (code) | Company code + login code | Custom `kf_cs` localStorage token |

---

## Bugs Found

### Bug 1 (Critical) — Code-auth employees locked out of entire dashboard

**File:** `kaisync-web/src/app/dashboard/layout.tsx`

`init()` starts with:
```ts
const { data: { user } } = await supabase.auth.getUser()
if (!user) {
  router.replace('/auth/hr-sign-in')  // ← always fires for code sessions
  return
}
```

Code-authenticated employees have no Supabase JWT. `getUser()` returns null. They are immediately redirected to `/auth/hr-sign-in` — the wrong page. They cannot access any dashboard route.

---

### Bug 2 (Critical) — `kf_cs` doesn't store enough data for the layout

**File:** `kaisync-web/src/app/auth/id-entry/page.tsx`

After code sign-in, the current brief (employee sign-in Wave 1) stores:
```ts
localStorage.setItem('kf_cs', JSON.stringify({
  session_token: data.session_token,
  employee_id:   data.employee?.id,
  company_id:    data.employee?.company_id,
}))
```

The dashboard layout needs `employee.name`, `employee.surname`, `employee.access_level`, and `company.name` to render the header and pick the correct sidebar. A DB query for this would fail (no JWT = no RLS-passing query). The employee + company snapshots must be stored at sign-in time.

The `employee_sign_in_with_code` RPC already returns both objects in full — we just need to persist them.

---

### Bug 3 (Medium) — Employee sign-out doesn't clear code session

**File:** `kaisync-web/src/components/EmployeeSidebar.tsx`

```ts
async function handleSignOut() {
  const supabase = createClient()
  await supabase.auth.signOut()        // ← no-op for code sessions
  router.push('/auth/hr-sign-in')      // ← wrong: employee sent to HR sign-in
  router.refresh()
}
```

For code-authenticated employees:
- `supabase.auth.signOut()` does nothing (no JWT to revoke)
- `localStorage('kf_cs')` is never cleared — session persists after "sign-out"
- User is redirected to the HR login page, not the employee sign-in

---

### Bug 4 (Medium) — Unauthenticated redirect targets wrong page

Both `dashboard/layout.tsx` (line 23) and `EmployeeSidebar.handleSignOut` redirect to `/auth/hr-sign-in`. An unauthenticated user (whether HR or employee) should land on `/auth/id-entry` (the role picker), not the HR-specific sign-in page.

The HR `Sidebar.handleSignOut` correctly redirects to `/auth/hr-sign-in` ✅ — HR users intentionally go back to the HR sign-in.

---

## Fix Instructions

### File 1 — `kaisync-web/src/app/auth/id-entry/page.tsx`

In the code `handleSubmit` function, update the `localStorage.setItem` call to store the full snapshot:

**Current (from employee sign-in Wave 1 brief):**
```ts
localStorage.setItem('kf_cs', JSON.stringify({
  session_token: data.session_token,
  employee_id:   data.employee?.id,
  company_id:    data.employee?.company_id,
}))
```

**Required:**
```ts
localStorage.setItem('kf_cs', JSON.stringify({
  session_token: data.session_token,
  employee_id:   data.employee?.id,
  company_id:    data.employee?.company_id,
  employee: {
    id:           data.employee?.id,
    name:         data.employee?.name,
    surname:      data.employee?.surname,
    access_level: data.employee?.access_level,
    employee_code: data.employee?.employee_code,
    position:     data.employee?.position,
  },
  company: {
    id:   data.company?.id,
    name: data.company?.name,
    code: data.company?.code,
  },
}))
```

---

### File 2 — `kaisync-web/src/app/dashboard/layout.tsx`

Replace the entire `init` function with a version that falls back to the code session:

**Current:**
```ts
async function init() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    router.replace('/auth/hr-sign-in')
    return
  }

  const { data: emp } = await supabase
    .from('employees')
    .select('*, companies(*)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (emp) {
    setEmployee(emp as Employee)
    setCompany((emp as { companies: Company }).companies)
  }
  setLoading(false)
}
```

**Required:**
```ts
async function init() {
  const supabase = createClient()

  // ── Path 1: Supabase JWT session (HR users + email-auth employees) ──
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: emp } = await supabase
      .from('employees')
      .select('*, companies(*)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (emp) {
      setEmployee(emp as Employee)
      setCompany((emp as { companies: Company }).companies)
    }
    setLoading(false)
    return
  }

  // ── Path 2: Code session (code-authenticated employees) ──
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('kf_cs') : null
    if (raw) {
      const cs = JSON.parse(raw) as {
        employee?: { id: string; name: string; surname: string; access_level: string; employee_code?: string; position?: string }
        company?:  { id: string; name: string; code: string }
        employee_id?: string
        company_id?: string
      }
      if (cs.employee?.id && cs.company?.id) {
        // Build minimal Employee and Company shapes the layout needs
        setEmployee(cs.employee as unknown as Employee)
        setCompany(cs.company as unknown as Company)
        setLoading(false)
        return
      }
    }
  } catch {
    // Corrupt localStorage — clear and fall through to redirect
    localStorage.removeItem('kf_cs')
  }

  // ── No valid session ──
  router.replace('/auth/id-entry')
  setLoading(false)
}
```

---

### File 3 — `kaisync-web/src/components/EmployeeSidebar.tsx`

Replace `handleSignOut`:

**Current:**
```ts
async function handleSignOut() {
  const supabase = createClient()
  await supabase.auth.signOut()
  router.push('/auth/hr-sign-in')
  router.refresh()
}
```

**Required:**
```ts
async function handleSignOut() {
  const supabase = createClient()
  // Clear JWT session (no-op if code-auth, harmless)
  await supabase.auth.signOut()
  // Clear code session
  localStorage.removeItem('kf_cs')
  router.push('/auth/id-entry')
  router.refresh()
}
```

---

## Auth Flow After These Fixes

### HR sign-in
1. `/auth/hr-sign-in` → `supabase.auth.signInWithPassword` → JWT session
2. `dashboard/layout.tsx` → `getUser()` returns user → queries `employees` by `user_id` → loads HR sidebar
3. Sign-out → `supabase.auth.signOut()` → redirect to `/auth/hr-sign-in` ✅

### Employee code sign-in
1. `/auth/id-entry` (Login code tab) → `employee_sign_in_with_code` → stores full `kf_cs` snapshot
2. Redirect to `/dashboard/employee/attendance`
3. `dashboard/layout.tsx` → `getUser()` returns null → reads `kf_cs` → loads `employee` + `company` from snapshot → renders `EmployeeSidebar`
4. `resolveCurrentMember` → `getUser()` null → reads `kf_cs` → returns `{ employeeId, companyId }` ✅
5. Sign-out → clears `kf_cs` + Supabase session → redirect to `/auth/id-entry` ✅

### Employee email sign-in
1. `/auth/id-entry` (Email tab) → `supabase.auth.signInWithPassword` → JWT session
2. `dashboard/layout.tsx` → `getUser()` returns user → queries `employees` by `user_id` → `access_level = 'employee'` → loads `EmployeeSidebar`
3. Sign-out → clears `kf_cs` (harmless if empty) + JWT → redirect to `/auth/id-entry` ✅

### Unauthenticated access to any dashboard route
- `dashboard/layout.tsx` → no JWT, no `kf_cs` → redirect to `/auth/id-entry` (role picker) ✅

### Incomplete registration (HR user with no company)
- `/auth/hr-sign-in` → JWT auth succeeds → `resolveCurrentMember` returns null → redirect to `/auth/hr-register-company` ✅ (fixed in Registration Wave 1)

---

## Engineer Checklist

### `id-entry/page.tsx`
- [ ] Expand `kf_cs` localStorage payload to include full `employee` and `company` snapshots

### `dashboard/layout.tsx`
- [ ] Replace `init()` with two-path version (JWT first, then `kf_cs` fallback)
- [ ] Change fallback redirect from `/auth/hr-sign-in` → `/auth/id-entry`

### `EmployeeSidebar.tsx`
- [ ] Add `localStorage.removeItem('kf_cs')` to `handleSignOut`
- [ ] Change redirect from `/auth/hr-sign-in` → `/auth/id-entry`

No migrations required. No schema changes.

---

## MAUI Auth Parity Checklist

| MAUI feature | Web status | Notes |
|---|---|---|
| HR email/password sign-in | ✅ | |
| Employee code sign-in (`employee_sign_in_with_code`) | ✅ Fixed | |
| Employee email sign-in | ✅ Added | |
| HR registration flow | ✅ Fixed | |
| JWT session restoration on page load | ✅ | Supabase client handles automatically |
| Code session restoration on page load | ✅ Fixed | `kf_cs` localStorage read in `dashboard/layout.tsx` |
| Sign-out clears code session | ✅ Fixed | `localStorage.removeItem('kf_cs')` |
| Redirect to role picker when unauthenticated | ✅ Fixed | `/auth/id-entry` |
| **PIN setup after first code sign-in** (`needs_pin_setup`) | ⚠️ Not implemented — intentional | MAUI PIN setup is a mobile UX feature. On web, `kf_cs` persists the session so employees don't re-enter codes. PIN entry is already a stub/disabled in MAUI too (`EmployeePinEntryViewModel`: *"PIN authentication is not in use"*). |
| Code session server-side validation on restore | ⚠️ Web trusts localStorage blindly | MAUI calls `RefreshCodeSessionAsync` to validate against `employee_code_sessions`. Web skips this. Low risk; acceptable for now. |
| Multi-company employee selector | ❌ Not implemented | `employee_sign_in_with_code` returns a `memberships` array. MAUI shows a company picker for employees in multiple companies. Web uses single employee record only. Medium gap — affects users in multiple companies. |
| Employee mandatory password setup | ❌ Not checked | MAUI checks `LoginPasswordReady` on email sign-in and routes to password setup if false. Web skips this. |
| Client portal sign-in (code-based) | ❌ Future module | `/client-portal` route not yet built |
| Contractor portal sign-in (code-based) | ❌ Future module | `/contractor-portal` route not yet built |

The three items marked ❌ are deferred, not blocking. The ⚠️ items are acceptable web-vs-mobile differences.
