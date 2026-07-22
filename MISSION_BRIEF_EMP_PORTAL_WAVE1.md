# MISSION BRIEF — Employee Portal Wave 1
## Full Audit: All Employee Pages

**Issued by:** KEES Architect  
**Date:** 2026-07-17  
**Priority:** CRITICAL — majority of employee portal is non-functional for code-auth users  
**Pages audited:**
- `kaisync-web/src/app/dashboard/employee/overview/page.tsx`
- `kaisync-web/src/app/dashboard/employee/jobs/page.tsx`
- `kaisync-web/src/app/dashboard/employee/pa/page.tsx`
- `kaisync-web/src/app/dashboard/employee/shifts/page.tsx`
- `kaisync-web/src/app/dashboard/employee/leave/page.tsx`
- `kaisync-web/src/app/dashboard/employee/attendance/page.tsx`
- `kaisync-web/src/app/dashboard/employee/incidents/page.tsx`
- `kaisync-web/src/app/dashboard/employee/payslips/page.tsx`
- `kaisync-web/src/app/dashboard/employee/forms/page.tsx`
- `kaisync-web/src/app/dashboard/employee/forms/[id]/page.tsx`
- `kaisync-web/src/app/dashboard/messages/page.tsx`
- `kaisync-web/src/lib/supabase/resolve-company.ts`

**MAUI source files consulted:**
- `KaiFlow.Timesheets.Maui/ViewModels/Employee/EmployeeDashboardViewModel.cs`
- `KaiFlow.Timesheets.Maui/ViewModels/Employee/MyJobsViewModel.cs` (not read — not needed; bugs are auth, not logic)
- `KaiFlow.Timesheets.Maui/ViewModels/Employee/MyPaSectionViewModel.cs`

---

## Summary

Every employee portal page is broken for code-auth employees (those who sign in with a company code + employee code rather than email/password). **Two root causes account for 90% of all failures.** Fix these two things and nearly everything starts working.

---

## ROOT CAUSE 1 — `resolveCurrentMember` Does Not Return `session_token`

**File:** `kaisync-web/src/lib/supabase/resolve-company.ts`

This function reads `kf_cs` from localStorage and returns `{employeeId, companyId}`. It discards `session_token` from the stored object.

Every employee page then does:

```ts
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null
```

For code-auth employees, `supabase.auth.getSession()` returns `null` — they have no Supabase JWT. So `tok = null`. Every RPC call in every page receives `p_session_token: null`.

The RPCs validate the caller via the session token. With a null token they return empty results or raise permission errors. This is why:

- Dashboard shows no data (jobs, leave, incidents, PA tasks all null)
- My Jobs shows "no jobs" (jobs exist)
- My PA shows "failed to load task"
- My Shifts shows "failed to load shift"
- My Attendance shows "no attendance records"
- My Incidents shows "no incidents"
- My Payslips shows "no payslips"
- My Leave (loads because the RPC may be more lenient — verify)

The `kf_cs` object stored in localStorage by `id-entry/page.tsx` DOES contain `session_token`:

```ts
localStorage.setItem('kf_cs', JSON.stringify({
  session_token: result.session_token,   // ← present but discarded
  employee_id:   result.employee.id,
  company_id:    result.company.id,
  employee:      result.employee,
  company:       result.company,
}))
```

---

### Fix 1A — `resolve-company.ts` — Return `session_token`

**Current `CurrentMember` type:**
```ts
export type CurrentMember = {
  employeeId: string
  companyId: string
}
```

**Required:**
```ts
export type CurrentMember = {
  employeeId:    string
  companyId:     string
  sessionToken:  string | null   // ← add this field
}
```

**Current code-auth return path (lines 32–34):**
```ts
if (cs.employee_id && cs.company_id) {
  return { employeeId: cs.employee_id, companyId: cs.company_id }
}
```

**Required:**
```ts
if (cs.employee_id && cs.company_id) {
  return {
    employeeId:   cs.employee_id,
    companyId:    cs.company_id,
    sessionToken: cs.session_token ?? null,
  }
}
```

**JWT-auth return path (lines 18–20):**
```ts
if (data?.company_id) {
  return { employeeId: data.id, companyId: data.company_id }
}
```

