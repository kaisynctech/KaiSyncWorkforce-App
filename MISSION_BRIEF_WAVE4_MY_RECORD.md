# MISSION BRIEF — Wave 4: My Profile — MY RECORD Section
**Project:** kaisync-web (Next.js)  
**Prepared by:** KEES Architect  
**Date:** 2026-07-16  
**Supabase Project:** vcivtjwreybaxgtdhtou  
**Status:** READY FOR ENGINEERING EXECUTION

> **Gap source:** MAUI app My Profile screen shows a "MY RECORD" section with three tappable rows — My Payslips, My Leave, My Documents. The web version profile page has none of these. All three are fully backed by confirmed live DB RPCs.

---

## OVERVIEW

The MAUI My Profile screen has two distinct areas:
1. **Top card** — avatar, name, email, company, Edit Profile button
2. **MY RECORD section** — three navigation rows: My Payslips / My Leave / My Documents

The web version currently has the full edit form (Wave 2/3). We are **adding** the MY RECORD section below the existing profile form, plus three new sub-pages each accessible via those rows.

No DB migrations required. All three RPCs are confirmed live.

---

## CONFIRMED DB RPCs

| RPC | Args | Returns |
|-----|------|---------|
| `employee_get_payslips` | `p_company_id uuid, p_employee_id uuid` | `json` — array of `payment_approvals` rows where `shared_with_employee = true`, ordered `period_start DESC` |
| `employee_get_leave_requests` | `p_company_id uuid, p_employee_id uuid` | `json` — array of `leave_requests` rows, ordered `created_at DESC` |
| `employee_get_documents` | `p_company_id uuid, p_employee_id uuid` | `json` — array of `employee_documents` rows, ordered `created_at DESC` |

All three are `SECURITY DEFINER` and use `_assert_worker_access` — call with `(supabase.rpc as any)(...)`, no `p_session_token` needed for authenticated web users.

---

## PART A — PROFILE PAGE: Add MY RECORD section

**File:** `src/app/dashboard/profile/page.tsx`

Add this section **at the bottom of the page content**, after the Save button / sticky footer, before the closing container div.

```tsx
{/* MY RECORD */}
<div className="mt-6">
  <p className="text-[11px] font-semibold uppercase tracking-widest text-text-disabled px-1 mb-2">
    My Record
  </p>
  <div className="bg-surface border border-divider rounded-xl overflow-hidden divide-y divide-divider">
    
    {/* My Payslips */}
    <Link
      href="/dashboard/profile/payslips"
      className="flex items-center gap-3 px-4 py-4 hover:bg-background transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
        <span className="material-icons text-amber-500 text-[18px]">payments</span>
      </div>
      <span className="flex-1 text-[14px] font-semibold text-text-primary">My Payslips</span>
      <span className="material-icons text-text-disabled text-[18px]">chevron_right</span>
    </Link>

    {/* My Leave */}
    <Link
      href="/dashboard/profile/leave"
      className="flex items-center gap-3 px-4 py-4 hover:bg-background transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0">
        <span className="material-icons text-blue-500 text-[18px]">beach_access</span>
      </div>
      <span className="flex-1 text-[14px] font-semibold text-text-primary">My Leave</span>
      <span className="material-icons text-text-disabled text-[18px]">chevron_right</span>
    </Link>

    {/* My Documents */}
    <Link
      href="/dashboard/profile/documents"
      className="flex items-center gap-3 px-4 py-4 hover:bg-background transition-colors"
    >
      <div className="w-9 h-9 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
        <span className="material-icons text-yellow-500 text-[18px]">folder</span>
      </div>
      <span className="flex-1 text-[14px] font-semibold text-text-primary">My Documents</span>
      <span className="material-icons text-text-disabled text-[18px]">chevron_right</span>
    </Link>

  </div>
</div>
```

Add `import Link from 'next/link'` at the top of `profile/page.tsx` if not already imported.

---

## PART B — MY PAYSLIPS SUB-PAGE

**File to create:** `src/app/dashboard/profile/payslips/page.tsx`

### What to show

