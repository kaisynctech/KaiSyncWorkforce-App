# MISSION BRIEF — Registration Flow Wave 1
## Full MAUI Parity Audit

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Files changed:**
- `kaisync-web/src/app/auth/hr-register-company/page.tsx` — critical rewrite
- `kaisync-web/src/app/auth/hr-sign-in/page.tsx` — two additions
- `kaisync-web/src/app/auth/hr-register/page.tsx` — minor (password minimum)

**No migrations required.**

---

## MAUI Registration Flow (source of truth)

| Step | MAUI Page | Web Page | Status |
|------|-----------|----------|--------|
| 1 | `HrRegisterPage` — email + password | `hr-register/page.tsx` | ⚠️ Minor diff |
| 2 | `HrRegisterVerifyCodePage` — 6-digit OTP entry | `hr-register-verify/page.tsx` — static "check email" | ✅ Acceptable for web |
| 3 | `HrRegisterCompanyDetailsPage` — company + owner name + role | `hr-register-company/page.tsx` | ❌ Critical bugs |
| 4 | `HrRegistrationSuccessPage` — company code display | **Missing entirely** | ❌ Critical gap |

---

## Bugs and Gaps

### Bug 1 (Critical) — Company creation always fails

`hr-register-company` does `supabase.from('companies').insert({ ..., industry, size_range })`:
- `industry` and `size_range` columns do not exist on `companies`
- `code` and `plan_code` are NOT NULL with no defaults
- Insert fails with a DB error on every single attempt

**Fix:** Call `self_register_company(p_company_name, p_owner_first_name, p_owner_last_name, p_role)`.

---

### Bug 2 (Critical) — Owner name fields missing

MAUI `HrRegisterCompanyDetailsViewModel` has:
```csharp
[ObservableProperty] private string _ownerFirstName = "";
[ObservableProperty] private string _ownerLastName  = "";
```
`OwnerFirstName` is **required** — MAUI shows `"Your first name is required."` if blank.

The web form has no name fields. `self_register_company` uses these to create the owner's employee record. Without them the RPC falls back to the email prefix as the name.

**Fix:** Add `OwnerFirstName` (required) and `OwnerLastName` (optional) fields to the company setup form. Pre-populate from `user.user_metadata.full_name` (set in step 1).

---

### Bug 3 (Critical) — No success page / company code never shown

MAUI `HrRegistrationSuccessViewModel`:
```csharp
[QueryProperty(nameof(CompanyName), "CompanyName")]
[QueryProperty(nameof(CompanyCode), "CompanyCode")]

[RelayCommand]
private async Task CopyCodeAsync()
    => await Clipboard.Default.SetTextAsync(CompanyCode);
```

After `self_register_company` the RPC returns `(company_id, company_code)`. MAUI shows a dedicated success screen with the company code prominently and a copy-to-clipboard button. The HR user needs this code to share with employees for login.

The web currently goes straight to `router.push('/dashboard/overview')` — the company code is never displayed.

**Fix:** After successful RPC, show an inline success state (no new route needed) with the company name, company code, a copy button, and a "Go to Dashboard" button.

---

### Bug 4 — Role toggle missing

MAUI has `IsOwner` (default true) / `IsHrAdmin` radio toggle. This maps to `p_role = 'owner'` or `'hr_admin'` in the RPC.

**Fix:** Add Owner / HR Admin toggle to the form. Default to Owner.

---

### Bug 5 — `hr-sign-in` missing password toggle

MAUI `HrSignInViewModel` has `ShowPassword` toggle (`ToggleShowPassword` command). The web HR sign-in page has no show/hide password button.