**Required:**
```ts
if (data?.company_id) {
  return {
    employeeId:   data.id,
    companyId:    data.company_id,
    sessionToken: null,   // JWT-auth: use access_token from session instead
  }
}
```

---

### Fix 1B — All Employee Pages — Use `member.sessionToken`

After resolving the member, every page must use `member.sessionToken` as the session token for code-auth users. For JWT-auth users (`sessionToken = null`), it falls back to the JWT access_token.

**Pattern to apply to EVERY employee page:**

**Current pattern (found in overview, jobs, pa, shifts, leave, attendance, incidents, payslips, forms list):**
```ts
const member = await resolveCurrentMember(supabase)
if (!member) { setLoading(false); return }

const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null
```

**Required replacement (copy exactly):**
```ts
const member = await resolveCurrentMember(supabase)
if (!member) { setLoading(false); return }

const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

This one-line change in each page's `init()` / `load()` / `loadEventsFor()` function will fix all RPC calls on that page.

#### Files to change (apply the pattern above):

| File | Function to update |
|---|---|
| `dashboard/employee/overview/page.tsx` | `init()` — line 160–161 |
| `dashboard/employee/jobs/page.tsx` | `init()` — line 60–62 |
| `dashboard/employee/pa/page.tsx` | `init()` — line 344–345 |
| `dashboard/employee/shifts/page.tsx` | `loadEventsFor()` — line 94–95; `respond()` — line 115–116 |
| `dashboard/employee/leave/page.tsx` | `init()` — line 102–103; `submit()` — line 143–144 |
| `dashboard/employee/attendance/page.tsx` | `load()` — line 144–145 |
| `dashboard/employee/incidents/page.tsx` | `init()` — line 78–80 |
| `dashboard/employee/payslips/page.tsx` | `init()` — line 57–58 |
| `dashboard/employee/forms/page.tsx` | `init()` — line 36–37 |
| `dashboard/messages/page.tsx` | `loadThreads()`, `selectThread()`, `reloadMessages()`, `sendMessage()`, `startDM()` — all use `session?.access_token ?? null` |

Also apply in TaskRow (in `pa/page.tsx`): the `token` prop passed to TaskRow comes from `setToken(tok)` — fix the `tok` computation in `init()` and the `token` flows correctly.

**Important note for `pa/page.tsx`:** Currently uses `session?.access_token ?? ''` (empty string, not null). Change to use the `member.sessionToken` pattern above, and pass `null` as fallback (not `''`).

---

## ROOT CAUSE 2 — Messages Route Not Exempted in Middleware

**File:** `kaisync-web/src/proxy.ts`

The messages page lives at `/dashboard/messages`, NOT under `/dashboard/employee/`. The current middleware exempts `/dashboard/employee/*` for code-auth users but does NOT exempt `/dashboard/messages`:

```ts
if (!user && pathname.startsWith('/dashboard')) {
  if (pathname.startsWith('/dashboard/employee')) {
    return supabaseResponse   // ← only employee/* is exempted
  }
  const url = request.nextUrl.clone()
  url.pathname = '/auth/id-entry'
  return NextResponse.redirect(url)   // ← messages hits this line
}
```

Code-auth employees clicking Messages get redirected to `/auth/id-entry`.

---

### Fix 2A — `proxy.ts` — Exempt `/dashboard/messages`

**Current:**
```ts
if (pathname.startsWith('/dashboard/employee')) {
  return supabaseResponse
}
```

**Required:**
```ts
if (pathname.startsWith('/dashboard/employee') || pathname.startsWith('/dashboard/messages')) {
  return supabaseResponse
}
```

---

### Fix 2B — `messages/page.tsx` — Replace Direct Queries with RPCs

Even after fixing the middleware, the messages page makes direct Supabase table queries that are blocked by RLS for code-auth users (no JWT = `auth.uid()` is null):

#### Direct query 1 — Get own name (line 83–85)
```ts
const { data: me } = await supabase
  .from('employees').select('name, surname')
  .eq('id', member.employeeId).single()
if (me) setMyName(`${me.name} ${me.surname}`)
```

**Fix:** Replace with an RPC. If no RPC exists for this, call `employee_get_jobs_for_employee` or use `employee_get_message_threads_for_worker` (which already requires auth). As a minimal fix, read the name from `kf_cs` localStorage since `employee_sign_in_with_code` stores it:

```ts
// Read own name from kf_cs (already available for code-auth users)
try {
  const raw = localStorage.getItem('kf_cs')
  if (raw) {
    const cs = JSON.parse(raw)
    if (cs.employee?.name && cs.employee?.surname) {
      setMyName(`${cs.employee.name} ${cs.employee.surname}`)
    }
  }
} catch { /* ignore */ }
```

For JWT-auth users (who don't have `kf_cs`), the direct query can remain as a fallback. Use both:
```ts
// Try kf_cs first (code-auth), then fall back to DB query (JWT-auth)
let nameSet = false
try {
  const raw = localStorage.getItem('kf_cs')
  if (raw) {
    const cs = JSON.parse(raw)
    if (cs.employee?.name && cs.employee?.surname) {
      setMyName(`${cs.employee.name} ${cs.employee.surname}`)
      nameSet = true
    }
  }
} catch { /* ignore */ }
if (!nameSet) {
  const { data: me } = await supabase
    .from('employees').select('name, surname')
    .eq('id', member.employeeId).single()
  if (me) setMyName(`${me.name} ${me.surname}`)
}
```

#### Direct query 2 — Load employees for new DM (function `loadEmployees`, line 115–120)
```ts
async function loadEmployees(cid: string, myId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('employees').select('id, name, surname')
    .eq('company_id', cid).eq('is_active', true)
    .neq('id', myId).order('name')
  setEmployees((data ?? []) as EmpPick[])
}
```

**Fix:** Replace with an RPC. Check if `employee_get_coworkers` or similar RPC exists. If not, the engineer should query this using the existing RPC `employee_get_jobs_for_employee` as a model for what RPCs accept. If no RPC exists for coworkers, create a minimal one. As a temporary workaround, accept that the "New Message" employee list will be empty for code-auth users — the rest of the messaging (reading threads, sending messages) will work once session token is fixed.

The best temporary fix:
```ts
async function loadEmployees(cid: string, myId: string) {
  const supabase = createClient()
  // Try RPC first (works for code-auth); fall back to direct query (JWT-auth)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const tok = member.sessionToken ?? session?.access_token ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('employee_get_coworkers', {
      p_company_id:    cid,
      p_employee_id:   myId,
      p_session_token: tok,
    })
    if (!error && data) { setEmployees(data as EmpPick[]); return }
  } catch { /* no RPC — fall through */ }
  // JWT-auth fallback
  const { data } = await supabase
    .from('employees').select('id, name, surname')
    .eq('company_id', cid).eq('is_active', true)
    .neq('id', myId).order('name')
  setEmployees((data ?? []) as EmpPick[])
}
```

#### Direct query 3 — Unread thread IDs (function `loadUnreadThreadIds`, lines 124–133)
```ts
const { data } = await supabase
  .from('app_messages').select('thread_id')
  .eq('company_id', cid)
  .not('read_by_ids', 'cs', `{"${eid}"}`)
