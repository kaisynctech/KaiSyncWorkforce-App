# MISSION BRIEF — Dashboard Fix
**Scope:** Employee portal Dashboard page only  
**Files:** 2  
**Status:** READY TO IMPLEMENT

---

## Background

The employee Dashboard (`/dashboard/employee/overview`) shows "Loading…" permanently. Every other individual employee page (Attendance, Incidents, Jobs, etc.) either loads or at minimum shows an error message — they all reach `setLoading(false)`. The Dashboard never does.

Root cause: `init()` in `overview/page.tsx` has **no try/catch around the Promise.all or the result-processing code that follows it**. If anything throws — a network error, an unexpected return value, a `TypeError` on `.data` — the function exits silently and `setLoading(false)` is never called, leaving the page permanently on "Loading…".

Additionally, the Employee sidebar links "My Profile" to `/dashboard/profile`, but the middleware only exempts `/dashboard/employee/*` and `/dashboard/messages` from the JWT check for code-auth employees. `/dashboard/profile` is not exempted, so code-auth employees are redirected to `/auth/id-entry` when they click My Profile.

---

## Root Cause Detail — overview/page.tsx

### Issue 1 — No try/catch around Promise.all (PRIMARY)

`init()` at lines 152–242 has this structure:

```
resolveCurrentMember()       // guarded: returns early if null ✅
compute tok                  // fine ✅
await Promise.all([8 calls]) // NO try/catch ❌
process 8 results            // NO try/catch ❌
colleagues try/catch         // has its own try/catch ✅
setLoading(false)            // NEVER reached if anything above throws ❌
```

If Promise.all rejects, or if any of the 8 result lines throws (e.g. `regRes.data` is `undefined` because a direct table query returned an unexpected value), execution jumps out of `init()` with an uncaught exception and `setLoading(false)` is never called.

### Issue 2 — Direct table query inside Promise.all (CONTRIBUTING)

Line 187 inside the Promise.all:
```ts
supabase.from('employees').select('registration_status').eq('id', member.employeeId).maybeSingle(),
```

This direct table query is **always `{data: null, error: null}` for code-auth employees** because the RLS `employees_select` policy requires `company_id = ANY(user_company_ids()) OR user_id = auth.uid()` — both false without a JWT. It never returns useful data. It is the only non-RPC call inside the Promise.all and the most likely candidate for returning `undefined` under network error conditions, which causes `regRes.data` at line 217 to throw.

**Remove it from the Promise.all entirely.** The `registrationStatus` state it feeds is always `null` for code-auth employees. For JWT employees it can be fetched separately after the main data.

### Issue 3 — Colleagues query also blocks setLoading (SECONDARY)

Lines 229–239 — the colleagues query — runs sequentially AFTER the Promise.all, inside its own try/catch. However, `supabase.from('leave_requests')...` is also a direct table query. Under certain network/RLS conditions it could hang rather than throw, in which case the `await` would block indefinitely and `setLoading(false)` at line 241 would still never be reached.