List of payslips (payment_approvals where `shared_with_employee = true`) for the logged-in employee. Each row shows:
- Pay period: `period_start` to `period_end` formatted as `"1 Jun 2026 – 30 Jun 2026"`
- Net pay: `net_pay` formatted as `"R 12,450.00"` (ZAR, 2 decimal places)
- Status badge: `status` value — `'approved'` (green), `'paid'` (blue), `'pending'` (yellow), `'draft'` (grey)
- Gross pay and deductions as secondary info

Empty state: "No payslips shared yet. Your HR team will share payslips here once processed."

### Key `payment_approvals` columns to display

| Column | Display |
|--------|---------|
| `period_start` | Pay period start date |
| `period_end` | Pay period end date |
| `gross_pay` | Gross amount |
| `deductions` | Total deductions |
| `net_pay` | Take-home pay (PROMINENT) |
| `status` | Badge: approved / paid / pending / draft |
| `bonus_amount` | Show if > 0 |
| `paid_at` | "Paid on [date]" if status = 'paid' |
| `pay_basis` | hourly / salary — shown as a small label |

### Full page implementation

```typescript
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/auth/resolve-member'
import Link from 'next/link'

type Payslip = {
  id: string
  period_start: string
  period_end: string
  gross_pay: number
  deductions: number
  net_pay: number
  status: string
  bonus_amount: number
  paid_at: string | null
  pay_basis: string | null
  regular_hours: number
  overtime_hours: number
  manual_adjustment: number
  adjustment_note: string | null
}

function formatZAR(amount: number) {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

const STATUS_STYLE: Record<string, string> = {
  paid:     'bg-blue-500/15 text-blue-500',
  approved: 'bg-green-500/15 text-green-600',
  pending:  'bg-amber-500/15 text-amber-600',
  draft:    'bg-surface-elevated text-text-disabled',
}

export default function MyPayslipsPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Not authenticated'); setLoading(false); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.rpc as any)('employee_get_payslips', {
        p_company_id:  member.companyId,
        p_employee_id: member.employeeId,
      })
      if (err) { setError(err.message); setLoading(false); return }
      setPayslips((data ?? []) as Payslip[])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-divider px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard/profile">
          <span className="material-icons text-text-primary">arrow_back</span>
        </Link>
        <h1 className="text-[17px] font-bold text-text-primary flex-1">My Payslips</h1>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
        {loading && (
          <div className="flex justify-center py-16">
            <span className="material-icons animate-spin text-primary text-[28px]">refresh</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        {!loading && !error && payslips.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <span className="material-icons text-text-disabled text-[40px]">payments</span>
            <p className="text-[15px] font-semibold text-text-primary">No payslips yet</p>
            <p className="text-[13px] text-text-secondary max-w-xs">
              Your HR team will share payslips here once processed.
            </p>
          </div>
        )}

        {!loading && payslips.map(p => (
          <div key={p.id} className="bg-surface border border-divider rounded-xl overflow-hidden">
            {/* Period header */}
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <div>
                <p className="text-[13px] font-bold text-text-primary">
                  {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </p>
                {p.pay_basis && (
                  <p className="text-[11px] text-text-disabled capitalize mt-0.5">{p.pay_basis}</p>
                )}
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[p.status] ?? STATUS_STYLE['draft']}`}>
                {p.status}
              </span>
            </div>

            {/* Net pay — prominent */}
            <div className="px-4 py-3 border-b border-divider">
              <p className="text-[11px] text-text-disabled uppercase tracking-wide mb-0.5">Net Pay</p>
              <p className="text-[22px] font-bold text-text-primary">{formatZAR(p.net_pay)}</p>
              {p.status === 'paid' && p.paid_at && (
                <p className="text-[11px] text-text-secondary mt-0.5">
                  Paid {new Date(p.paid_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
            </div>

            {/* Breakdown */}
            <div className="px-4 py-3 grid grid-cols-2 gap-y-2">
              <div>
                <p className="text-[11px] text-text-disabled">Gross Pay</p>
                <p className="text-[13px] font-semibold text-text-primary">{formatZAR(p.gross_pay)}</p>
              </div>
              <div>
                <p className="text-[11px] text-text-disabled">Deductions</p>
                <p className="text-[13px] font-semibold text-error">-{formatZAR(p.deductions)}</p>
              </div>
              {p.regular_hours > 0 && (
                <div>
                  <p className="text-[11px] text-text-disabled">Regular Hours</p>
                  <p className="text-[13px] font-semibold text-text-primary">{p.regular_hours.toFixed(1)}h</p>
                </div>
              )}
              {p.overtime_hours > 0 && (
                <div>
                  <p className="text-[11px] text-text-disabled">Overtime Hours</p>
                  <p className="text-[13px] font-semibold text-text-primary">{p.overtime_hours.toFixed(1)}h</p>
                </div>
              )}
              {p.bonus_amount > 0 && (
                <div>
                  <p className="text-[11px] text-text-disabled">Bonus</p>
                  <p className="text-[13px] font-semibold text-green-600">{formatZAR(p.bonus_amount)}</p>
                </div>
              )}
              {p.manual_adjustment !== 0 && (
                <div>
                  <p className="text-[11px] text-text-disabled">Adjustment</p>
                  <p className="text-[13px] font-semibold text-text-primary">
                    {p.manual_adjustment > 0 ? '+' : ''}{formatZAR(p.manual_adjustment)}
                  </p>
                </div>
              )}
            </div>

            {p.adjustment_note && (
              <div className="px-4 pb-3">
                <p className="text-[12px] text-text-secondary italic">Note: {p.adjustment_note}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## PART C — MY LEAVE SUB-PAGE

**File to create:** `src/app/dashboard/profile/leave/page.tsx`

### What to show

List of the logged-in employee's own leave requests. Each row shows leave type, date range, total days, status, and reason.

### Key `leave_requests` columns

| Column | Display |
|--------|---------|
| `leave_type` | Annual / Sick / Family / Unpaid / etc. — shown as badge |
| `start_date` | From date |
| `end_date` | To date |
| `total_days` | "X days" or "0.5 days" for half-day |
| `status` | pending / approved / rejected / cancelled |
| `reason` | Optional supporting text |
| `decision_note` | HR's response note (show when present) |
| `half_day_start` / `half_day_end` | Show "Half day" label if true |

Status colors: `approved` = green, `pending` = amber, `rejected` = red, `cancelled` = grey.

### Full page implementation

```typescript
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/auth/resolve-member'
import Link from 'next/link'

type LeaveRequest = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number
  status: string
  reason: string | null
  decision_note: string | null
  half_day_start: boolean
  half_day_end: boolean
  created_at: string
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', {
    day: 'numeric', month: 'short', year: 'numeric'
  })
}

const STATUS_STYLE: Record<string, string> = {
  approved:  'bg-green-500/15 text-green-600',
  pending:   'bg-amber-500/15 text-amber-600',
  rejected:  'bg-red-500/15 text-red-500',
  cancelled: 'bg-surface-elevated text-text-disabled',
}

const LEAVE_TYPE_STYLE: Record<string, string> = {
  annual:   'bg-blue-500/15 text-blue-500',
  sick:     'bg-red-500/15 text-red-500',
  family:   'bg-purple-500/15 text-purple-500',
  unpaid:   'bg-surface-elevated text-text-secondary',
  maternity:'bg-pink-500/15 text-pink-500',
  paternity:'bg-indigo-500/15 text-indigo-500',
}

export default function MyLeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Not authenticated'); setLoading(false); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.rpc as any)('employee_get_leave_requests', {
        p_company_id:  member.companyId,
        p_employee_id: member.employeeId,
      })
      if (err) { setError(err.message); setLoading(false); return }
      setRequests((data ?? []) as LeaveRequest[])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-divider px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard/profile">
          <span className="material-icons text-text-primary">arrow_back</span>
        </Link>
        <h1 className="text-[17px] font-bold text-text-primary flex-1">My Leave</h1>
      </div>

      <div className="flex-1 px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
        {loading && (
          <div className="flex justify-center py-16">
            <span className="material-icons animate-spin text-primary text-[28px]">refresh</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        {!loading && !error && requests.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <span className="material-icons text-text-disabled text-[40px]">beach_access</span>
            <p className="text-[15px] font-semibold text-text-primary">No leave requests</p>
            <p className="text-[13px] text-text-secondary max-w-xs">
              Your submitted leave requests will appear here.
            </p>
          </div>
        )}

        {!loading && requests.map(r => (
          <div key={r.id} className="bg-surface border border-divider rounded-xl overflow-hidden">
            {/* Header row */}
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${
                  LEAVE_TYPE_STYLE[r.leave_type.toLowerCase()] ?? 'bg-surface-elevated text-text-secondary'
                }`}>
                  {r.leave_type}
                </span>
                <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize ${
                  STATUS_STYLE[r.status] ?? STATUS_STYLE['cancelled']
                }`}>
                  {r.status}
                </span>
              </div>
              <p className="text-[12px] text-text-disabled shrink-0">
                {r.total_days === 0.5 ? '½ day' : `${r.total_days} day${r.total_days !== 1 ? 's' : ''}`}
              </p>
            </div>

            {/* Date range */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="material-icons text-text-disabled text-[16px]">date_range</span>
                <p className="text-[13px] font-semibold text-text-primary">
                  {formatDate(r.start_date)}
                  {r.start_date !== r.end_date && ` – ${formatDate(r.end_date)}`}
                </p>
              </div>
              {(r.half_day_start || r.half_day_end) && (
                <p className="text-[12px] text-text-secondary mt-1 ml-6">
                  {r.half_day_start && r.half_day_end
                    ? 'Half day start & end'
                    : r.half_day_start
                    ? 'Half day (start)'
                    : 'Half day (end)'}
                </p>
              )}
            </div>

            {/* Reason */}
            {r.reason && (
              <div className="px-4 pb-3 border-t border-divider pt-2">
                <p className="text-[11px] text-text-disabled uppercase tracking-wide mb-0.5">Reason</p>
                <p className="text-[13px] text-text-secondary">{r.reason}</p>
              </div>
            )}

            {/* HR decision note */}
            {r.decision_note && (
              <div className="px-4 pb-3 border-t border-divider pt-2 bg-surface-elevated/50">
                <p className="text-[11px] text-text-disabled uppercase tracking-wide mb-0.5">HR Note</p>
                <p className="text-[13px] text-text-secondary italic">{r.decision_note}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## PART D — MY DOCUMENTS SUB-PAGE

**File to create:** `src/app/dashboard/profile/documents/page.tsx`

### What to show

List of documents belonging to the logged-in employee from `employee_documents`. Each row shows document name, type, who uploaded it, and a button to open/download the file.

**Critical:** `file_url` is a storage path in the `workforce-media` private bucket — NOT a public URL. Opening a document requires calling `createSignedUrl` (300 second TTL) and opening the result in a new tab. This is the same pattern used in `employees/[id]/page.tsx`.

### Key `employee_documents` columns

| Column | Display |
|--------|---------|
| `document_name` | Primary label |
| `document_type` | Type badge (Contract / ID / Certificate / etc.) |
| `file_url` | Storage path → generate signed URL on tap |
| `uploaded_by_role` | "Uploaded by HR" / "Uploaded by you" |
| `created_at` | Upload date |

### Full page implementation

```typescript
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/auth/resolve-member'
import Link from 'next/link'

type EmpDoc = {
  id: string
  document_type: string
  document_name: string
  file_url: string
  uploaded_by_role: string
  created_at: string
}

export default function MyDocumentsPage() {
  const [docs,     setDocs]     = useState<EmpDoc[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [opening,  setOpening]  = useState<string | null>(null)  // doc id being opened

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Not authenticated'); setLoading(false); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.rpc as any)('employee_get_documents', {
        p_company_id:  member.companyId,
        p_employee_id: member.employeeId,
      })
      if (err) { setError(err.message); setLoading(false); return }
      setDocs((data ?? []) as EmpDoc[])
      setLoading(false)
    }
    load()
  }, [])

  async function openDoc(doc: EmpDoc) {
    setOpening(doc.id)
    const supabase = createClient()
    const { data } = await supabase.storage
      .from('workforce-media')
      .createSignedUrl(doc.file_url, 300)   // 5 minute TTL
    setOpening(null)
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank')
    } else {
      alert('Could not open document. Please try again.')
    }
  }

  function getDocIcon(type: string): string {
    const t = type.toLowerCase()
    if (t.includes('contract'))   return 'description'
    if (t.includes('id'))         return 'badge'
    if (t.includes('cert'))       return 'workspace_premium'
    if (t.includes('payslip'))    return 'payments'
    if (t.includes('leave'))      return 'beach_access'
    return 'insert_drive_file'
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-divider px-4 py-3 flex items-center gap-3">
        <Link href="/dashboard/profile">
          <span className="material-icons text-text-primary">arrow_back</span>
        </Link>
        <h1 className="text-[17px] font-bold text-text-primary flex-1">My Documents</h1>
      </div>

      <div className="flex-1 px-4 py-4 max-w-2xl mx-auto w-full">
        {loading && (
          <div className="flex justify-center py-16">
            <span className="material-icons animate-spin text-primary text-[28px]">refresh</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error">{error}</p>
          </div>
        )}

        {!loading && !error && docs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <span className="material-icons text-text-disabled text-[40px]">folder_open</span>
            <p className="text-[15px] font-semibold text-text-primary">No documents</p>
            <p className="text-[13px] text-text-secondary max-w-xs">
              Documents shared with you by HR will appear here.
            </p>
          </div>
        )}

        {!loading && docs.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden divide-y divide-divider">
            {docs.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-4 py-3.5">
                {/* Icon */}
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="material-icons text-primary text-[18px]">
                    {getDocIcon(doc.document_type)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary truncate">
                    {doc.document_name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-text-disabled capitalize">
                      {doc.document_type}
                    </span>
                    <span className="text-text-disabled text-[10px]">•</span>
                    <span className="text-[11px] text-text-disabled capitalize">
                      {doc.uploaded_by_role === 'employee' ? 'Uploaded by you' : `Uploaded by ${doc.uploaded_by_role}`}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-disabled mt-0.5">
                    {new Date(doc.created_at).toLocaleDateString('en-ZA', {
                      day: 'numeric', month: 'short', year: 'numeric'
                    })}
                  </p>
                </div>

                {/* Open button */}
                <button
                  onClick={() => openDoc(doc)}
                  disabled={opening === doc.id}
                  className="shrink-0 w-9 h-9 rounded-full bg-surface-elevated border border-divider
                             flex items-center justify-center hover:bg-primary/10 hover:border-primary/30
                             transition-colors disabled:opacity-50"
                  title="Open document"
                >
                  {opening === doc.id ? (
                    <span className="material-icons text-text-disabled animate-spin text-[16px]">refresh</span>
                  ) : (
                    <span className="material-icons text-text-primary text-[16px]">open_in_new</span>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## PART E — EXECUTION ORDER

1. **Update `profile/page.tsx`** — add the MY RECORD section (Part A). Add `import Link from 'next/link'` if missing.

2. **Create `profile/payslips/page.tsx`** — full implementation from Part B.

3. **Create `profile/leave/page.tsx`** — full implementation from Part C.

4. **Create `profile/documents/page.tsx`** — full implementation from Part D.

5. **TypeScript check** — `npx tsc --noEmit` must return zero errors.

6. **Commit** — `feat: wave 4 — My Record section (payslips, leave, documents)`

---

## PART F — VERIFICATION CHECKLIST

| # | Test | Expected |
|---|------|----------|
| 1 | My Profile page scrolled to bottom | MY RECORD section visible with 3 rows |
| 2 | Click "My Payslips" | Navigates to `/dashboard/profile/payslips` |
| 3 | Back arrow on Payslips | Returns to `/dashboard/profile` |
| 4 | Payslips page — employee has payslips with `shared_with_employee = true` | List renders with net pay prominent |
| 5 | Payslips page — no shared payslips | Empty state message shown |
| 6 | Click "My Leave" | Navigates to `/dashboard/profile/leave` |
| 7 | Leave page — employee has leave requests | List renders with correct status colors |
| 8 | Leave page — approved leave shows green badge | ✓ |
| 9 | Leave page — rejected leave shows red badge + HR note if present | ✓ |
| 10 | Click "My Documents" | Navigates to `/dashboard/profile/documents` |
| 11 | Documents page — employee has docs | List renders with doc name and type |
| 12 | Click open (↗) button on a document | Spinner appears, then file opens in new tab |
| 13 | Click open on a doc with invalid path | "Could not open document" alert shown |
| 14 | All three sub-pages — no data | Empty state shown (not blank/crash) |
| 15 | TypeScript | Zero errors |