```

**Fix:** Check if `employee_get_unread_thread_ids` or similar RPC exists. If not, accept that unread indicators won't work for code-auth users. The fix is non-critical (messages still open and send). Leave this as a known gap and document it.

Minimal fix — wrap in try/catch so failure doesn't break the page:
```ts
async function loadUnreadThreadIds(cid: string, eid: string) {
  const supabase = createClient()
  try {
    const { data } = await supabase
      .from('app_messages').select('thread_id')
      .eq('company_id', cid)
      .not('read_by_ids', 'cs', `{"${eid}"}`)
    const ids = new Set((data ?? []).map((r: { thread_id: string }) => r.thread_id))
    setUnreadThreadIds(ids)
  } catch { /* non-critical — unread dots won't show for code-auth */ }
}
```

Also note: `loadUnreadThreadIds` and `loadEmployees` are called from `init()` and `messages/page.tsx` needs access to `member.sessionToken` inside those helper functions. Refactor `init()` so `member` is in scope when helpers are called, or pass `tok` as a parameter.

---

## Bug 3 — Forms Page Crash: "cannot read properties of undefined reading list"

**File:** `kaisync-web/src/app/dashboard/employee/forms/page.tsx` and  
`kaisync-web/src/app/dashboard/employee/forms/[id]/page.tsx`

**Root cause 1 (list page):** The session token bug causes `employee_get_workflow_form_templates` RPC to fail. The `catch` block shows the error message in the UI. The crash text "cannot read properties of undefined reading list" is likely the RPC error message from the DB side, surfaced as the error display.

After fixing the session token, the list page should work. Verify.

**Root cause 2 (fill page):** `forms/[id]/page.tsx` queries the `workflow_form_templates` table DIRECTLY:
```ts
const { data, error: qErr } = await supabase
  .from('workflow_form_templates')
  .select('id, name, description, fields')
  .eq('id', tmplId)
  .eq('company_id', member.companyId)
  .maybeSingle()
