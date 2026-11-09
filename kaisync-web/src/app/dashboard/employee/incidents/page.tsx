'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  pendingIncidentCount,
} from '@/lib/incident-queue'
import { flushEmployeeOffline } from '@/lib/offline/flush'
import {
  ResponsiveDataView,
  DataCard,
  DataCardTitle,
  DataCardMeta,
  DataCardRow,
} from '@/components/ui/ResponsiveDataView'
import {
  StatusFilterTabs,
  MONEY_TH,
  MONEY_TD,
  type StatusTabDef,
} from '@/components/ui/StatusFilterTabs'
import {
  ResetFiltersButton,
  TextHeaderFilter,
  StatusHeaderFilter,
  matchText,
  statusTab,
  type ColumnOption,
} from '@/components/ui/MoneyListFilters'

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

/** Scope / status tabs filter client-side by job link and open state, so `match` stays null. */
const SCOPE_TABS: StatusTabDef[] = [
  { ...statusTab('all', 'All', [], 'slate'), match: null },
  { ...statusTab('standalone', 'Standalone', [], 'blue'), match: null },
  { ...statusTab('job_linked', 'Job-linked', [], 'indigo'), match: null },
]

const STATUS_TABS: StatusTabDef[] = [
  { ...statusTab('open', 'Open', [], 'amber'), match: null },
  { ...statusTab('all', 'All', [], 'slate'), match: null },
  { ...statusTab('closed', 'Closed', [], 'green'), match: null },
]

const SEVERITY_OPTIONS: ColumnOption[] = Object.keys(SEVERITY_STYLES).map((id) => ({
  id,
  label: formatIncidentLabel(id).replace(/\b\w/g, (c) => c.toUpperCase()),
}))

