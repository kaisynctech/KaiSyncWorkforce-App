'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Incident {
  id: string
  title: string | null
  description: string
  severity: string | null
  category: string | null
  status: string | null
  occurred_at: string | null
  location_text: string | null
  created_at: string
  job_id: string | null
  is_closed: boolean | null
}

type ScopeFilter = 'all' | 'standalone' | 'job_linked'
type StatusFilter = 'open' | 'closed'

const SEVERITY_STYLES: Record<string, string> = {
  low:      'bg-surface-elevated text-text-secondary border border-divider',
  medium:   'bg-warning/10 text-warning',
  high:     'bg-error/10 text-error',
  critical: 'bg-error text-white',
}
const STATUS_STYLES: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  under_review:'bg-warning/10 text-warning',
  resolved:    'bg-success/10 text-success',
  closed:      'bg-surface-elevated text-text-secondary',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function exportCSV(incidents: Incident[]) {
  const headers = ['Title', 'Description', 'Severity', 'Status', 'Occurred At', 'Location']
  const rows = incidents.map(i => [
    i.title ?? '',
    i.description,
    i.severity ?? '',
    i.status ?? '',
    i.occurred_at ? fmtDate(i.occurred_at) : '',
    i.location_text ?? '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'incidents.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function EmployeeIncidentsPage() {
  const [all,     setAll]     = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [scope,   setScope]   = useState<ScopeFilter>('all')
  const [status,  setStatus]  = useState<StatusFilter>('open')
  const [search,  setSearch]  = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_own_incidents', {
      p_employee_id:   member.employeeId,
      p_company_id:    member.companyId,
      p_session_token: tok,
    })
    setAll((data as Incident[]) ?? [])
    setLoading(false)
  }

  // Client-side filters
  const filtered = all.filter(inc => {
    // Scope
    if (scope === 'standalone'  && inc.job_id != null) return false
    if (scope === 'job_linked'  && inc.job_id == null) return false
    // Status
    const isClosed = inc.status === 'closed' || inc.is_closed === true
    if (status === 'open'   && isClosed)  return false
    if (status === 'closed' && !isClosed) return false
    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      const haystack = `${inc.title ?? ''} ${inc.description} ${inc.location_text ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  function emptyMessage(): string {
    if (scope === 'standalone') return 'No standalone incidents. Tap New to report one.'
    if (scope === 'job_linked') return 'No job-linked incidents yet.'
    return 'No incidents found.'
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Incidents</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCSV(filtered)} title="Export CSV"
            className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors">
            <span className="material-icons text-[16px]">file_download</span>
          </button>
          <Link href="/dashboard/employee/incidents/new"
            className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors">
            <span className="material-icons text-[16px]">add</span>New
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pt-3 pb-2 border-b border-divider shrink-0 space-y-2 bg-surface">
        {/* Scope filter */}
        <div className="flex gap-2">
          {(['all', 'standalone', 'job_linked'] as ScopeFilter[]).map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                scope === s ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}>
              {s === 'all' ? 'All' : s === 'standalone' ? 'Standalone' : 'Job-linked'}
            </button>
          ))}
        </div>
        {/* Status filter */}
        <div className="flex gap-2">
          {(['open', 'closed'] as StatusFilter[]).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full capitalize transition-colors ${
                status === s ? 'bg-text-primary text-surface' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}>{s}</button>
          ))}
        </div>
        {/* Search */}
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled text-[18px]">search</span>
          <input className="input pl-9 text-[13px] w-full" type="text" placeholder="Search incidents…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">report_off</span>
            <p className="text-[14px]">{emptyMessage()}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Title</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Severity</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Job</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filtered.map(inc => (
                  <tr key={inc.id} className="hover:bg-surface-elevated transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/employee/incidents/${inc.id}`}
                        className="text-[13px] font-semibold text-primary hover:underline">
                        {inc.title ?? inc.description}
                      </Link>
                      {inc.title && inc.description && (
                        <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{inc.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {inc.severity ? (
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${SEVERITY_STYLES[inc.severity] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {inc.severity}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary capitalize">
                      {inc.category ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {inc.status ? (
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[inc.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {inc.status.replace(/_/g, ' ')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {fmtDate(inc.occurred_at ?? inc.created_at)}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {inc.job_id ? (
                        <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-primary/10 text-primary">Linked</span>
                      ) : (
                        <span className="text-text-disabled">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
