'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

const fmtPunchDt = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso))

interface Punch {
  id: string; employee_name: string; date_time: string
  type_label: 'Clock In' | 'Clock Out'; address: string | null
}
interface Incident {
  id: string; description: string; severity: string; created_at: string
}
interface LeaveReq {
  id: string; employee_name: string; leave_type: string
  start_date: string; status: string
}

type ActivityFilter = 'all' | 'punches' | 'incidents' | 'leave'

const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'punches',   label: 'Punches' },
  { value: 'incidents', label: 'Incidents' },
  { value: 'leave',     label: 'Leave' },
]

function sevenDaysAgoIso() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString()
}

export default function ActivityLogPage() {
  const [punches, setPunches] = useState<Punch[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [leaves, setLeaves] = useState<LeaveReq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    const cid = member.companyId
    const since = sevenDaysAgoIso()

    const [{ data: pData }, { data: iData }, { data: lData }] = await Promise.all([
      supabase.from('time_punches')
        .select('id, type, date_time, address, employees(name, surname)')
        .eq('company_id', cid)
        .gte('date_time', since)
        .order('date_time', { ascending: false })
        .limit(20),
      supabase.from('incident_reports')
        .select('id, description, severity, created_at')
        .eq('company_id', cid)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('leave_requests')
        .select('id, leave_type, start_date, status, employees(name, surname)')
        .eq('company_id', cid)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    setPunches((pData ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { name: string; surname: string } | null
      const punchType = String(r.type ?? '').toLowerCase()
      return {
        id: r.id as string,
        employee_name: emp ? `${emp.name} ${emp.surname}` : '—',
        date_time: r.date_time as string,
        type_label: (punchType === 'out' ? 'Clock Out' : 'Clock In') as 'Clock In' | 'Clock Out',
        address: (r.address as string | null) ?? null,
      }
    }))
    setIncidents((iData ?? []) as Incident[])
    setLeaves((lData ?? []).map((r: Record<string, unknown>) => {
      const emp = r.employees as { name: string; surname: string } | null
      return {
        id: r.id as string,
        employee_name: emp ? `${emp.name} ${emp.surname}` : '—',
        leave_type: r.leave_type as string,
        start_date: r.start_date as string,
        status: r.status as string,
      }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const severityBg = (s: string) => {
    if (s === 'critical') return '#FEE2E2'
    if (s === 'high') return '#FEF3C7'
    if (s === 'medium') return '#DBEAFE'
    return '#DCFCE7'
  }

  const leaveBg = (s: string) => {
    if (s === 'approved') return '#DCFCE7'
    if (s === 'declined') return '#FEE2E2'
    return '#FEF3C7'
  }

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
        <h1 className="text-[20px] font-semibold text-text-primary">Activity Log</h1>
        <button onClick={load} className="text-[13px] text-primary hover:opacity-70 transition-opacity">
          Refresh
        </button>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-divider shrink-0 overflow-x-auto">
        {ACTIVITY_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setActivityFilter(f.value)}
            className="rounded-2xl h-8 px-3 text-[12px] whitespace-nowrap shrink-0 transition-colors"
            style={{
              backgroundColor: activityFilter === f.value ? '#3B82F6' : '#FFFFFF',
              color: activityFilter === f.value ? '#FFFFFF' : '#6B7280',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : (
          <>
            {(activityFilter === 'all' || activityFilter === 'punches') && (
            <div>
              <p className="section-label mb-2">RECENT CLOCK INS/OUTS</p>
              {punches.length === 0 ? (
                <p className="text-text-secondary text-[13px] py-2">No recent punches.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {punches.map(p => (
                    <div key={p.id} className="card p-3 mb-1.5">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <div>
                          <p className="font-semibold text-[13px] text-primary">{p.employee_name}</p>
                          <p className="text-[12px] text-text-secondary">{fmtPunchDt(p.date_time)}</p>
                          {p.address && (
                            <p className="text-[11px] text-text-secondary truncate">{p.address}</p>
                          )}
                        </div>
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] text-text-primary"
                          style={{ backgroundColor: p.type_label === 'Clock In' ? '#DCFCE7' : '#FEE2E2' }}
                        >
                          {p.type_label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {(activityFilter === 'all' || activityFilter === 'incidents') && (
            <div>
              <p className="section-label mb-2">RECENT INCIDENTS</p>
              {incidents.length === 0 ? (
                <p className="text-text-secondary text-[13px] py-2">No recent incidents.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {incidents.map(inc => (
                    <div key={inc.id} className="card p-3">
                      <div className="grid grid-cols-[1fr_auto] items-start gap-3">
                        <div>
                          <p className="font-medium text-[13px] text-text-primary line-clamp-2">
                            {inc.description}
                          </p>
                          <p className="text-[12px] text-text-secondary">{fmtDate(inc.created_at)}</p>
                        </div>
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] text-text-primary shrink-0"
                          style={{ backgroundColor: severityBg(inc.severity) }}
                        >
                          {inc.severity}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {(activityFilter === 'all' || activityFilter === 'leave') && (
            <div>
              <p className="section-label mb-2">RECENT LEAVE REQUESTS</p>
              {leaves.length === 0 ? (
                <p className="text-text-secondary text-[13px] py-2">No recent leave requests.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {leaves.map(l => (
                    <div key={l.id} className="card p-3 mb-1.5">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                        <div>
                          <p className="font-semibold text-[13px] text-primary">{l.employee_name}</p>
                          <p className="text-[12px] text-text-secondary capitalize">
                            {l.leave_type.replace(/_/g, ' ')} · {fmtDate(l.start_date)}
                          </p>
                        </div>
                        <span
                          className="text-[11px] font-semibold px-2 py-0.5 rounded-[10px] text-text-primary shrink-0"
                          style={{ backgroundColor: leaveBg(l.status) }}
                        >
                          {l.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
