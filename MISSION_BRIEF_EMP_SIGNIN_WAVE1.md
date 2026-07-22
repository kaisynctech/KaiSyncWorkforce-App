# MISSION BRIEF — Employee Sign-In Wave 1
## Module: `/auth/id-entry/page.tsx` + `resolve-company.ts`

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Files changed:**
- `kaisync-web/src/app/auth/id-entry/page.tsx`
- `kaisync-web/src/lib/supabase/resolve-company.ts`
- `kaisync-web/src/app/auth/hr-sign-in/page.tsx` (1-line fix, incidental)

**No migrations required.**

---

## Issues Found

| # | Issue | Severity |
|---|-------|----------|
| 1 | Input text invisible on desktop (low contrast) | Critical — UX |
| 2 | Login always fails — calls non-existent RPC | Critical — Functional |
| 2b | Code login creates no Supabase session — employee portal inaccessible after login | Critical — Architectural |
| 3 | No email sign-in option for employees (MAUI has Login code / Email tab) | Feature parity |

---

## Root Cause Analysis

### Bug 1 — Input text invisible

The right panel div on both `id-entry` and `hr-sign-in` uses:

```tsx
className="... bg-[#0f172a] lg:bg-background"
```

On desktop (`lg:`), `bg-background` switches to the CSS theme variable. In a light theme this becomes white/near-white. But all inputs use hardcoded dark-mode colors:

- `text-white` — invisible on white background
- `backgroundColor: 'rgba(255,255,255,0.06)'` — near-transparent on white = white input box

The auth pages are fully dark-themed and must stay dark on all screen sizes.

---

### Bug 2 — Login fails with "Invalid company or portal code"

`handleSubmit` calls RPC `authenticate_portal_code` — **this function does not exist in the database**.

DB verification — available employee auth RPCs:
```
employee_sign_in_with_code(p_company_code text, p_employee_code text)
employee_sign_in_with_pin(p_company_code text, p_employee_id uuid, p_pin text)
```

MAUI source (`EmployeeLoginViewModel.cs` line 87–88) confirms:
```csharp
var session = await _storage.SignInWithCodeAsync(
    CompanyCode.Trim().ToUpperInvariant(),
    EmployeeCode.Trim());
```
→ `p_company_code` and `p_employee_code` are the correct parameter names.

The field label in the web currently says "Portal Code". MAUI labels it **"Login Code"**. Fix the label too.

---

### Bug 2b — No session after code login

`employee_sign_in_with_code` does NOT create a Supabase JWT. It returns a custom `session_token` stored in `employee_code_sessions`. After calling this RPC and pushing to the dashboard, `resolveCurrentMember` calls `supabase.auth.getUser()` which returns null → the entire employee portal shows nothing.

The RPC returns:
```json
{
  "session_token": "<custom token>",
  "needs_pin_setup": false,
  "employee": {
    "id": "<uuid>",
    "company_id": "<uuid>",
    "name": "...",
    "surname": "...",
    ...
  },
  "company": { "id": "...", "code": "...", "name": "..." }
}
```

Fix: after successful code login, persist this to `localStorage` under key `kf_cs`, then update `resolveCurrentMember` to check `localStorage` as a fallback when no Supabase user exists.

**Known limitation of this approach:** The employee portal pages derive `p_session_token` from `supabase.auth.getSession().access_token`. For code-authenticated employees this will be `null`. All RPCs accept `p_session_token DEFAULT NULL`, so they will execute — but without token-level identity validation. A follow-up wave should update `resolveCurrentMember` to return the `session_token` and propagate it through all employee portal RPCs.

---

### Bug 3 — Missing email sign-in tab

MAUI has two tabs: **Login code** (CompanyCode + EmployeeCode) and **Email** (email + password).

The web only has the code form. Employees who sign in via email use `supabase.auth.signInWithPassword` (same mechanism as HR). After email sign-in, redirect to `/dashboard/employee/attendance`.

---

## Also: Wrong post-login redirect

Current code: `router.push('/dashboard/overview')` — this is the **HR** dashboard.  
Employees must redirect to: **`/dashboard/employee/attendance`**

---

## Fix Instructions

### File 1 — `kaisync-web/src/app/auth/id-entry/page.tsx`

#### Change A — Lock right panel to dark background (line 90)

**Current:**
```tsx
<div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a] lg:bg-background">
```

**Required:**
```tsx
<div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a]">
```

#### Change B — Remove vestigial `lg:` text-color overrides (lines 107–108)

**Current:**
```tsx
<h1 className="text-[26px] font-bold text-white lg:text-text-primary">Welcome back</h1>
<p className="text-slate-400 lg:text-text-secondary text-[14px] mt-1">Select your portal to continue</p>
```

**Required:**
```tsx
<h1 className="text-[26px] font-bold text-white">Welcome back</h1>
<p className="text-slate-400 text-[14px] mt-1">Select your portal to continue</p>
```

