# MISSION BRIEF — Employee Portal Wave 3: MAUI Parity (P1 Gaps)

**Prepared by:** KEES Architecture Review  
**Date:** 2026-07-20  
**Commit target:** `main`  
**Prerequisite:** Wave 2 applied (commit `318f178`), attendance PDF fix (commit `1d5872b`)

---

## Context

This brief covers 6 P1 gaps found by a full MAUI ViewModel vs web comparison across all 19 employee ViewModels. Every gap was verified against the live DB before writing. All DB-level fixes must be applied first (via SQL Editor), then the web changes can be made.

Auth pattern reminder (applies everywhere below):
```ts
const tok = member.sessionToken
  ?? (await supabase.auth.getSession()).data.session?.access_token
  ?? null
```

---

## DB Changes (apply first via SQL Editor)

### DB-1 — Create `employee_get_profile` RPC

No profile-read RPC exists. Create it. Verified: `employees` table has columns `name, surname, email, phone, id_number, bank_account, bank_name, bank_branch_code, position, employment_type, employment_type_label`.

```sql
CREATE OR REPLACE FUNCTION public.employee_get_profile(
  p_employee_id   uuid,
  p_company_id    uuid,
  p_session_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_emp employees%rowtype;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  SELECT * INTO v_emp
  FROM employees
  WHERE id = p_employee_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;
  RETURN row_to_json(v_emp);
END;
$$;
```

### DB-2 — Update `employee_get_job_for_employee` to return client_name and site_name

Currently `RETURNS SETOF jobs` — which has no joined names. Change to `RETURNS TABLE(...)` that LEFT JOINs `clients` and `sites`.

Verified: `clients.name text`, `sites.name text`, `jobs.client_id uuid`, `jobs.site_id uuid` — all confirmed in DB.

```sql
CREATE OR REPLACE FUNCTION public.employee_get_job_for_employee(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_job_id        uuid,
  p_session_token text DEFAULT NULL
)
RETURNS TABLE (
  id                      uuid,
  company_id              uuid,
  title                   text,
  description             text,
  client_id               uuid,
  site_id                 uuid,
  status                  text,
  priority                text,
  scheduled_start         timestamptz,
  scheduled_end           timestamptz,
  job_code                text,
  assignee_employee_id    uuid,
  assigned_employee_ids   uuid[],
  created_by_employee_id  uuid,
  created_at              timestamptz,
  updated_at              timestamptz,
  client_name             text,
  site_name               text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
  RETURN QUERY
  SELECT
    j.id, j.company_id, j.title, j.description,
    j.client_id, j.site_id, j.status, j.priority,
    j.scheduled_start, j.scheduled_end, j.job_code,
    j.assignee_employee_id, j.assigned_employee_ids, j.created_by_employee_id,
    j.created_at, j.updated_at,
    c.name AS client_name,
    s.name AS site_name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  LEFT JOIN public.sites s   ON s.id = j.site_id
  WHERE j.id = p_job_id
    AND j.company_id = p_company_id
    AND (
      j.assigned_employee_ids @> ARRAY[p_employee_id]
      OR j.assignee_employee_id = p_employee_id
      OR j.contractor_employee_id = p_employee_id
      OR (
        j.contractor_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.contractor_member_links cml
          WHERE cml.company_id = p_company_id
            AND cml.employee_id = p_employee_id
            AND cml.contractor_id = j.contractor_id
        )
      )
    )
  LIMIT 1;
END;
$$;
```

---

## Web Changes

### BUG 1 — Profile page does not exist

**File:** `kaisync-web/src/app/dashboard/employee/profile/page.tsx` ← CREATE THIS FILE  
**MAUI source:** `MyProfileViewModel.cs`  
**Impact:** Code-auth employees (and JWT employees) cannot view or edit their phone, ID number, or banking details on web. The entire route is missing.

**MAUI fields:**
- Read-only: `FirstName`, `LastName`, `Email`, `Position`, `EmploymentType`
- Editable: `Phone`, `IdNumber`, `BankAccount`, `BankName`, `BankBranchCode`
- Save: `employee_update_profile` RPC (DB-1 prerequisite: `employee_get_profile` for loading)

**Pattern for loading:**
- Call `employee_get_profile(p_employee_id, p_company_id, p_session_token)` on mount (uses `tokRef` — both auth paths)
- Response is a JSON object matching the `employees` row

**Pattern for saving:**
```ts
await (supabase.rpc as any)('employee_update_profile', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_first_name:    firstName || null,
  p_last_name:     lastName  || null,
  p_phone:         phone     || null,
  p_id_number:     idNumber  || null,
  p_bank_account:  bankAccount   || null,
  p_bank_name:     bankName      || null,
  p_bank_branch_code: bankBranchCode || null,
  p_session_token: tokRef.current,
})
```