const STATUS_OPTIONS: ColumnOption[] = Object.keys(STATUS_STYLES).map((id) => ({
  id,
  label: formatIncidentLabel(id).replace(/\b\w/g, (c) => c.toUpperCase()),
}))

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
  const router = useRouter()
  const allowed = useEmployeeModuleGate('incidents')
  const [all, setAll] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [titleCol, setTitleCol] = useState('')
  const [categoryCol, setCategoryCol] = useState('')
  const [severityCol, setSeverityCol] = useState<string[]>([])
  const [statusCol, setStatusCol] = useState<string[]>([])
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

  /**
   * Upload queued reports. The list is reloaded only when something was uploaded,
   * unless `alwaysReload` (coming back online: the list may have loaded while offline).
   */
  async function replayQueue(options?: { alwaysReload?: boolean }) {
    const cid = companyIdRef.current
    const empId = empIdRef.current
    if (!cid || !empId) return

    setReplaying(true)
    const supabase = createClient()
    const result = await flushEmployeeOffline(supabase, {
      companyId: cid,
      employeeId: empId,
      sessionToken: tokRef.current,
      refreshPack: false,
    })
    setPendingCount(pendingIncidentCount())
    if (options?.alwaysReload || result.flushed > 0) await loadList()
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
    const onOnline = () => { void replayQueue({ alwaysReload: true }) }
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

    const titleNeedle = titleCol.trim()
    if (
      titleNeedle &&
      !matchText(displayIncidentTitle(inc.title, inc.description), titleNeedle) &&
      !matchText(inc.description, titleNeedle)
    ) return false
    if (!matchText(formatIncidentLabel(inc.category), categoryCol.trim())) return false
    if (severityCol.length > 0 && !severityCol.includes((inc.severity ?? '').toLowerCase())) return false
    if (statusCol.length > 0 && !statusCol.includes((inc.status ?? '').toLowerCase())) return false
    return true
  })

  const hasColumnFilters =
    titleCol.trim() !== '' || categoryCol.trim() !== '' || severityCol.length > 0 || statusCol.length > 0
  const hasFilters = hasColumnFilters || scope !== 'all' || status !== 'open'

  function resetFilters() {
    setScope('all')
    setStatus('open')
    setTitleCol('')
    setCategoryCol('')
    setSeverityCol([])
    setStatusCol([])
  }

  function emptyMessage(): string {
    if (pendingCount > 0) return `${pendingCount} report(s) waiting to sync when online.`
    if (hasColumnFilters) return 'No incidents match your column filters.'
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
            onClick={() => void replayQueue({ alwaysReload: true })}
            disabled={replaying}
            className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="px-4 pt-3 pb-2 border-b border-divider shrink-0 space-y-2 bg-surface">
        <div className="flex flex-wrap items-center gap-2">
          <ResetFiltersButton disabled={!hasFilters} onReset={resetFilters} />
          <StatusFilterTabs
            tabs={SCOPE_TABS}
            value={scope}
            counts={{}}
            onChange={id => setScope(id as ScopeFilter)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterTabs
            tabs={STATUS_TABS}
            value={status}
            counts={{}}
            onChange={id => setStatus(id as StatusFilter)}
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
          <ResponsiveDataView
            table={
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated">
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="Title" value={titleCol} onChange={setTitleCol} placeholder="Title or description…" />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <StatusHeaderFilter label="Severity" options={SEVERITY_OPTIONS} selected={severityCol} onChange={setSeverityCol} />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <TextHeaderFilter label="Category" value={categoryCol} onChange={setCategoryCol} placeholder="Category…" />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>
                      <StatusHeaderFilter label="Status" options={STATUS_OPTIONS} selected={statusCol} onChange={setStatusCol} />
                    </th>
                    <th className={`${MONEY_TH} text-left`}>Date</th>
                    <th className={`${MONEY_TH} text-left`}>Job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {filtered.map(inc => (
                    <tr key={inc.id} className="hover:bg-surface-elevated transition-colors">
                      <td className={MONEY_TD}>
                        <Link
                          href={`/dashboard/employee/incidents/${inc.id}`}
                          className="text-[12px] font-semibold text-primary hover:underline"
                        >
                          {displayIncidentTitle(inc.title, inc.description)}
                        </Link>
                        {inc.title && inc.description && (
                          <p className="text-[11px] text-text-disabled mt-0.5 line-clamp-1">{inc.description}</p>
                        )}
                      </td>
                      <td className={`${MONEY_TD} whitespace-nowrap`}>
                        {inc.severity ? (
                          <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${SEVERITY_STYLES[inc.severity] ?? 'bg-surface-elevated text-text-secondary'}`}>
                            {inc.severity}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary capitalize`}>
                        {formatIncidentLabel(inc.category)}
                      </td>
                      <td className={`${MONEY_TD} whitespace-nowrap`}>
                        {inc.status ? (
                          <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize ${STATUS_STYLES[inc.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
                            {formatIncidentLabel(inc.status)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>
                        {fmtDate(inc.occurred_at ?? inc.created_at)}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>
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
            }
            mobile={
              <>
                {filtered.map(inc => (
                  <DataCard
                    key={inc.id}
                    onClick={() => router.push(`/dashboard/employee/incidents/${inc.id}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <DataCardTitle className="flex-1">
                        {displayIncidentTitle(inc.title, inc.description)}
                      </DataCardTitle>
                      {inc.severity && (
                        <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full capitalize shrink-0 ${SEVERITY_STYLES[inc.severity] ?? 'bg-surface-elevated text-text-secondary'}`}>
                          {inc.severity}
                        </span>
                      )}
                    </div>
                    <DataCardMeta>
                      {inc.status ? formatIncidentLabel(inc.status) : '—'} · {fmtDate(inc.occurred_at ?? inc.created_at)}
                    </DataCardMeta>
                    <DataCardRow label="Category" value={formatIncidentLabel(inc.category)} />
                  </DataCard>
                ))}
              </>
            }
          />
        )}
      </div>
    </div>
  )
}

