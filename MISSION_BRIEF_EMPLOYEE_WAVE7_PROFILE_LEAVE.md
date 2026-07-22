# MISSION BRIEF — EMPLOYEE PORTAL WAVE 7: PROFILE + LEAVE PAGE FIXES

**Classification:** KEES Standard Mission Brief  
**Date:** 2026-07-17  
**Audit basis:** Full line-by-line read of both files against DB schema — every field, every RPC call, every interface  
**Source of truth:** Supabase DB (project: vcivtjwreybaxgtdhtou) — all names below are DB-confirmed  
**MAUI Fidelity Requirement:** The engineer must match the MAUI app exactly: same sections, same labels, same navigation structure, same flow. Any deviation must be approved and labelled `[ENHANCEMENT]`.

---

## VERIFIED DB FACTS

All facts below were confirmed by SQL query before this brief was written.

### `leave_requests` table columns (confirmed)
```
id             uuid
company_id     uuid
employee_id    uuid
leave_type     text           ← stores title-case strings: "Annual Leave", "Family Responsibility", etc.
start_date     date
end_date       date
half_day_start boolean        (default false)
half_day_end   boolean        (default false)
total_days     double precision  ← NOT "days_requested" — confirmed column name
status         text           (default 'pending') — values: 'pending' | 'approved' | 'rejected' | 'cancelled'
reason         text nullable
decision_note  text nullable
attachment_url text nullable
created_at     timestamptz
```
**No `days_requested`, `days_allowed`, `days_remaining`, `days_taken` columns exist.**

### `leave_type` values confirmed in DB
```
"Annual Leave"
"Family Responsibility"
```
MAUI stores full title-case strings. All other leave types follow the same pattern:
```
"Annual Leave"
"Sick Leave"
"Family Responsibility"
"Unpaid Leave"
"Study Leave"
"Maternity Leave"
"Paternity Leave"
```

### `employee_submit_leave_request` — use the UUID overload
```
employee_submit_leave_request(
  p_company_id     uuid,
  p_employee_id    uuid,
  p_leave_type     text,
  p_start_date     date,
  p_end_date       date,
  p_total_days     double precision,   ← NO DEFAULT — REQUIRED
  p_reason         text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL,
  p_session_token  text DEFAULT NULL
)
RETURNS json
```
> **Warning:** There is also a legacy bigint overload. Always call with uuid values — Supabase will route to the correct overload.

### `employee_update_leave_request` (confirmed full signature)
```
employee_update_leave_request(
  p_id             uuid,               ← first param — NOT p_leave_request_id
  p_employee_id    uuid,
  p_leave_type     text,
  p_start_date     date,
  p_end_date       date,
  p_total_days     double precision,   ← NO DEFAULT — REQUIRED
  p_reason         text DEFAULT NULL,
  p_attachment_url text DEFAULT NULL,
  p_session_token  text DEFAULT NULL
)
RETURNS json
```
> **No `p_company_id` parameter.** Passing it will cause a PostgreSQL error.

### `employee_get_leave_requests` (confirmed full signature)
```
employee_get_leave_requests(
  p_company_id     uuid,
  p_employee_id    uuid,
  p_session_token  text DEFAULT NULL
)
RETURNS json   ← returns a JSON array of leave_request rows
```
Returns fields: `id, company_id, employee_id, leave_type, start_date, end_date, half_day_start, half_day_end, total_days, status, reason, decision_note, approver_hr_user_id, decided_at, created_at, attachment_url`

### `employee_get_company_approved_leave` — DO NOT USE on leave page
```
RETURNS SETOF leave_requests
```
Returns ALL approved leave for the entire company. Contains no balance fields. This RPC is for the Overview page ("colleagues on leave"), not for the My Leave page.

### `employee_update_profile` (confirmed both overloads)
```
employee_update_profile(
  p_employee_id        uuid,
  p_company_id         uuid,
  p_first_name         text DEFAULT NULL,
  p_last_name          text DEFAULT NULL,
  p_phone              text DEFAULT NULL,
  p_id_number          text DEFAULT NULL,
  p_bank_account       text DEFAULT NULL,
  p_bank_name          text DEFAULT NULL,
  p_bank_branch_code   text DEFAULT NULL,
  p_session_token      text DEFAULT NULL
)

employee_update_profile(
  p_employee_id        uuid,
  p_company_id         uuid,
  p_profile_photo_url  text DEFAULT NULL,
  p_session_token      text DEFAULT NULL
)
```

