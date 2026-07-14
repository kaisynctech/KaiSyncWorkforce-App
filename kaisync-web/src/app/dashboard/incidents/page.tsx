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

const SCOPE_FILTERS = [
  { value: 'all',        label: 'All' },
  { value: 'standalone', label: 'Standalone' },
  { value: 'job',        label: 'Job-linked' },
] as const
type ScopeValue = typeof SCOPE_FILTERS[number]['value']

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

function sevBg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).bg }
function sevFg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).fg }

export default function IncidentsPage() {
  const router = useRouter()
  const [incidents, setIncidents] = useState<IncidentReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeValue>('all')
  const [showOpenOnly, setShowOpenOnly] = useState(true)
  const [searchText, setSearchText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    const { data } = await supabase
      .from('incident_reports')
      .select('*, jobs(title), employees(name, surname)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    setIncidents((data ?? []) as IncidentReport[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function closeIncident(inc: IncidentReport) {
    if (!window.confirm('Close this incident?')) return
    const supabase = createClient()
    await supabase.from('incident_reports').update({ status: 'closed' }).eq('id', inc.id)
    setIncidents(prev => prev.map(i => i.id === inc.id ? { ...i, status: 'closed' } : i))
  }

  const filtered = incidents.filter(inc => {
    if (showOpenOnly && inc.status === 'closed') return false
    if (scope === 'standalone' && inc.job_id) return false
    if (scope === 'job' && !inc.job_id) return false
    if (searchText) {
      const q = searchText.toLowerCase()
      if (
        !(inc.description ?? '').toLowerCase().includes(q) &&
        !(inc.title ?? '').toLowerCase().includes(q) &&
        !(inc.category ?? '').toLowerCase().includes(q)
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface-dark">
        <h1 className="text-[18px] font-semibold text-text-primary">Incident Reports</h1>
        <button onClick={() => router.push('/dashboard/incidents/new')}
          className="btn-primary h-9 px-3 text-[13px]">New</button>
      </div>

      {/* Scope chips */}
      <div className="overflow-x-auto shrink-0">
        <div className="flex gap-2 px-4 py-2">
          {SCOPE_FILTERS.map(f => (
            <button key={f.value} onClick={() => setScope(f.value)}
              className="rounded-2xl h-8 px-3 text-[12px] whitespace-nowrap shrink-0 transition-colors"
              style={{ backgroundColor: scope === f.value ? '#3B82F6' : '#FFFFFF', color: scope === f.value ? '#FFFFFF' : '#6B7280' }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Open / All filter */}
      <div className="flex gap-2 bg-surface-dark px-4 py-2 shrink-0">
        <button onClick={() => setShowOpenOnly(true)}
          className="rounded-2xl px-3 py-1.5 text-[13px] transition-colors"
          style={{ backgroundColor: showOpenOnly ? '#3B82F6' : '#E5E7EB', color: showOpenOnly ? 'white' : '#6B7280' }}>
          Open
        </button>
        <button onClick={() => setShowOpenOnly(false)}
          className="rounded-2xl px-3 py-1.5 text-[13px] transition-colors"
          style={{ backgroundColor: !showOpenOnly ? '#3B82F6' : '#E5E7EB', color: !showOpenOnly ? 'white' : '#6B7280' }}>
          All
        </button>
      </div>

      {/* Search */}
      <div className="mx-4 my-1 shrink-0">
        <input type="search" placeholder="Search incidents…"
          className="w-full bg-surface border border-border text-text-primary placeholder:text-text-disabled rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          value={searchText} onChange={e => setSearchText(e.target.value)} />
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <span className="text-[48px]">✅</span>
            <p className="text-text-secondary text-[14px]">No incidents found</p>
          </div>
        ) : (
          filtered.map(inc => (
            <div key={inc.id}
              className="card p-4 cursor-pointer hover:bg-background transition-colors"
              onClick={() => router.push(`/dashboard/incidents/${inc.id}`)}>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
                <p className="font-semibold text-text-primary">{inc.title ?? inc.description}</p>
                <StatusBadge label={inc.severity} bg={sevBg(inc.severity)} fg={sevFg(inc.severity)} />
                <p className="text-text-secondary text-[12px]">{inc.status}</p>
                <p className="text-text-secondary text-[11px] text-right">{fmtDate(inc.created_at)}</p>
                {inc.jobs?.title && (
                  <p className="text-text-secondary text-[11px] col-span-2">Job: {inc.jobs.title}</p>
                )}
                {inc.employees && (
                  <p className="text-text-secondary text-[11px] col-span-2">
                    Assigned: {inc.employees.name} {inc.employees.surname}
                  </p>
                )}
              </div>
              {inc.status !== 'closed' && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={e => { e.stopPropagation(); closeIncident(inc) }}
                    className="bg-primary text-white rounded-lg px-3 h-8 text-[12px]">
                    Close
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