**Guard it to only run for JWT employees** (code-auth employees can't read `leave_requests` directly via RLS anyway).

---

## Root Cause Detail — proxy.ts

Line in the current code:
```ts
if (pathname.startsWith('/dashboard/employee') || pathname.startsWith('/dashboard/messages')) {
```

`/dashboard/profile` is NOT in this list. Code-auth employees are redirected to `/auth/id-entry` when clicking My Profile.

The profile page **exists** at `src/app/dashboard/profile/page.tsx`. It just needs the middleware exemption.

---

## Changes Required

### FILE 1 — `kaisync-web/src/app/dashboard/employee/overview/page.tsx`

#### Change 1 — Add `initError` state (after line 97, the `loading` state)

```ts
const [initError, setInitError] = useState(false)
```

#### Change 2 — Reset error flag at top of init()

At line 153, after `setLoading(true)`, add:
```ts
setInitError(false)
```

So:
```ts
async function init() {
  setLoading(true)
  setInitError(false)           // ← ADD THIS
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) { setLoading(false); return }
```

#### Change 3 — Wrap everything after member-resolve in try/catch/finally

The entire block from `empIdRef.current = member.employeeId` down to `setLoading(false)` (lines 158–241) must be wrapped like this:

```ts
  empIdRef.current     = member.employeeId
  companyIdRef.current = member.companyId

  const tok = member.sessionToken
    ?? (await supabase.auth.getSession()).data.session?.access_token
    ?? null
  tokRef.current = tok

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = supabase.rpc as any
    const todayStr = new Date().toISOString().split('T')[0]

    const [
      lastPunchRes, jobsRes, leaveRes,
      onLeaveRes, incRes, punchesRes,
      paRes,                             // ← was index 7, now index 6 (regRes removed)
    ] = await Promise.all([
      rpc('employee_get_last_punch', { p_employee_id: member.employeeId, p_session_token: tok }),
      rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_get_leave_requests', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_is_on_leave_today', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_get_own_incidents', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_get_my_punches', {
        p_company_id:    member.companyId,
        p_employee_id:   member.employeeId,
        p_from:          todayStr,
        p_to:            todayStr,
        p_session_token: tok,
      }),
      rpc('employee_get_pa_tasks', { p_company_id: member.companyId, p_employee_id: member.employeeId, p_session_token: tok }),
    ])
    // NOTE: supabase.from('employees') REMOVED from Promise.all — always null for code-auth (RLS-blocked)

    // Last punch
    const lp = lastPunchRes.data as LastPunch | null
    setLastPunch(lp)

    if (lp?.type === 'in') {
      setIsClockedIn(true)
      clockInTimeRef.current = lp.date_time
      baseElapsedRef.current = 0
      setElapsedMs(Date.now() - new Date(lp.date_time).getTime())
      const punchDate = lp.date_time.split('T')[0]
      if (punchDate < todayStr) {
        setHasMissedSignOut(true)
      }
    } else {
      setIsClockedIn(false)
      clockInTimeRef.current = null
      baseElapsedRef.current = 0
      setElapsedMs(0)
    }

    setJobs((jobsRes.data as Job[]) ?? [])
    setLeaveRequests((leaveRes.data as LeaveRequest[]) ?? [])
    setIsOnLeave(onLeaveRes.data === true || (Array.isArray(onLeaveRes.data) && onLeaveRes.data?.[0]?.is_on_leave === true))
    setIncidents((incRes.data as Incident[]) ?? [])
    setPunchesToday(((punchesRes.data as unknown[] | null) ?? []).length)
    setRegStatus(null)   // ← always null for code-auth; JWT employees: could query separately if needed

    // PA tasks: due today, not done/snoozed
    const allTasks = (paRes.data as PATask[]) ?? []
    const todayTasks = allTasks.filter(t =>
      t.status !== 'done' && t.status !== 'snoozed' &&
      (!t.due_at || t.due_at.split('T')[0] === todayStr)
    )
    setPATasks(todayTasks)

    // Colleagues on leave — only for JWT employees (code-auth can't read leave_requests directly)
    if (member.sessionToken === null) {
      try {
        const { data: colleaguesData } = await supabase
          .from('leave_requests')
          .select('employee_id, leave_type, end_date, employees!inner(name, surname)')
          .eq('company_id', member.companyId)
          .eq('status', 'approved')
          .lte('start_date', todayStr)
          .gte('end_date', todayStr)
          .neq('employee_id', member.employeeId)
          .limit(10)
        setColleagues((colleaguesData as unknown as ColleagueOnLeave[]) ?? [])
      } catch { /* non-critical */ }
    }

  } catch (e) {
    console.error('[Dashboard] init failed:', e)
    setInitError(true)
  } finally {
    setLoading(false)
  }
}
```

**Key changes from current code:**
- `regRes` destructuring removed (was index 6 in the array, `supabase.from('employees')...`)
- Array now has 7 elements instead of 8; `paRes` is now index 6
- `setRegStatus(null)` replaces `setRegStatus((regRes.data as RegistrationStatus | null)?.registration_status ?? null)`
- The `RegistrationStatus` interface at lines 57–59 can be removed (no longer used)
- Colleagues query wrapped in `if (member.sessionToken === null)` — only runs for JWT employees
- Entire block wrapped in `try { ... } catch (e) { ... } finally { setLoading(false) }`

#### Change 4 — Show error state in the render

Replace the current loading check (around line 359):

```ts
if (loading) return (
  <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
)
```

With:

```ts
if (loading) return (
  <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
)

if (initError) return (
  <div className="flex flex-col items-center justify-center h-64 gap-3">
    <span className="material-icons text-[48px] text-text-disabled">error_outline</span>
    <p className="text-[14px] text-text-secondary">Failed to load dashboard. Please refresh.</p>
    <button
      onClick={() => init()}
      className="text-[13px] font-semibold text-primary hover:underline"
    >
      Try again
    </button>
  </div>
)
```

---

### FILE 2 — `kaisync-web/src/proxy.ts`

Find this line (inside the code-auth exemption block):

```ts
if (pathname.startsWith('/dashboard/employee') || pathname.startsWith('/dashboard/messages')) {
```

Replace with:

```ts
if (pathname.startsWith('/dashboard/employee') || pathname.startsWith('/dashboard/messages') || pathname.startsWith('/dashboard/profile')) {
```

That is the only change needed in this file.

---

## Checklist

- [ ] `overview/page.tsx` — add `initError` state declaration
- [ ] `overview/page.tsx` — add `setInitError(false)` at top of `init()`
- [ ] `overview/page.tsx` — remove `supabase.from('employees')...` from Promise.all (drop from 8-item array to 7-item array)
- [ ] `overview/page.tsx` — rename `paRes` (was index 7, now index 6 in the destructure)
- [ ] `overview/page.tsx` — replace `setRegStatus(regRes.data...)` with `setRegStatus(null)`
- [ ] `overview/page.tsx` — remove `RegistrationStatus` interface (no longer referenced)
- [ ] `overview/page.tsx` — wrap colleagues query in `if (member.sessionToken === null)` guard
- [ ] `overview/page.tsx` — wrap entire main init body in `try { } catch (e) { setInitError(true) } finally { setLoading(false) }`
- [ ] `overview/page.tsx` — add `initError` render block after the `loading` check
- [ ] `proxy.ts` — add `|| pathname.startsWith('/dashboard/profile')` to code-auth exemption

---

## Verification

After deploying:

1. Log in as code-auth employee (company code `28`, ID number `FN211956`)
2. Navigate to **Dashboard** — must render in under 5 seconds, clock widget visible, no "Loading…" spinner
3. If dashboard shows "Failed to load dashboard. Please refresh." — click Try Again and check browser console for the logged error (line: `console.error('[Dashboard] init failed:', e)`) — report the error message
4. Click **My Profile** in sidebar — must open the profile page, NOT redirect to login

---

## What Is NOT in This Brief

This brief covers **only the Dashboard** and the My Profile middleware fix. The following remain for subsequent briefs:
- My Jobs showing empty (data confirmed in DB — separate investigation needed)
- My PA "Failed to load tasks"
- My Shifts "Failed to load shifts"
- My Payslips empty
- My Incidents empty
- Forms crash
- Notifications page (wrong session token pattern + direct table query in Promise.all)