```

For code-auth employees, RLS blocks this (no JWT). Returns `data = null`. The page then shows "Form not found." — which is wrong; the form exists but RLS blocked the read.

**Fix the fill page:** Replace the direct query with an RPC:
```ts
// Replace direct query with RPC
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data, error: qErr } = await (supabase.rpc as any)('employee_get_workflow_form_templates', {
  p_company_id:    member.companyId,
  p_employee_id:   member.employeeId,
  p_session_token: tok,
})
// The RPC returns an array; find the specific template by ID
const tmpl = ((data as FormTemplate[]) ?? []).find(t => t.id === tmplId) ?? null
if (qErr) throw qErr
if (!tmpl) { setNotFound(true); setLoading(false); return }
setTemplate(tmpl)
```

Note: this requires the `fields` column to be returned by `employee_get_workflow_form_templates`. If the RPC doesn't return fields, the engineer needs to either extend it or create a separate `employee_get_form_template_by_id` RPC.

**Also fix the submit in the fill page:** `employee_submit_workflow_form` also uses `session?.access_token ?? ''` — apply the session token pattern there too.

---

## Bug 4 — Leave Request Status Display: `rejected` vs `declined`

**File:** `kaisync-web/src/app/dashboard/employee/leave/page.tsx` (line 46–49)

```ts
const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-warning/10 text-warning',
  approved:  'bg-success/10 text-success',
  rejected:  'bg-error/10 text-error',     // ← wrong key
  cancelled: 'bg-surface-elevated text-text-secondary',
}
```

The DB stores `"declined"`, not `"rejected"`. A declined leave request renders in the default style (no colour) instead of red.

**Fix:** Change `rejected` to `declined`:
```ts
const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-warning/10 text-warning',
  approved:  'bg-success/10 text-success',
  declined:  'bg-error/10 text-error',     // ← correct key
  cancelled: 'bg-surface-elevated text-text-secondary',
}
```

---

## Bug 5 — Overview: Direct Queries Silently Fail for Code-Auth

**File:** `kaisync-web/src/app/dashboard/employee/overview/page.tsx`

Two direct queries are in the `init()` Promise.all that fail silently for code-auth users (no JWT = RLS blocks):

1. **Line 184:** `supabase.from('employees').select('registration_status').eq('id', member.employeeId).maybeSingle()`  
   → Returns `{data: null, error: {...}}`. Page shows no registration-pending banner (non-critical).

2. **Lines 224–235:** `supabase.from('leave_requests').select(...).eq('company_id', member.companyId)...`  
   → Returns empty. "Colleagues on leave" section is never shown (non-critical, inside try/catch).

After the session token fix, the RPCs will work and the page will show data. For these two direct queries specifically, they remain broken for code-auth users until RLS policies allow code-auth session validation.

**Minimal fix for registration status (Bug 5a):** Read `registration_status` from `kf_cs` if available (the `employee` object in `kf_cs` may have this field). If not, leave as is — the registration banner is non-critical for an active employee.

**Leave for now** — both are non-critical. Colleagues-on-leave section is handled by RPC (`employee_is_on_leave_today` etc.) which will work after session token fix.

---

## Summary Table

| Page | Root Cause | Fix |
|---|---|---|
| Overview — loading/empty | Bug 1 (session token null) | Fix 1A + 1B |
| My Jobs — no jobs | Bug 1 | Fix 1B |
| My PA — failed to load task | Bug 1 | Fix 1B |
| My Shifts — failed to load shift | Bug 1 | Fix 1B |
| My Attendance — no records | Bug 1 | Fix 1B |
| My Incidents — no incidents | Bug 1 | Fix 1B |
| My Payslips — missing payslips | Bug 1 | Fix 1B |
| My Leave — (verify if working) | Bug 1 | Fix 1B |
| Messages — redirects to login | Bug 2 (middleware) | Fix 2A + 1B |
| Messages — empty name / no DM list | Bug 2 (direct queries) | Fix 2B |
| Forms — crash / error | Bug 1 + Bug 3 | Fix 1B + Fix 3 |
| Leave status display (declined) | Bug 4 | Fix in leave page |

---

## Engineer Checklist

### `kaisync-web/src/lib/supabase/resolve-company.ts` **(DO FIRST)**
- [ ] Add `sessionToken: string | null` to the `CurrentMember` type
- [ ] Return `sessionToken: cs.session_token ?? null` in the code-auth path
- [ ] Return `sessionToken: null` in the JWT-auth path

### `kaisync-web/src/app/dashboard/employee/overview/page.tsx`
- [ ] Replace `session?.access_token ?? null` (line 161) with `member.sessionToken ?? session?.access_token ?? null`
- [ ] Apply same fix inside `submitClock()` (line 266–267) and `submitAbsence()` (line 311–312)

### `kaisync-web/src/app/dashboard/employee/jobs/page.tsx`
- [ ] Replace `session?.access_token ?? null` (line 61–62) with `member.sessionToken ?? ...`

### `kaisync-web/src/app/dashboard/employee/pa/page.tsx`
- [ ] Replace `session?.access_token ?? ''` (line 344–345) with `member.sessionToken ?? session?.access_token ?? null`
- [ ] Ensure `setToken(tok)` still sets it in state for TaskRow

### `kaisync-web/src/app/dashboard/employee/shifts/page.tsx`
- [ ] Apply in `loadEventsFor()` (line 94–95)
- [ ] Apply in `respond()` (line 115–116)

### `kaisync-web/src/app/dashboard/employee/leave/page.tsx`
- [ ] Apply in `init()` (line 102–103)
- [ ] Apply in `submit()` (line 143–144)
- [ ] Change `STATUS_STYLES.rejected` → `STATUS_STYLES.declined` (Bug 4)

### `kaisync-web/src/app/dashboard/employee/attendance/page.tsx`
- [ ] Apply in `load()` (line 144–145)

### `kaisync-web/src/app/dashboard/employee/incidents/page.tsx`
- [ ] Apply in `init()` (line 78–80)

### `kaisync-web/src/app/dashboard/employee/payslips/page.tsx`
- [ ] Apply in `init()` (line 57–58)

### `kaisync-web/src/app/dashboard/employee/forms/page.tsx`
- [ ] Apply in `init()` (line 36–37)

### `kaisync-web/src/app/dashboard/employee/forms/[id]/page.tsx`
- [ ] Replace direct `workflow_form_templates` query with `employee_get_workflow_form_templates` RPC + find by ID
- [ ] Apply session token fix in `submit()` (line 95–96)

### `kaisync-web/src/proxy.ts`
- [ ] Add `|| pathname.startsWith('/dashboard/messages')` to the code-auth exemption

### `kaisync-web/src/app/dashboard/messages/page.tsx`
- [ ] Apply session token pattern to `loadThreads()`, `selectThread()`, `reloadMessages()`, `sendMessage()`, `startDM()` — all `session?.access_token ?? null` occurrences
- [ ] Replace own-name direct query with `kf_cs`-first approach (Fix 2B, query 1)
- [ ] Wrap `loadUnreadThreadIds` direct query in try/catch (Fix 2B, query 3)
- [ ] Replace `loadEmployees` direct query with try-RPC-then-fallback pattern (Fix 2B, query 2)

### Verify
- [ ] Log in with company code `28` + employee code `FN211956`
- [ ] Dashboard (overview): clock card, KPI grid, jobs strip all load ✅
- [ ] My Jobs: assigned jobs visible ✅
- [ ] My PA: tasks visible ✅
- [ ] My Shifts: shifts/events visible ✅
- [ ] My Attendance: records from last month visible ✅
- [ ] My Incidents: incidents visible ✅
- [ ] My Payslips: payslip assigned to this employee visible ✅
- [ ] My Leave: can submit leave request ✅
- [ ] Forms: no crash; templates listed ✅
- [ ] Messages: page loads (does not redirect to login) ✅; can send message ✅
- [ ] Declined leave requests display in red ✅

No migrations required. No schema changes.
