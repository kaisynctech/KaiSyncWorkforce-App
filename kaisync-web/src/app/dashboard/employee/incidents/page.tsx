'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import {
  SEVERITY_STYLES,
  STATUS_STYLES,
  displayIncidentTitle,
  formatIncidentLabel,
  isIncidentOpen,
} from '@/lib/incident-types'
import {
  dequeueIncident,
  getIncidentQueue,
  pendingIncidentCount,
  queuedPhotoToBlob,
  type QueuedIncident,
} from '@/lib/incident-queue'
import { uploadIncidentPhoto } from '@/lib/incident-media'

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
type StatusFilter = 'open' | 'all' | 'closed'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function exportCSV(incidents: Incident[]) {
  const headers = ['Date', 'Title', 'Severity', 'Category', 'Status', 'JobLinked', 'Description']
  const rows = incidents.map(i => [
    fmtDate(i.occurred_at ?? i.created_at),
    displayIncidentTitle(i.title, i.description),
    i.severity ?? '',
    i.category ?? '',
    i.status ?? '',
    i.job_id ? 'Yes' : 'No',
    i.description,
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'incidents.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function EmployeeIncidentsPage() {
  const allowed = useEmployeeModuleGate('incidents')
  const [all, setAll] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [pendingCount, setPendingCount] = useState(0)
  const [replaying, setReplaying] = useState(false)

  const companyIdRef = useRef<string | null>(null)
  const empIdRef = useRef<string | null>(null)
  const tokRef = useRef<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return false }

    companyIdRef.current = member.companyId
    empIdRef.current = member.employeeId
    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_incidents', {
      p_company_id: member.companyId,
      p_employee_id: member.employeeId,
      p_job_id: null,
      p_include_closed: true,
      p_session_token: tok,
    })
    setAll((data as Incident[]) ?? [])
    setPendingCount(pendingIncidentCount())
    setLoading(false)
    return true
  }, [])

  async function replayQueue() {
    const queue = getIncidentQueue()
    if (queue.length === 0) return
    const cid = companyIdRef.current
    const empId = empIdRef.current
    if (!cid || !empId) return

    setReplaying(true)
    const supabase = createClient()
    for (const item of queue) {
      try {
        await submitQueuedIncident(supabase, item, tokRef.current)
        dequeueIncident(item.local_id)
      } catch {
        // leave in queue
      }
    }
    setPendingCount(pendingIncidentCount())
    await loadList()
    setReplaying(false)
  }

  useEffect(() => {
    if (allowed !== true) return
    void (async () => {
      setLoading(true)
      const ok = await loadList()
      if (ok) {
        setCompanyId(companyIdRef.current)
        await replayQueue()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, loadList])

  useEffect(() => {
    const onOnline = () => { void replayQueue() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`incidents-${companyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incident_reports', filter: `company_id=eq.${companyId}` },
        () => { void loadList() },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [companyId, loadList])

  const filtered = all.filter(inc => {
    if (scope === 'standalone' && inc.job_id != null) return false
    if (scope === 'job_linked' && inc.job_id == null) return false

    const open = isIncidentOpen(inc.status, inc.is_closed)
    if (status === 'open' && !open) return false
    if (status === 'closed' && open) return false

    if (search.trim()) {
      const q = search.toLowerCase()
      const haystack = `${inc.title ?? ''} ${inc.description} ${inc.severity ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  function emptyMessage(): string {
    if (pendingCount > 0) return `${pendingCount} report(s) waiting to sync when online.`
    if (scope === 'standalone') return 'No standalone incidents. Tap New to report one.'
    if (scope === 'job_linked') return 'No job-linked incidents yet.'
    if (status === 'open') return 'No open incidents.'
    return 'No incidents found.'
  }

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">My Incidents</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCSV(filtered)}
            title="Export CSV"
            className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors"
          >
            <span className="material-icons text-[16px]">file_download</span>
          </button>
          <Link
            href="/dashboard/employee/incidents/new"
            className="flex items-center gap-1.5 bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
          >
            <span className="material-icons text-[16px]">add</span>New
          </Link>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="px-4 py-2 bg-warning/10 border-b border-warning/30 flex items-center justify-between gap-3">
          <p className="text-[12px] text-warning font-semibold">
            {pendingCount} offline report{pendingCount === 1 ? '' : 's'} pending sync
            {replaying ? ' — syncing…' : ''}
          </p>
          <button
            type="button"
            onClick={() => void replayQueue()}
            disabled={replaying}
            className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="px-4 pt-3 pb-2 border-b border-divider shrink-0 space-y-2 bg-surface">
        <div className="flex gap-2 flex-wrap">
          {([
            ['all', 'All'],
            ['standalone', 'Standalone'],
            ['job_linked', 'Job-linked'],
          ] as [ScopeFilter, string][]).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                scope === s
                  ? 'bg-primary text-white'
                  : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {([
            ['open', 'Open'],
            ['all', 'All'],
            ['closed', 'Closed'],
          ] as [StatusFilter, string][]).map(([s, label]) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                status === s
                  ? 'bg-text-primary text-surface'
                  : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-text-disabled text-[18px]">search</span>
          <input
            className="input pl-9 text-[13px] w-full"
            type="text"
            placeholder="Search incidents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

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
                      <Link
                        href={`/dashboard/employee/incidents/${inc.id}`}
                        className="text-[13px] font-semibold text-primary hover:underline"
                      >
                        {displayIncidentTitle(inc.title, inc.description)}
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
                      {formatIncidentLabel(inc.category)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {inc.status ? (
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[inc.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {formatIncidentLabel(inc.status)}
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

async function submitQueuedIncident(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  item: QueuedIncident,
  sessionToken: string | null,
) {
  const photoUrls: string[] = []
  for (const photo of item.photos) {
    const blob = queuedPhotoToBlob(photo)
    const path = await uploadIncidentPhoto({
      supabase,
      companyId: item.company_id,
      employeeId: item.employee_id,
      file: blob,
      fileName: photo.name,
      sessionToken,
      softFail: true,
    })
    if (path) photoUrls.push(path)
  }

  const { error } = await supabase.rpc('employee_insert_incident', {
    p_company_id: item.company_id,
    p_employee_id: item.employee_id,
    p_description: item.description,
    p_severity: item.severity,
    p_job_id: item.job_id,
    p_site_id: item.site_id,
    p_assignee_id: item.assignee_id,
    p_photo_urls: photoUrls.length > 0 ? photoUrls : null,
    p_reported_by_name: item.reported_by_name,
    p_title: item.title,
    p_category: item.category,
    p_occurred_at: item.occurred_at,
    p_latitude: item.latitude,
    p_longitude: item.longitude,
    p_location_text: item.location_text,
    p_session_token: sessionToken,
  })
  if (error) throw error
}