**Fix:** Add show/hide password button (same pattern as the one already in `id-entry`'s email tab).

---

### Bug 6 — `hr-sign-in` missing resume-registration flow

MAUI `SignInAsync`:
```csharp
if (employee == null && await _storage.IsAuthenticatedAsync()) {
    var hasCompany = await _storage.HasCompanyAsync();
    if (!hasCompany) {
        await ShellNavigation.GoToAsync(nameof(HrRegisterCompanyDetailsPage));
        return;
    }
}
```

If a user started registration but didn't finish the company step, MAUI resumes them at company details on next sign-in. The web shows "Invalid credentials" instead (since `resolveCurrentMember` returns null if no employee record exists, but the user IS authenticated).

**Fix:** After `signInWithPassword` succeeds but `resolveCurrentMember` returns null → redirect to `/auth/hr-register-company` to resume company setup.

---

### Minor — Password minimum mismatch

MAUI requires **6 characters**. Web requires **8 characters**. Web being stricter is not a functional bug but does cause friction for MAUI users whose passwords are 6–7 chars. Update web minimum to 6 to match.

---

## Fix Instructions

### File 1 — `kaisync-web/src/app/auth/hr-register/page.tsx`

Single change: password minimum from `8` to `6`.

**Current (line 23):**
```ts
if (password.length < 8) {
  setError('Password must be at least 8 characters')
```

**Required:**
```ts
if (password.length < 6) {
  setError('Password must be at least 6 characters')
```

---

### File 2 — `kaisync-web/src/app/auth/hr-register-company/page.tsx`

**Full file replacement:**

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Step = 'form' | 'success'

export default function HrRegisterCompanyPage() {
  const router = useRouter()

  const [step, setStep]               = useState<Step>('form')
  const [companyName, setCompanyName] = useState('')
  const [firstName, setFirstName]     = useState('')
  const [lastName, setLastName]       = useState('')
  const [role, setRole]               = useState<'owner' | 'hr_admin'>('owner')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)

  // Success state
  const [returnedCompanyName, setReturnedCompanyName] = useState('')
  const [companyCode, setCompanyCode]                 = useState('')
  const [copied, setCopied]                           = useState(false)

  // Pre-populate name from step 1 user_metadata
  useEffect(() => {
    async function prefill() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const fullName = (user.user_metadata?.full_name as string | undefined) ?? ''
      const parts = fullName.trim().split(' ')
      setFirstName(parts[0] ?? '')
      setLastName(parts.slice(1).join(' '))
    }
    prefill()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!companyName.trim()) {
      setError('Company name is required.')
      return
    }
    if (!firstName.trim()) {
      setError('Your first name is required.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated. Please verify your email first.')

      const { data, error: rpcError } = await supabase.rpc('self_register_company', {
        p_company_name:     companyName.trim(),
        p_owner_first_name: firstName.trim(),
        p_owner_last_name:  lastName.trim(),
        p_role:             role,
      })
      if (rpcError) throw rpcError
      if (!data || !data[0]) throw new Error('Company creation failed — no data returned.')

      // Show success screen with company code
      setReturnedCompanyName(companyName.trim())
      setCompanyCode(data[0].company_code)
      setStep('success')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create company')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(companyCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select text
    }
  }

  // ── Success screen ──
  if (step === 'success') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider text-center">
          <div className="w-16 h-16 rounded-full bg-success-dark flex items-center justify-center mx-auto mb-5">
            <span className="material-icons text-success text-3xl">check_circle</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary mb-1">Welcome to KaiSync!</h1>
          <p className="text-[14px] text-text-secondary mb-6">{returnedCompanyName} is ready.</p>

          <div className="bg-background rounded-xl p-4 mb-6">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide mb-2">
              Your Company Code
            </p>
            <p className="text-[32px] font-bold text-text-primary tracking-widest mb-3">
              {companyCode}
            </p>
            <p className="text-[12px] text-text-secondary mb-3">
              Share this code with your employees so they can sign in.
            </p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-primary/10 text-primary text-[13px] font-medium hover:bg-primary/20 transition-colors"
            >
              <span className="material-icons text-[16px]">{copied ? 'check' : 'content_copy'}</span>
              {copied ? 'Copied!' : 'Copy code'}
            </button>
          </div>

          <button
            onClick={() => { router.push('/dashboard/overview'); router.refresh() }}
            className="w-full h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Form screen ──
  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface rounded-lg p-8 shadow-sm border border-divider">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-xl bg-primary flex items-center justify-center mb-4">
            <span className="material-icons text-white text-3xl">domain_add</span>
          </div>
          <h1 className="text-[22px] font-semibold text-text-primary">Set up your company</h1>
          <p className="text-[13px] text-text-secondary mt-1">Step 2 of 2 — Company details</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-dark rounded-md flex items-center gap-2">
            <span className="material-icons text-error text-[18px]">error_outline</span>
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">

          {/* Company name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Company name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* First name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Your first name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Jane"
              required
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Last name */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-1.5">
              Your last name
            </label>
            <input
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Smith"
              className="w-full h-11 px-3 rounded-md border border-border bg-surface text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            />
          </div>

          {/* Role toggle — MAUI parity */}
          <div>
            <label className="block text-[12px] font-medium text-text-secondary mb-2">
              Your role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([['owner', 'Owner'], ['hr_admin', 'HR Admin']] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setRole(val)}
                  className="h-10 rounded-md border text-[13px] font-medium transition-colors"
                  style={role === val
                    ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' }
                    : { backgroundColor: 'transparent', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !companyName.trim() || !firstName.trim()}
            className="h-11 rounded-md bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {loading ? 'Creating company…' : 'Create Company'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

---

### File 3 — `kaisync-web/src/app/auth/hr-sign-in/page.tsx`

#### Change A — Add show/hide password toggle

**Current password input (lines 124–138):**
```tsx
<div>
  <label ...>Password</label>
  <div className="relative">
    <input
      type={showPassword ? 'text' : 'password'}
      ...
    />
    <button type="button" onClick={() => setShowPassword(v => !v)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
      <span className="material-icons text-[20px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
    </button>
  </div>
</div>
```

The toggle is already in the file — **verify it is rendering correctly**. If `showPassword` state isn't declared, add it:

```ts
const [showPassword, setShowPassword] = useState(false)
```

#### Change B — Resume incomplete registration after sign-in

After `signInWithPassword` succeeds, check if `resolveCurrentMember` returns null (authenticated but no employee record = incomplete registration). If so, redirect to company setup instead of showing an error.

Add this import at top:
```ts
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
```

Replace `handleSubmit`:

```ts
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  setLoading(true)
  setError(null)
  try {
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) throw signInError

    // Check if employee record exists (incomplete registration = no employee row yet)
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      // Authenticated but no company set up yet — resume registration
      router.push('/auth/hr-register-company')
      return
    }

    router.push('/dashboard/overview')
    router.refresh()
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Invalid email or password')
  } finally {
    setLoading(false)
  }
}
```

---

## Engineer Checklist

### `hr-register/page.tsx`
- [ ] Change password minimum from `8` to `6` characters

### `hr-register-company/page.tsx`
- [ ] Replace entire file with the version above
- [ ] Verify: after submit, success screen shows company code
- [ ] Verify: copy button works
- [ ] Verify: "Go to Dashboard" lands on `/dashboard/overview` with HR user's name visible

### `hr-sign-in/page.tsx`
- [ ] Confirm `showPassword` state and toggle button are present (already in file per previous audit — verify)
- [ ] Add `resolveCurrentMember` import
- [ ] Replace `handleSubmit` with resume-registration version

No migrations required. No schema changes.

---

## MAUI Parity Checklist

| MAUI feature | Web status after this brief |
|---|---|
| Email + password registration | ✅ |
| Email verification before company setup | ✅ (link-based, acceptable for web) |
| Company name field | ✅ |
| Owner first name (required) | ✅ |
| Owner last name (optional) | ✅ |
| Owner / HR Admin role toggle | ✅ |
| `self_register_company` RPC | ✅ |
| Success screen with company code | ✅ |
| Copy company code to clipboard | ✅ |
| Resume incomplete registration on sign-in | ✅ |
| Show/hide password on sign-in | ✅ (already in file) |
| Password minimum 6 chars | ✅ |
