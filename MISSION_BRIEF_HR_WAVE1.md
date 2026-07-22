# MISSION BRIEF — HR Dashboard Wave 1
## Modules: Overview · My Profile · Messages

**Issued by:** KEES Architect
**Date:** 2026-07-17
**Scope:** HR dashboard — first three modules
**Status:** 1 bug confirmed. Profile and Messages are clean.

---

## Pages Audited

| Page | Path | Result |
|------|------|--------|
| Overview | `/dashboard/overview/page.tsx` | ❌ 1 bug |
| My Profile | `/dashboard/profile/page.tsx` | ✅ Clean |
| Messages | `/dashboard/messages/page.tsx` | ✅ Clean |

---

## DB Verification

- `employee_report_absence` signature confirmed:
  ```
  p_company_id uuid, p_employee_id uuid, p_date date,
  p_reason text, p_note text DEFAULT NULL,
  p_session_token text DEFAULT NULL
  ```
  → `p_session_token` is a real parameter that defaults to NULL. The RPC uses it for auth validation. Passing NULL means the RPC runs without identity verification — a security gap.

---

## Bug 1 — Overview: `markAbsent` missing `p_session_token`

**File:** `kaisync-web/src/app/dashboard/overview/page.tsx`
**Function:** `markAbsent` (line ~212)
**Severity:** Security / Consistency

### Problem

`markAbsent` calls `employee_report_absence` without fetching the session or passing `p_session_token`. Every other RPC call in the codebase passes the token. Missing it means the DB cannot validate the caller's identity.

### Current (broken) code

```ts
async function markAbsent(empId: string) {
  setMarkAbsentLoading(empId)
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]
  const { error: err } = await supabase.rpc('employee_report_absence', {
    p_company_id: companyId,
    p_employee_id: empId,
    p_date: today,
    p_reason: 'absent',
    p_note: null,
  })
  if (err) console.error('mark absent:', err.message)
  setMarkAbsentLoading(null)
  await load()
}
```

### Required fix

```ts
async function markAbsent(empId: string) {
  setMarkAbsentLoading(empId)
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const today = new Date().toISOString().split('T')[0]
  const { error: err } = await supabase.rpc('employee_report_absence', {
    p_company_id:    companyId,
    p_employee_id:   empId,
    p_date:          today,
    p_reason:        'absent',
    p_note:          null,
    p_session_token: session?.access_token ?? null,
  })
  if (err) console.error('mark absent:', err.message)
  setMarkAbsentLoading(null)
  await load()
}
```

**Change summary:** Add `const { data: { session } } = await supabase.auth.getSession()` before the RPC call, then add `p_session_token: session?.access_token ?? null` to the params object.

---

## Clean Pages — No Action Required

### My Profile (`/dashboard/profile/page.tsx`)
- `employee_update_profile` called with session token in both the photo upload and save flows ✅
- Profile photo stored as raw path, displayed via `createSignedUrl` ✅
- Reads `emp.name` and `emp.surname` (correct column names) ✅

### Messages (`/dashboard/messages/page.tsx`)
- All 7 session token call sites verified clean (fixed in Wave 8) ✅
- `loadThreads`, `selectThread`, `reloadMessages`, `sendMessage`, `startDM` — all pass `p_session_token` ✅

---

## Engineer Checklist

- [ ] **`/dashboard/overview/page.tsx`** — `markAbsent`: fetch session, add `p_session_token` to RPC params (1 line fetch + 1 line param)

No migrations required. No schema changes. Single file, single function.
