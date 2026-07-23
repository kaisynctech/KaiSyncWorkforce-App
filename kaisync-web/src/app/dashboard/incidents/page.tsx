'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { IncidentReport } from '@/types/database'

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high:     { bg: '#FEF3C7', fg: '#92400E' },
  medium:   { bg: '#DBEAFE', fg: '#1E40AF' },
  low:      { bg: '#DCFCE7', fg: '#166534' },
}

type StatusFilter = 'open' | 'all' | 'closed'
type ScopeFilter = 'all' | 'standalone' | 'job'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

function sevBg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).bg }
function sevFg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).fg }

function isOpenIncident(inc: IncidentReport): boolean {
  if (inc.is_closed === true) return false
  const s = (inc.status ?? '').toLowerCase()
  return s === 'open' || s === 'investigating'
}

type IncidentRow = IncidentReport & {
  jobs?: { title: string } | null
  reporter?: { name: string; surname: string } | null
  assignee?: { name: string; surname: string } | null
}

export default function IncidentsPage() {
  const router = useRouter()
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [searchText, setSearchText] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data, error: qErr } = await supabase
      .from('incident_reports')
      .select('*, jobs(title), reporter:employees!employee_id(name, surname), assignee:employees!assignee_id(name, surname)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (qErr) {
      console.error('[Incidents] load failed:', qErr.message)
      setError(qErr.message)
      setIncidents([])
    } else {
      setIncidents((data ?? []) as IncidentRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function closeIncident(inc: IncidentRow) {
    if (!window.confirm('Close this incident?')) return
    const supabase = createClient()
    const { error: uErr } = await supabase
      .from('incident_reports')
      .update({ status: 'closed', is_closed: true })
      .eq('id', inc.id)
    if (uErr) {
      console.error('[Incidents] close failed:', uErr.message)
      return
    }
    setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, status: 'closed', is_closed: true } : i))
  }

  const filtered = incidents.filter(inc => {
    if (statusFilter === 'open' && !isOpenIncident(inc)) return false
    if (statusFilter === 'closed' && isOpenIncident(inc)) return false
    if (scope === 'standalone' && inc.job_id) return false
    if (scope === 'job' && !inc.job_id) return false
    if (severityFilter !== 'all' && (inc.severity ?? '').toLowerCase() !== severityFilter) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      if (
        !(inc.description ?? '').toLowerCase().includes(q) &&
        !(inc.title ?? '').toLowerCase().includes(q) &&
        !(inc.category ?? '').toLowerCase().includes(q) &&
        !(inc.jobs?.title ?? '').toLowerCase().includes(q)
      ) return false
    }
    return true
  })

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Incident Reports</h1>
          <p className="text-[12px] text-text-secondary mt-0.5">{filtered.length} shown</p>
        </div>
        <button onClick={() => router.push('/dashboard/incidents/new')}
          className="btn-primary h-9 px-3 text-[13px]">New</button>
      </div>

      {error && error !== 'not_linked' && (
        <div className="mx-4 mt-3 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">
          Failed to load incidents: {error}
        </div>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-2 items-center border-b border-divider bg-surface shrink-0">
        <div className="flex items-center gap-2 h-10 px-3 bg-background border border-border rounded-lg flex-1 min-w-[180px]">
          <span className="material-icons text-text-disabled text-[18px]">search</span>
          <input
            type="search"
            placeholder="Search title, description, job…"
            className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary"
        >
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          <option value="closed">Closed</option>
        </select>
        <select
          value={scope}
          onChange={e => setScope(e.target.value as ScopeFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary"
        >
          <option value="all">All scopes</option>
          <option value="standalone">Standalone</option>
          <option value="job">Job-linked</option>
        </select>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary capitalize"
        >
          <option value="all">All severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-4 my-3 bg-surface rounded-lg border border-divider overflow-x-auto">
          {loading ? (
            <p className="text-text-secondary text-[13px] text-center py-12">Loading…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-2">
              <span className="material-icons text-[40px] text-text-disabled">verified</span>
              <p className="text-text-secondary text-[14px]">No incidents found</p>
            </div>
          ) : (
            <table className="w-full text-[13px]" style={{ minWidth: 960 }}>
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Title</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Severity</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Status</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Reporter</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Assignee</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Job</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Created</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filtered.map(inc => {
                  const reporter = inc.reporter
                    ? `${inc.reporter.name} ${inc.reporter.surname}`.trim()
                    : '—'
                  const assignee = inc.assignee
                    ? `${inc.assignee.name} ${inc.assignee.surname}`.trim()
                    : '—'
                  return (
                    <tr
                      key={inc.id}
                      className="hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}
                    >
                      <td className="px-4 py-3 font-medium text-text-primary max-w-[220px] truncate">
                        {inc.title ?? inc.description ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={inc.severity} bg={sevBg(inc.severity)} fg={sevFg(inc.severity)} />
                      </td>
                      <td className="px-4 py-3 text-text-secondary capitalize">{inc.status}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[120px]">{reporter}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[120px]">{assignee}</td>
                      <td className="px-4 py-3 text-text-secondary truncate max-w-[140px]">{inc.jobs?.title ?? '—'}</td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">{fmtDate(inc.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {isOpenIncident(inc) && (
                          <button
                            onClick={e => { e.stopPropagation(); void closeIncident(inc) }}
                            className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-medium"
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