**Page structure (mirror MAUI layout):**
```
Header: "My Profile"
Section: Personal Info (read-only display)
  - Full name
  - Email
  - Position
  - Employment type

Section: Contact (editable)
  - Phone number field

Section: Identity (editable)
  - ID Number field

Section: Banking Details (editable)
  Label: "Banking details for {company name}"
  - Bank name field
  - Account number field
  - Branch code field

Save button → calls employee_update_profile → shows "Saved" toast
```

**Auth note:** `BankingScopeLabel` in MAUI uses `_state.CurrentCompany?.Name`. On web, read from `kf_cs.company.name` (code-auth) or `member.companyId` lookup (JWT).

**Confirmed RPC args (DB):**
`employee_update_profile(p_employee_id uuid, p_company_id uuid, p_first_name text, p_last_name text, p_phone text, p_id_number text, p_bank_account text, p_bank_name text, p_bank_branch_code text, p_session_token text)`

---

### BUG 2 — Leave: annual quota and remaining days not displayed

**File:** `kaisync-web/src/app/dashboard/employee/leave/page.tsx`  
**MAUI source:** `MyLeaveViewModel.cs` → `ComputeBalances()` + `LeavePolicy.cs`  
**Impact:** Employees see how many days they've taken but not their allocation or how many days remain.

**MAUI display per type (from `LeaveBalance` record):**
- `AnnualEntitlement` — annual quota (from `LeavePolicy`)
- `TakenDays` — sum of approved requests this year
- `PendingDays` — sum of pending requests this year
- `RemainingDays = max(0, AnnualEntitlement - TakenDays)`
- `SummaryText = "{remaining} / {annual}"`
- `SubText = "{taken} taken · {pending} pending"`

**Annual entitlements (from `LeavePolicy.cs` — BCEA defaults):**
```ts
const LEAVE_QUOTA: Record<string, number> = {
  'Annual Leave':          15,
  'Sick Leave':            10,
  'Family Responsibility':  3,
  'Maternity Leave':       60,
  'Paternity Leave':       10,
  'Study Leave':            5,
  'Unpaid Leave':         365,
}
```

**Fix — update `LeaveSummary` interface and `computeSummary()`:**

Replace the current `LeaveSummary` interface (lines 19-23) and `computeSummary()` function (lines 56-66) with:

```ts
interface LeaveSummary {
  leave_type:     string
  annual_days:    number
  days_approved:  number
  days_pending:   number
  days_remaining: number
}

function computeSummary(requests: LeaveRequest[]): LeaveSummary[] {
  const thisYear = new Date().getFullYear()
  const yearly = requests.filter(r => new Date(r.start_date).getFullYear() === thisYear)

  return LEAVE_TYPES.map(leaveType => {
    const forType = yearly.filter(r => r.leave_type === leaveType)
    const approved = forType.filter(r => r.status === 'approved').reduce((s, r) => s + r.total_days, 0)
    const pending  = forType.filter(r => r.status === 'pending').reduce((s, r) => s + r.total_days, 0)
    const annual   = LEAVE_QUOTA[leaveType] ?? 0
    return {
      leave_type:     leaveType,
      annual_days:    annual,
      days_approved:  approved,
      days_pending:   pending,
      days_remaining: Math.max(0, annual - approved),
    }
  }).filter(s => s.days_approved > 0 || s.days_pending > 0 || s.annual_days > 0)
}
```

**Fix — update the summary card render** (lines 228-248 in the JSX):

Replace the card content to show remaining/quota + subtext:

```tsx
<div key={s.leave_type} className="bg-surface border border-divider rounded-xl p-3">
  <div className="flex items-center gap-2 mb-2">
    <span className="material-icons text-primary text-[18px]">
      {LEAVE_TYPE_ICONS[s.leave_type] ?? 'event_busy'}
    </span>
    <p className="text-[12px] font-semibold text-text-primary truncate">{s.leave_type}</p>
  </div>
  <p className="text-[22px] font-bold text-text-primary">
    {s.days_remaining}<span className="text-[14px] text-text-disabled font-normal"> / {s.annual_days}d</span>
  </p>
  <p className="text-[11px] text-text-disabled">days remaining</p>
  <p className="text-[11px] text-text-secondary mt-0.5">
    {s.days_approved}d taken
    {s.days_pending > 0 ? ` · ${s.days_pending}d pending` : ''}
  </p>
</div>
```

---

### BUG 3 — Job detail: client name and site name not displayed

