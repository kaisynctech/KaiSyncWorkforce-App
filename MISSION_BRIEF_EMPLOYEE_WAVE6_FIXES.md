# MISSION BRIEF — EMPLOYEE PORTAL WAVE 6: POST-AUDIT FIXES

**Classification:** KEES Standard Mission Brief  
**Date:** 2026-07-16  
**Audit basis:** Wave 5 files read line-by-line against DB schema  
**Source of truth:** Supabase DB (project: vcivtjwreybaxgtdhtou) — `employees` table confirmed

---

## CRITICAL FINDING — `employees.full_name` DOES NOT EXIST

The `employees` table has these name columns:
```
name     (text)
surname  (text)
```

**There is no `full_name` column.**

Every Wave 5 query that selects `employees.full_name` silently returns `null`. This breaks 4 features across 3 files. Fix all of them.

---

## FILE 1 — OVERVIEW PAGE

**Path:** `src/app/dashboard/employee/overview/page.tsx`

### Fix 1 — Colleagues on leave: `employees!inner(full_name)` → `employees!inner(name, surname)`

**Line ~228 — change the query:**
```ts
// WRONG (full_name does not exist):
const { data: colleaguesData } = await supabase
  .from('leave_requests')
  .select('employee_id, leave_type, end_date, employees!inner(full_name)')
  ...

// CORRECT:
const { data: colleaguesData } = await supabase
  .from('leave_requests')
  .select('employee_id, leave_type, end_date, employees!inner(name, surname)')
  ...
```

**Update the `ColleagueOnLeave` interface:**
```ts
// WRONG:
interface ColleagueOnLeave {
  employee_id: string
  leave_type: string
  end_date: string
  employees: { full_name: string }
}

// CORRECT:
interface ColleagueOnLeave {
  employee_id: string
  leave_type: string
  end_date: string
  employees: { name: string; surname: string }
}
```

**Update the render — display name construction:**
```ts
// WRONG:
<p className="...">{c.employees?.full_name ?? '—'}</p>

// CORRECT:
<p className="...">{c.employees ? `${c.employees.name} ${c.employees.surname}` : '—'}</p>
```

### Fix 2 — Missing `p_session_token` on three RPCs in `init()`

The following three RPC calls are missing `p_session_token: tok`. All have `DEFAULT NULL` so they won't fail, but they must pass the token for consistency and security correctness:

```ts
// Line ~173 — add p_session_token:
rpc('employee_get_jobs_for_employee', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: tok,   // ← ADD THIS
})

// Line ~174 — add p_session_token:
rpc('employee_get_leave_requests', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: tok,   // ← ADD THIS
})

// Line ~175 — add p_session_token:
rpc('employee_is_on_leave_today', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: tok,   // ← ADD THIS
})
```

---

## FILE 2 — NEW INCIDENT FORM

**Path:** `src/app/dashboard/employee/incidents/new/page.tsx`

### Fix 1 — Manager dropdown: `full_name` does not exist

**Line ~75 — change the employees query:**
```ts
// WRONG:
supabase.from('employees')
  .select('id, full_name, position')
  .eq('company_id', member.companyId)
  .in('access_level', ['manager', 'hr', 'owner'])
  .order('full_name')

// CORRECT:
supabase.from('employees')
  .select('id, name, surname, position')
  .eq('company_id', member.companyId)
  .in('access_level', ['manager', 'hr', 'owner'])
  .order('name')
```

**Update the `Manager` interface:**
```ts
// WRONG:
interface Manager {
  id: string
  full_name: string
  position: string | null
}

// CORRECT:
interface Manager {
  id: string
  name: string
  surname: string
  position: string | null
}
```

**Update the dropdown render — name construction:**
```ts
// WRONG:
<option key={m.id} value={m.id}>{m.full_name}{m.position ? ` — ${m.position}` : ''}</option>

// CORRECT:
<option key={m.id} value={m.id}>{m.name} {m.surname}{m.position ? ` — ${m.position}` : ''}</option>
```

### Fix 2 — `p_reported_by_name`: `full_name` does not exist

**Lines ~113-116 — change the employee name query:**
```ts
// WRONG:
const { data: empData } = await supabase
  .from('employees')
  .select('full_name')
  .eq('id', empId)
  .single()
// ...
p_reported_by_name: empData?.full_name ?? null,

// CORRECT:
const { data: empData } = await supabase
  .from('employees')
  .select('name, surname')
  .eq('id', empId)
  .single()
// ...
p_reported_by_name: empData ? `${empData.name} ${empData.surname}` : null,
```

### Fix 3 — Missing `p_session_token` on `employee_get_jobs_for_employee`

**Line ~81:**
```ts
// ADD p_session_token:
(supabase.rpc as any)('employee_get_jobs_for_employee', {
  p_employee_id:   member.employeeId,
  p_company_id:    member.companyId,
  p_session_token: session?.access_token ?? null,   // ← ADD THIS
})
```