### `employees` table — confirmed columns used in profile
`name`, `surname`, `email`, `phone`, `id_number`, `bank_account`, `bank_name`, `bank_branch_code`, `profile_photo_url`, `position`, `access_level`, `employment_type`, `date_of_birth`, `bank_details_updated_at` (timestamptz), `bank_details_updated_by` (text)

---

## FILE 1 — MY LEAVE PAGE

**Path:** `src/app/dashboard/employee/leave/page.tsx`

### Bug 1 — CRITICAL: `employee_get_company_approved_leave` must be removed from this page

**What the engineer built:**
```ts
const [balRes, reqRes] = await Promise.all([
  (supabase.rpc as any)('employee_get_company_approved_leave', {
    p_employee_id: member.employeeId,
    p_company_id:  member.companyId,
  }),
  (supabase.rpc as any)('employee_get_leave_requests', {
    p_employee_id: member.employeeId,
    p_company_id:  member.companyId,
  }),
])
setBalances((balRes.data as LeaveBalance[]) ?? [])
```

**Why this is broken:**
- `employee_get_company_approved_leave` returns `SETOF leave_requests` — no `days_taken`, `days_allowed`, or `days_remaining` columns exist on that table
- It returns ALL employees' approved leave company-wide, not just the current employee's
- The cast to `LeaveBalance[]` means every balance card renders `undefined` for all values

**Fix:** Remove `employee_get_company_approved_leave` from this page entirely. Remove the `balances` state and `LeaveBalance` interface. Instead, compute per-type stats from `employee_get_leave_requests` data. The leave summary section should show approved days and pending days per leave type — computed client-side from the requests.

**New `init()` function — single RPC call:**
```ts
async function init() {
  setLoading(true)
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) { setLoading(false); return }
  setCompanyId(member.companyId)
  setEmpId(member.employeeId)

  const { data: { session } } = await supabase.auth.getSession()
  const tok = session?.access_token ?? null

  const { data, error } = await (supabase.rpc as any)('employee_get_leave_requests', {
    p_company_id:    member.companyId,
    p_employee_id:   member.employeeId,
    p_session_token: tok,
  })
  if (!error) setRequests((data as LeaveRequest[]) ?? [])
  setLoading(false)
}
```

**Leave summary computation (replaces balance cards):**
```ts
// Compute per-type summary from requests
interface LeaveSummary {
  leave_type:   string
  days_approved: number
  days_pending:  number
}

function computeSummary(requests: LeaveRequest[]): LeaveSummary[] {
  const map: Record<string, LeaveSummary> = {}
  for (const r of requests) {
    if (!map[r.leave_type]) {
      map[r.leave_type] = { leave_type: r.leave_type, days_approved: 0, days_pending: 0 }
    }
    if (r.status === 'approved') map[r.leave_type].days_approved += r.total_days
    if (r.status === 'pending')  map[r.leave_type].days_pending  += r.total_days
  }
  return Object.values(map)
}
```

**Updated summary section render** (replace the existing balance cards with this):
```tsx
{summary.length > 0 && (
  <div>
    <p className="section-label mb-2">Leave Summary</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {summary.map(s => (
        <div key={s.leave_type} className="bg-surface border border-divider rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-icons text-primary text-[18px]">
              {LEAVE_TYPE_ICONS[s.leave_type] ?? 'event_busy'}
            </span>
            <p className="text-[12px] font-semibold text-text-primary truncate">{s.leave_type}</p>
          </div>
          <p className="text-[22px] font-bold text-text-primary">{s.days_approved}</p>
          <p className="text-[11px] text-text-disabled">days approved</p>
          {s.days_pending > 0 && (
            <p className="text-[11px] text-warning mt-0.5">{s.days_pending}d pending</p>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

---

### Bug 2 — CRITICAL: Leave type values stored as wrong strings

**What the engineer built:**
```ts
const [leaveType, setLeaveType] = useState('annual')
// Dropdown options:
{['annual','sick','family','unpaid','study','maternity','paternity'].map(t => (
  <option key={t} value={t} className="capitalize">
    {t.charAt(0).toUpperCase() + t.slice(1)}
  </option>
))}
```

**Why this is broken:** DB `leave_type` stores `"Annual Leave"`, `"Family Responsibility"` (title case, with spaces). Submitting `'annual'` creates a record that MAUI will never recognise or display correctly. All existing web-submitted leave requests are corrupted.

**Fix — replace leave type list and default:**
```ts
const LEAVE_TYPES = [
  'Annual Leave',
  'Sick Leave',
  'Family Responsibility',
  'Unpaid Leave',
  'Study Leave',
  'Maternity Leave',
  'Paternity Leave',
]