**File:** `kaisync-web/src/app/dashboard/employee/jobs/[id]/page.tsx`  
**MAUI source:** `JobCardViewModel.cs` (`ClientName`, `SiteName` properties, loaded in `LoadAsync()`)  
**Impact:** Employees don't see which client or site a job belongs to — critical context for field work.
**Prerequisite:** DB-2 must be applied first.

**Current problem:**
- `Job` interface (lines 10-19) has `client_id` and `site_id` but no names
- `init()` (line 186) calls `employee_get_jobs_for_employee` (all jobs) then filters for the current `jobId` — inefficient and doesn't return names
- Header (line 496) shows only `{job.title}`

**Fix — update `Job` interface** to include names:
```ts
interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  description: string | null
  client_id: string | null
  site_id: string | null
  client_name: string | null   // ← ADD
  site_name: string | null     // ← ADD
}
```

**Fix — replace the jobs RPC call in `init()`:**

Current (line 186-187):
```ts
rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
```
and (line 197-198):
```ts
const foundJob = ((jobsRes.data as Job[]) ?? []).find(j => j.id === jobId)
if (!foundJob) { setNotFound(true); setLoading(false); return }
setJob(foundJob)
```

Replace with:
```ts
rpc('employee_get_job_for_employee', { p_company_id: member.companyId, p_employee_id: member.employeeId, p_job_id: jobId, p_session_token: tok }),
```

And update the result handling:
```ts
const foundJob = ((jobsRes.data as Job[]) ?? [])[0] ?? null
if (!foundJob) { setNotFound(true); setLoading(false); return }
setJob(foundJob)
```

**Fix — update the header** (lines 495-503) to show client and site:
```tsx
<div className="flex-1 min-w-0">
  <h1 className="text-[18px] font-semibold text-text-primary truncate">{job.title}</h1>
  {(job.client_name || job.site_name) && (
    <p className="text-[12px] text-text-secondary mt-0.5 truncate">
      {[job.client_name, job.site_name].filter(Boolean).join(' · ')}
    </p>
  )}
</div>
```

---

### BUG 4 — Payslips: regular hours, overtime hours, and working days fetched but never rendered

**File:** `kaisync-web/src/app/dashboard/employee/payslips/page.tsx`  
**MAUI source:** `MyPayslipsViewModel.cs` — `DownloadPdfAsync` includes these fields in the PDF  
**Impact:** Employees cannot see their hours breakdown on the web payslip list. The data is already in the `Payslip` interface (lines 16-18) and returned by `employee_get_payslips` — it just isn't shown.

**Confirmed DB columns:** `payment_approvals.regular_hours double precision`, `overtime_hours double precision`, `working_days integer` — all confirmed.

**Fix — add 3 columns to the table header** (after line 133, before the empty `<th>`):
```tsx
<th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Reg Hrs</th>
<th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">OT Hrs</th>
<th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Days</th>
```

**Fix — add 3 data cells to each row** (after line 159, before the download button cell):
```tsx
<td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
  {p.regular_hours != null ? p.regular_hours.toFixed(1) : '—'}
</td>
<td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
  {p.overtime_hours != null ? p.overtime_hours.toFixed(1) : '—'}
</td>
<td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
  {p.working_days != null ? p.working_days : '—'}
</td>
```

---

### BUG 5 — Messages: no Direct / Feed / Teams tab filter

**File:** `kaisync-web/src/app/dashboard/messages/page.tsx`  
**MAUI source:** `EmployeeThreadChatViewModel.cs` (`ActiveTab`, `ApplyThreadFilter()`)  
**Impact:** All thread types are mixed in one flat list. Company feed threads and team/job threads are mixed with direct messages, making conversations hard to find.

**MAUI tab logic:**
```csharp
var filtered = ActiveTab switch
{
    "feed"  => _allThreads.Where(t => t.IsCompanyFeed),
    "teams" => _allThreads.Where(t =>
        !t.IsCompanyFeed && (t.Subject?.StartsWith("Job:") == true || t.ParticipantIds.Count > 2)),
    _       => _allThreads.Where(t =>
        !t.IsCompanyFeed && t.Subject?.StartsWith("Job:") != true && t.ParticipantIds.Count <= 2)
};
```

The web page already has `type_raw: string | null` on `MessageThread` (line 15). Company feed threads have `type_raw = 'company_feed'`. Job threads have subjects starting with `"Job:"`. Direct threads have 2 participants.

**Fix — add `activeTab` state and filter function** after the existing state declarations (around line 61):

```ts
const [activeTab, setActiveTab] = useState<'direct' | 'feed' | 'teams'>('direct')
```

Add a derived value (computed before the return):
```ts
const filteredThreads = threads.filter(t => {
  const isFeed    = t.type_raw === 'company_feed'
  const isJobTeam = !isFeed && (t.subject?.startsWith('Job:') || (t.participant_ids?.length ?? 0) > 2)
  const isDirect  = !isFeed && !isJobTeam
  if (activeTab === 'feed')   return isFeed
  if (activeTab === 'teams')  return isJobTeam
  return isDirect
})
```