Note: `session` is already retrieved at line ~110 in `submit()`. For `init()`, call `supabase.auth.getSession()` once at the start and reuse the token:
```ts
async function init() {
  const supabase = createClient()
  const member = await resolveCurrentMember(supabase)
  if (!member) { setLoading(false); return }

  empIdRef.current  = member.employeeId
  compIdRef.current = member.companyId

  const { data: { session } } = await supabase.auth.getSession()
  const tok = session?.access_token ?? null

  const [managersRes, jobsRes] = await Promise.all([
    supabase.from('employees')
      .select('id, name, surname, position')
      .eq('company_id', member.companyId)
      .in('access_level', ['manager', 'hr', 'owner'])
      .order('name'),
    (supabase.rpc as any)('employee_get_jobs_for_employee', {
      p_employee_id:   member.employeeId,
      p_company_id:    member.companyId,
      p_session_token: tok,
    }),
  ])
  ...
}
```

---

## FILE 3 — ATTENDANCE PAGE

**Path:** `src/app/dashboard/employee/attendance/page.tsx`

### Fix 1 — Employee name for PDF header: `full_name` does not exist

**Lines ~175-179 — change the name query:**
```ts
// WRONG:
const { data: empRow } = await supabase
  .from('employees')
  .select('full_name')
  .eq('id', member.employeeId)
  .maybeSingle()
if (empRow?.full_name) setEmpName(empRow.full_name)

// CORRECT:
const { data: empRow } = await supabase
  .from('employees')
  .select('name, surname')
  .eq('id', member.employeeId)
  .maybeSingle()
if (empRow) setEmpName(`${empRow.name} ${empRow.surname}`)
```

---

## FILE 4 — NOTIFICATIONS PAGE

**Path:** `src/app/dashboard/employee/notifications/page.tsx`

### Enhancement — Tap routing for `registration_approved` / `registration_rejected`

When an `app_notifications` item has `notification_type === 'registration_approved'` or `notification_type === 'registration_rejected'`, tapping it should navigate to the company/registration flow. In the web this means routing to the sign-in page or a dedicated "registration approved" page.

Add `useRouter` and update the item click handler:

```ts
import { useRouter } from 'next/navigation'

// Inside component:
const router = useRouter()

// Update the onClick in the render:
onClick={() => {
  if (n.source === 'app') {
    if (n.notification_type === 'registration_approved' || n.notification_type === 'registration_rejected') {
      router.push('/auth/hr-sign-in')   // redirect to sign-in for re-auth / company selection
      return
    }
    if (!n.is_read) markRead(n)
  }
}}
```

---

## FILE 5 — DOCUMENTS PAGE

**Path:** `src/app/dashboard/employee/documents/page.tsx`

### Enhancement — Company name in document subtitle

The MAUI `MyDocumentsViewModel` subtitle shows `"[CompanyName] (pending review)"`. The web currently shows `"[DocumentType] (pending review)"`.

To fix this, load the company name on init:

```ts
// Add to state:
const [companyName, setCompanyName] = useState<string>('')

// Add to init():
const { data: companyRow } = await supabase
  .from('companies')
  .select('name')
  .eq('id', member.companyId)
  .maybeSingle()
if (companyRow?.name) setCompanyName(companyRow.name)
```

Update the document subtitle render:
```ts
// WRONG (shows doc type):
<p className="text-[11px] text-text-secondary">{fmtDocType(doc.document_type)}</p>
<p className="text-[11px] text-text-disabled mt-0.5">
  {fmtDate(doc.created_at)}
  {doc.uploaded_by_role === 'employee' && (
    <span className="ml-1 text-warning">(pending review)</span>
  )}
</p>

// CORRECT (shows both type and company name):
<p className="text-[11px] text-text-secondary">{fmtDocType(doc.document_type)}</p>
<p className="text-[11px] text-text-disabled mt-0.5">
  {companyName && <span>{companyName} · </span>}
  {fmtDate(doc.created_at)}
  {doc.uploaded_by_role === 'employee' && (
    <span className="ml-1 text-warning">(pending review)</span>
  )}
</p>
```

Note: check that the `companies` table has a `name` column. If the table is named differently (e.g. `company_profiles`), adjust accordingly. The `company_id` is on the `employees` record.

---

## COMPLETION CHECKLIST

- [ ] `employees.full_name` zero occurrences anywhere in the codebase — search and confirm:
  ```
  grep -r "full_name" src/app/dashboard/employee/
  ```
- [ ] Colleagues on leave section shows actual employee names (not `—`)
- [ ] Manager dropdown in new incident form shows names
- [ ] `p_reported_by_name` populated correctly when submitting incident
- [ ] Attendance PDF header shows employee name, not "Employee"
- [ ] All 4 RPCs in overview now pass `p_session_token`
- [ ] `registration_approved` / `registration_rejected` notifications route correctly
- [ ] Documents subtitle shows company name

---

## GLOBAL SWEEP — Before closing Wave 6

Run this grep across the entire `src/` directory and fix any remaining `full_name` references on the `employees` table:

```bash
grep -rn "full_name" src/
```

Any result that references `employees.full_name` must be changed to use `name` and `surname` with string concatenation. This applies to any page or component not covered in this brief.

---

*Brief authored by KEES Architect — 2026-07-16*  
*Source confirmed: `employees` table has `name (text)` + `surname (text)` — no `full_name` column.*