const [leaveType, setLeaveType] = useState('Annual Leave')
```

**Fix — dropdown render:**
```tsx
<select className="input" value={leaveType} onChange={e => setLeaveType(e.target.value)}>
  {LEAVE_TYPES.map(t => (
    <option key={t} value={t}>{t}</option>
  ))}
</select>
```

---

### Bug 3 — CRITICAL: `LEAVE_TYPE_ICONS` map keys don't match DB values

**What the engineer built:**
```ts
const LEAVE_TYPE_ICONS: Record<string, string> = {
  annual:    'beach_access',
  sick:      'local_hospital',
  family:    'family_restroom',
  unpaid:    'money_off',
  study:     'school',
  maternity: 'pregnant_woman',
  paternity: 'child_friendly',
}
```

**Why this is broken:** Keys are lowercase slugs. DB values are title-case strings. `LEAVE_TYPE_ICONS[b.leave_type]` will always return `undefined` — every card shows the fallback `'event_busy'` icon.

**Fix:**
```ts
const LEAVE_TYPE_ICONS: Record<string, string> = {
  'Annual Leave':          'beach_access',
  'Sick Leave':            'local_hospital',
  'Family Responsibility': 'family_restroom',
  'Unpaid Leave':          'money_off',
  'Study Leave':           'school',
  'Maternity Leave':       'pregnant_woman',
  'Paternity Leave':       'child_friendly',
}
```

---

### Bug 4 — CRITICAL: `employee_update_leave_request` wrong parameter name

**What the engineer built:**
```ts
await rpc('employee_update_leave_request', {
  p_leave_request_id: editRequest.id,  // ← WRONG
  p_employee_id:  empId,
  p_company_id:   companyId,           // ← NOT IN SIGNATURE
  p_leave_type:   leaveType,
  p_start_date:   startDate,
  p_end_date:     endDate,
  p_reason:       reason || null,
  p_attachment_url: attachmentUrl,
})
```

**Fix — correct all three issues at once:**
```ts
const totalDays = Math.round(
  (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
) + 1

await rpc('employee_update_leave_request', {
  p_id:            editRequest.id,   // ← CORRECT param name
  p_employee_id:   empId,
  // p_company_id REMOVED — not in RPC signature
  p_leave_type:    leaveType,
  p_start_date:    startDate,
  p_end_date:      endDate,
  p_total_days:    totalDays,        // ← ADDED — required
  p_reason:        reason || null,
  p_attachment_url: attachmentUrl,
  p_session_token: tok,              // ← ADDED
})
```

---

### Bug 5 — CRITICAL: `employee_submit_leave_request` missing `p_total_days`

`p_total_days` is a required parameter (no DEFAULT). Web does not compute or pass it. Every leave submission fails with a PostgreSQL error.

**What the engineer built:**
```ts
await rpc('employee_submit_leave_request', {
  p_employee_id:    empId,
  p_company_id:     companyId,
  p_leave_type:     leaveType,
  p_start_date:     startDate,
  p_end_date:       endDate,
  p_reason:         reason || null,
  p_attachment_url: attachmentUrl,
  // p_total_days MISSING
})
```

**Fix:**
```ts
const totalDays = Math.round(
  (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
) + 1

await rpc('employee_submit_leave_request', {
  p_company_id:     companyId,
  p_employee_id:    empId,
  p_leave_type:     leaveType,
  p_start_date:     startDate,
  p_end_date:       endDate,
  p_total_days:     totalDays,       // ← ADDED — required
  p_reason:         reason || null,
  p_attachment_url: attachmentUrl,
  p_session_token:  tok,             // ← ADDED
})
```

---

### Bug 6 — `LeaveRequest` interface uses wrong column name `days_requested`

DB `leave_requests` has column `total_days`. There is no `days_requested` column. The render `{req.days_requested}d` always shows `undefined`.

**Fix — update interface:**
```ts
interface LeaveRequest {
  id:             string
  leave_type:     string
  start_date:     string
  end_date:       string
  total_days:     number     // ← was: days_requested
  status:         string
  reason:         string | null
  created_at:     string
}
```

**Fix — update render (find this line and update):**
```tsx
// WRONG:
<span className="ml-1 text-text-disabled">({req.days_requested}d)</span>

// CORRECT:
<span className="ml-1 text-text-disabled">({req.total_days}d)</span>
```

---

### Bug 7 — Leave type display rendering uses wrong transform

**What the engineer built:**
```tsx
<p className="text-[14px] font-semibold text-text-primary capitalize">
  {req.leave_type.replace(/_/g, ' ')}
</p>
```

After fixing leave types to title-case strings (`"Annual Leave"`, `"Family Responsibility"`), `.replace(/_/g, ' ')` is a no-op but `.capitalize` (CSS) will force the already-correct first letter — harmless but still wrong pattern. After the fix, render the value directly:

```tsx
<p className="text-[14px] font-semibold text-text-primary">
  {req.leave_type}
</p>
```

Also fix the edit form's `openForm` — `setLeaveType(req.leave_type)` is already correct once the DB values are fixed; no change needed there.

---

### Bug 8 — `session` token not fetched in `init()` or `submit()`

Retrieve the token at the top of both `init()` and `submit()` and pass it to every RPC:

In `init()` — add after `resolveCurrentMember`:
```ts
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null
```

In `submit()` — add before the rpc call:
```ts
const { data: { session } } = await supabase.auth.getSession()
const tok = session?.access_token ?? null
```

---

## FILE 2 — MY PROFILE PAGE

**Path:** `src/app/dashboard/profile/page.tsx`

### Bug 1 — Missing "My Record" navigation section

MAUI's My Profile screen includes a "My Record" section with navigation cards linking to the employee's sub-sections: Payslips, Leave, and Documents. The web profile page has none of this.

**Fix:** Add a "My Record" section below the Banking Details card and above the Save button. Match MAUI layout: a labelled section with tappable navigation rows.

```tsx
{/* My Record */}
<div className="bg-surface border border-divider rounded-xl overflow-hidden">
  <div className="px-4 py-3 border-b border-divider">
    <p className="section-label">My Record</p>
  </div>
  <div className="divide-y divide-divider">
    {[
      { label: 'My Payslips',   href: '/dashboard/employee/payslips',  icon: 'payments'      },
      { label: 'My Leave',      href: '/dashboard/employee/leave',     icon: 'beach_access'  },
      { label: 'My Documents',  href: '/dashboard/employee/documents', icon: 'folder'        },
    ].map(item => (
      <a key={item.href} href={item.href}
        className="flex items-center justify-between px-4 py-3.5 hover:bg-surface-elevated transition-colors group">
        <div className="flex items-center gap-3">
          <span className="material-icons text-text-secondary text-[20px]">{item.icon}</span>
          <p className="text-[14px] font-medium text-text-primary">{item.label}</p>
        </div>
        <span className="material-icons text-text-disabled text-[18px] group-hover:text-text-secondary transition-colors">
          chevron_right
        </span>
      </a>
    ))}
  </div>
</div>
```

Use Next.js `Link` from `'next/link'` instead of `<a>` — import it at the top of the file if not already imported.

---

### Bug 2 — Photo upload RPC missing `p_session_token`

**What the engineer built (line ~110):**
```ts
const { error: rpcErr } = await (supabase.rpc as any)('employee_update_profile', {
  p_employee_id:       empId,
  p_company_id:        companyId,
  p_profile_photo_url: path,
  // MISSING: p_session_token
})
```

**Fix:** Retrieve session before the upload RPC call. The `handlePhotoUpload` function already has `const supabase = createClient()` at the top. Add the session fetch:

```ts
async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
  // ... existing file validation ...
  setPhotoUploading(true)
  setPhotoError(null)
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `profile-photos/${companyId}/${empId}.${ext}`
  const supabase = createClient()

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) { setPhotoError(upErr.message); setPhotoUploading(false); return }

  const { data: { session } } = await supabase.auth.getSession()   // ← ADD

  const { error: rpcErr } = await (supabase.rpc as any)('employee_update_profile', {
    p_employee_id:       empId,
    p_company_id:        companyId,
    p_profile_photo_url: path,
    p_session_token:     session?.access_token ?? null,             // ← ADD
  })
  // ... rest unchanged
}
```

---

### Bug 3 — Save RPC missing `p_session_token`

**What the engineer built (line ~132):**
```ts
const { error } = await (supabase.rpc as any)('employee_update_profile', {
  p_employee_id:      empId,
  p_company_id:       companyId,
  p_first_name:       ...,
  // ... no p_session_token
})
```

**Fix:** Add session fetch before the RPC call inside `save()`:

```ts
async function save() {
  if (!employee || !companyId || !empId) return
  setSaving(true)
  setSaved(false)
  setSaveError(null)

  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()   // ← ADD

  const { error } = await (supabase.rpc as any)('employee_update_profile', {
    p_employee_id:      empId,
    p_company_id:       companyId,
    p_first_name:       firstName !== employee.name                ? firstName      : null,
    p_last_name:        lastName  !== employee.surname             ? lastName       : null,
    p_phone:            phone     !== (employee.phone ?? '')       ? phone          : null,
    p_id_number:        idNumber  !== (employee.id_number ?? '')   ? idNumber       : null,
    p_bank_name:        bankName  !== (employee.bank_name ?? '')   ? bankName       : null,
    p_bank_account:     accountNumber !== (employee.bank_account ?? '') ? accountNumber : null,
    p_bank_branch_code: branchCode !== (employee.bank_branch_code ?? '') ? branchCode : null,
    p_session_token:    session?.access_token ?? null,             // ← ADD
  })
  // ... rest unchanged
}
```

---

### Bug 4 — Banking section subtitle does not show company name

MAUI shows `"Banking details for [CompanyName]"`. Web currently shows either `"Last updated [date]"` (if `bank_details_updated_at` is set) or `"Changes are logged for security"`.

**Fix:** Load company name from `companies` table in `init()` and add it to the banking subtitle.

**Add to state:**
```ts
const [companyName, setCompanyName] = useState<string>('')
```

**Add to `init()` after the employee data load:**
```ts
const { data: companyRow } = await supabase
  .from('companies')
  .select('name')
  .eq('id', member.companyId)
  .maybeSingle()