#### Change C — Fix employee step heading (line 199)

**Current:**
```tsx
<h1 className="text-[22px] font-bold text-white lg:text-text-primary">Employee sign in</h1>
```

**Required:**
```tsx
<h1 className="text-[22px] font-bold text-white">Employee sign in</h1>
```

#### Change D — Rename "Portal Code" to "Login Code" (line 230 label + line 219 placeholder)

**Current:**
```tsx
<label className="block text-[12px] font-medium text-slate-400 mb-2">Portal Code</label>
```

```tsx
placeholder="Enter your portal code"
```

**Required:**
```tsx
<label className="block text-[12px] font-medium text-slate-400 mb-2">Login Code</label>
```

```tsx
placeholder="Enter your login code"
```

#### Change E — Fix the RPC call and post-login storage (replace `handleSubmit` entirely)

**Current `handleSubmit`:**
```ts
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  if (!companyCode.trim() || !portalCode.trim()) return
  setLoading(true)
  setError(null)
  try {
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('authenticate_portal_code', {
      p_company_code: companyCode.trim().toUpperCase(),
      p_portal_code: portalCode.trim(),
    })
    if (rpcError) throw rpcError
    if (!data) throw new Error('Invalid credentials')
    router.push('/dashboard/overview')
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Invalid company or portal code')
  } finally {
    setLoading(false)
  }
}
```

**Required:**
```ts
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  if (!companyCode.trim() || !portalCode.trim()) return
  setLoading(true)
  setError(null)
  try {
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('employee_sign_in_with_code', {
      p_company_code: companyCode.trim().toUpperCase(),
      p_employee_code: portalCode.trim(),
    })
    if (rpcError) throw rpcError
    if (!data) throw new Error('Invalid company code or login code')

    // Persist code session for resolveCurrentMember fallback
    localStorage.setItem('kf_cs', JSON.stringify({
      session_token: data.session_token,
      employee_id: data.employee?.id,
      company_id: data.employee?.company_id,
    }))

    router.push('/dashboard/employee/attendance')
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Invalid company code or login code')
  } finally {
    setLoading(false)
  }
}
```

#### Change F — Add email tab toggle and email sign-in form

**Add to state declarations (after `const [error, setError] = useState...`):**
```ts
const [authMethod, setAuthMethod] = useState<'code' | 'email'>('code')
const [email, setEmail] = useState('')
const [emailPassword, setEmailPassword] = useState('')
```

**Add email sign-in handler (after `handleSubmit`):**
```ts
async function handleEmailSubmit(e: React.FormEvent) {
  e.preventDefault()
  if (!email.trim() || !emailPassword) return
  setLoading(true)
  setError(null)
  try {
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: emailPassword,
    })
    if (signInError) throw signInError
    router.push('/dashboard/employee/attendance')
    router.refresh()
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Invalid email or password')
  } finally {
    setLoading(false)
  }
}
```

**Replace the `step === 'employee'` JSX block entirely with the new tabbed version:**

```tsx
{step === 'employee' && (
  <div className="space-y-6">
    {/* Header */}
    <div className="flex items-center gap-3">
      <button
        onClick={() => { setStep('role'); setError(null) }}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
        style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.12)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}>
        <span className="material-icons text-slate-400 text-[18px]">arrow_back</span>
      </button>
      <div>
        <h1 className="text-[22px] font-bold text-white">Employee sign in</h1>
        <p className="text-slate-400 text-[13px]">
          {authMethod === 'code' ? 'Enter your company and login codes' : 'Sign in with your work email'}
        </p>
      </div>
    </div>

    {/* Method tabs — MAUI parity */}
    <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
      <button
        type="button"
        onClick={() => { setAuthMethod('code'); setError(null) }}
        className="flex-1 h-9 rounded-lg text-[13px] font-medium transition-all"
        style={authMethod === 'code'
          ? { backgroundColor: '#3b82f6', color: '#fff' }
          : { backgroundColor: 'transparent', color: '#94a3b8' }}>
        Login code
      </button>
      <button
        type="button"
        onClick={() => { setAuthMethod('email'); setError(null) }}
        className="flex-1 h-9 rounded-lg text-[13px] font-medium transition-all"
        style={authMethod === 'email'
          ? { backgroundColor: '#3b82f6', color: '#fff' }
          : { backgroundColor: 'transparent', color: '#94a3b8' }}>
        Email
      </button>
    </div>

    {error && (
      <div className="p-3 rounded-xl flex items-center gap-2"
        style={{ backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
        <span className="material-icons text-red-400 text-[18px]">error_outline</span>
        <p className="text-[13px] text-red-400">{error}</p>
      </div>
    )}

    {/* Code sign-in form */}
    {authMethod === 'code' && (
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Company Code</label>
          <input
            type="text"
            value={companyCode}
            onChange={e => setCompanyCode(e.target.value)}
            placeholder="e.g. KAI-001"
            className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            autoCapitalize="characters"
            autoComplete="off"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Login Code</label>
          <input
            type="password"
            value={portalCode}
            onChange={e => setPortalCode(e.target.value)}
            placeholder="Enter your login code"
            className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !companyCode.trim() || !portalCode.trim()}
          className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
          {loading ? 'Signing in...' : 'Sign in with code'}
        </button>
      </form>
    )}

    {/* Email sign-in form */}
    {authMethod === 'email' && (
      <form onSubmit={handleEmailSubmit} className="space-y-4">
        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Email address</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-slate-400 mb-2">Password</label>
          <input
            type="password"
            value={emailPassword}
            onChange={e => setEmailPassword(e.target.value)}
            placeholder="Enter your password"
            required
            className="w-full h-12 px-4 rounded-xl text-[14px] text-white placeholder:text-slate-600 focus:outline-none transition-all"
            style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            onFocus={e => { (e.target as HTMLInputElement).style.borderColor = '#3b82f6'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(59,130,246,0.08)' }}
            onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.1)'; (e.target as HTMLInputElement).style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !email.trim() || !emailPassword}
          className="w-full h-12 rounded-xl text-white text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
          {loading ? 'Signing in...' : 'Sign in with email'}
        </button>
      </form>
    )}

    <p className="text-center text-[13px] text-slate-500">
      HR / Manager?{' '}
      <Link href="/auth/hr-sign-in" className="text-blue-400 font-medium hover:text-blue-300 transition-colors">
        Sign in with email
      </Link>
    </p>
  </div>
)}
```