Replace the thread list display to use `filteredThreads` instead of `threads`.

**Fix — add tab bar** inside the thread-list panel header, after the "New" button (around line 323):

```tsx
{/* Tab filter */}
<div className="flex border-b border-divider shrink-0">
  {(['direct', 'feed', 'teams'] as const).map(tab => (
    <button key={tab} onClick={() => setActiveTab(tab)}
      className={`flex-1 py-2 text-[12px] font-semibold capitalize transition-colors ${
        activeTab === tab
          ? 'text-primary border-b-2 border-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}>
      {tab === 'direct' ? 'Direct' : tab === 'feed' ? 'Feed' : 'Teams'}
    </button>
  ))}
</div>
```

**Fix — ensure company feed thread exists on load.** In `loadThreads()` (after line 129), add:
```ts
// Ensure company feed is present (matches MAUI GetOrCreateCompanyFeedAsync)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data: feedData } = await (supabase.rpc as any)('employee_get_or_create_company_feed_thread', {
  p_company_id:    cid,
  p_employee_id:   eid,
  p_session_token: tokRef.current,
}).catch(() => ({ data: null }))
if (feedData?.id && !sorted.find(t => t.id === feedData.id)) {
  sorted.unshift(feedData)
}
```

**Note:** Check whether `employee_get_or_create_company_feed_thread` exists before using it. If not, skip the feed creation call — the feed will still appear if HR created it.

---

### BUG 6 — Notifications: registration approval tap does nothing (no routing)

**File:** `kaisync-web/src/app/dashboard/employee/notifications/page.tsx`  
**MAUI source:** `EmployeeNotificationsViewModel.cs` → `OpenNotificationAsync()`  
**Impact:** When an employee's registration is approved or rejected, tapping the notification in MAUI takes them to the company picker to sign in. On web, it just marks as read — the employee doesn't know what to do next.

**MAUI behavior:**
```csharp
if (item.NotificationType is "registration_approved" or "registration_rejected")
{
    await EmployeeAccountRouting.GoToCompanyPickerAsync();
    return;
}
```

**Current web code (lines 234-243):**
```tsx
onClick={() => {
  if (n.source === 'app') {
    if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
      // Registration status notification — mark as read and stay on notifications
      if (!n.is_read) markRead(n)
      return
    }
    if (!n.is_read) markRead(n)
  }
}}
```

**Fix** — add `router.push` navigation (the `router` variable already exists at line 108):
```tsx
onClick={() => {
  if (n.source === 'app') {
    if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
      if (!n.is_read) markRead(n)
      router.push('/auth/id-entry')   // ← ADD: navigate to company/employee sign-in
      return
    }
    if (!n.is_read) markRead(n)
  }
}}
```

Confirm that `/auth/id-entry` is the correct route (the code-auth entry point where employees enter their company code and employee code). If a different route is more appropriate (e.g. a "select company" page for JWT users), adjust accordingly.

---

## Verification Checklist

After applying all changes, verify each fix:

- [ ] **Profile** — code-auth employee can view all fields; editing phone/bank saves via RPC; JWT employee also works
- [ ] **Leave** — annual quota strip shows remaining/total days per type; pending days shown correctly
- [ ] **Job detail** — client name and site name appear in header when present; absent gracefully (`·` separator not shown if both null)
- [ ] **Payslips** — Reg Hrs, OT Hrs, Days columns visible; `—` shown when null
- [ ] **Messages** — Direct tab shows 1-on-1 threads only; Feed tab shows company feed; Teams shows job/group threads; switching tabs filters correctly
- [ ] **Notifications** — tapping a registration_approved/rejected notification navigates to `/auth/id-entry`

---

## Summary

| # | File | Type | Effort |
|---|------|------|--------|
| DB-1 | New RPC: `employee_get_profile` | DB | ~10 min |
| DB-2 | Update RPC: `employee_get_job_for_employee` | DB | ~10 min |
| BUG 1 | Create `profile/page.tsx` (new file, ~150 lines) | Web | ~45 min |
| BUG 2 | `leave/page.tsx` — summary data + card render | Web | ~20 min |
| BUG 3 | `jobs/[id]/page.tsx` — RPC switch + header render | Web | ~15 min |
| BUG 4 | `payslips/page.tsx` — 3 columns added to table | Web | ~10 min |
| BUG 5 | `messages/page.tsx` — tab state + filter + tab bar | Web | ~30 min |
| BUG 6 | `notifications/page.tsx` — one `router.push` line | Web | ~5 min |