if (companyRow?.name) setCompanyName(companyRow.name)
```

**Update banking subtitle render:**
```tsx
// WRONG:
<p className="text-[11px] text-text-disabled">
  {employee?.bank_details_updated_at
    ? `Last updated ${...}`
    : 'Changes are logged for security'}
</p>

// CORRECT:
<p className="text-[11px] text-text-disabled">
  {companyName ? `Banking details for ${companyName}` : 'Banking Details'}
  {employee?.bank_details_updated_at && (
    <span className="ml-1">
      · Last updated {new Date(employee.bank_details_updated_at).toLocaleDateString(
        'en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }
      )}
    </span>
  )}
</p>
```

---

## COMPLETION CHECKLIST

### Leave page
- [ ] `employee_get_company_approved_leave` removed from leave page entirely — `balances` state and `LeaveBalance` interface removed
- [ ] Leave summary computed client-side from `employee_get_leave_requests` data — shows approved days and pending days per type
- [ ] Leave type values changed to title-case: `"Annual Leave"`, `"Sick Leave"`, `"Family Responsibility"`, `"Unpaid Leave"`, `"Study Leave"`, `"Maternity Leave"`, `"Paternity Leave"`
- [ ] `LEAVE_TYPE_ICONS` keys updated to match title-case type strings
- [ ] Default `leaveType` state changed from `'annual'` to `'Annual Leave'`
- [ ] `employee_update_leave_request`: `p_leave_request_id` → `p_id`
- [ ] `employee_update_leave_request`: `p_company_id` removed from call
- [ ] `employee_update_leave_request`: `p_total_days` added (computed from dates)
- [ ] `employee_submit_leave_request`: `p_total_days` added (computed from dates)
- [ ] `LeaveRequest` interface: `days_requested` → `total_days`
- [ ] Render: `{req.days_requested}d` → `{req.total_days}d`
- [ ] `p_session_token` added to `employee_get_leave_requests`
- [ ] `p_session_token` added to `employee_submit_leave_request`
- [ ] `p_session_token` added to `employee_update_leave_request`
- [ ] `session` fetched in `init()` and `submit()` before RPC calls
- [ ] Leave type display renders as `{req.leave_type}` (no `.replace(/_/g, ' ')` or capitalize)
- [ ] Leave type display renders correctly in balance/summary cards (no `.replace` needed)

### Profile page
- [ ] "My Record" section added with navigation links to payslips, leave, documents
- [ ] Navigation uses Next.js `Link` component
- [ ] `p_session_token` added to `employee_update_profile` in `handlePhotoUpload`
- [ ] `p_session_token` added to `employee_update_profile` in `save()`
- [ ] Company name loaded from `companies` table
- [ ] Banking subtitle updated to show `"Banking details for [CompanyName]"`

### Final verification
- [ ] Grep for `'annual'` | `'sick'` | `'family'` | `'unpaid'` | `'study'` | `'maternity'` | `'paternity'` in `leave/page.tsx` — must be zero results
- [ ] Grep for `p_leave_request_id` — must be zero results
- [ ] Grep for `days_requested` — must be zero results
- [ ] Grep for `employee_get_company_approved_leave` in `leave/page.tsx` — must be zero results
- [ ] Submit a test leave request — confirm it succeeds (no error from missing `p_total_days`)
- [ ] Edit a pending leave request — confirm it succeeds (no error from wrong param name)

---

*Brief authored by KEES Architect — 2026-07-17*  
*All DB facts confirmed by SQL query: leave_requests schema, employees schema, all 4 leave RPC definitions.*