---

### File 2 — `kaisync-web/src/lib/supabase/resolve-company.ts`

Add `localStorage` fallback so code-authenticated employees can access the portal.

**Full file replacement:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type CurrentMember = {
  employeeId: string
  companyId: string
}

export async function resolveCurrentMember(
  supabase: SupabaseClient
): Promise<CurrentMember | null> {
  // 1. Try Supabase JWT session (email-authenticated users)
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('employees')
      .select('id, company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (data?.company_id) {
      return { employeeId: data.id, companyId: data.company_id }
    }
  }

  // 2. Fallback: code session stored in localStorage after employee_sign_in_with_code
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('kf_cs')
      if (raw) {
        const cs = JSON.parse(raw) as {
          employee_id?: string
          company_id?: string
          session_token?: string
        }
        if (cs.employee_id && cs.company_id) {
          return { employeeId: cs.employee_id, companyId: cs.company_id }
        }
      }
    } catch {
      // corrupt localStorage — ignore
    }
  }

  return null
}
```

---

### File 3 — `kaisync-web/src/app/auth/hr-sign-in/page.tsx` (incidental fix)

Same `lg:bg-background` bug exists here. Single change on line 73:

**Current:**
```tsx
<div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a] lg:bg-background">
```

**Required:**
```tsx
<div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-[#0f172a]">
```

---

## Engineer Checklist

### `id-entry/page.tsx`
- [ ] Remove `lg:bg-background` from right panel div (line 90) → `bg-[#0f172a]` only
- [ ] Remove `lg:text-text-primary` from "Welcome back" heading (line 107)
- [ ] Remove `lg:text-text-secondary` from welcome subtitle (line 108)
- [ ] Remove `lg:text-text-primary` from "Employee sign in" heading (line 199)
- [ ] Rename label "Portal Code" → "Login Code"; update placeholder text
- [ ] Replace `handleSubmit` with corrected version (RPC: `employee_sign_in_with_code`, params: `p_company_code`/`p_employee_code`, store to localStorage, redirect to `/dashboard/employee/attendance`)
- [ ] Add state: `authMethod`, `email`, `emailPassword`
- [ ] Add `handleEmailSubmit` function (`supabase.auth.signInWithPassword`, redirect to `/dashboard/employee/attendance`)
- [ ] Replace employee step JSX with tabbed version (Login code / Email tabs + both forms)

### `resolve-company.ts`
- [ ] Add `localStorage` fallback for `kf_cs` code session (full file replacement above)

### `hr-sign-in/page.tsx`
- [ ] Remove `lg:bg-background` → `bg-[#0f172a]` (line 73)

No migrations required. No schema changes.

---

## Follow-up (Wave 2 — not in this brief)

Code-authenticated employees receive `p_session_token: null` on all RPCs because the portal pages derive the token from `supabase.auth.getSession().access_token` (which is null for code login). A follow-up wave should:
1. Add `sessionToken?: string | null` to `CurrentMember`
2. Return it from the `localStorage` branch of `resolveCurrentMember`
3. Update all employee portal pages to use `member.sessionToken` for `p_session_token` when no JWT session exists
