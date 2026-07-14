'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { formatDateTime } from '@/lib/utils'
import type { TimesheetPunch } from '@/types/database'

// ─── Types ────────────────────────────────────────────────────────────────────

type Preset = 'today' | 'week' | 'month' | 'all' | 'custom'

type PunchSession = {
  id: string
  employeeId: string
  employeeName: string
  employeeCode: string
  punchIn: string
  punchOut: string | null
  hoursWorked: number
  pay: number
  isLate: boolean
  isOvertime: boolean
  status: 'active' | 'completed'
}

type PayrollSettings = {
  late_threshold_minutes: number | null
  overtime_threshold_hours: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split('T')[0]

function getRange(
  preset: Preset,
  customFrom: string,
  customTo: string
): { from: string; to: string } {
  const t = todayStr()
  if (preset === 'today') return { from: t, to: t }
  if (preset === 'week') {
    const d = new Date()
    const mon = new Date(d)
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return { from: mon.toISOString().split('T')[0], to: t }
  }
  if (preset === 'month') {
    const d = new Date()
    return { from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, to: t }
  }
  if (preset === 'all') return { from: '2020-01-01', to: t }
  return { from: customFrom, to: customTo }
}

function buildSessions(
  punches: TimesheetPunch[],
  ps: PayrollSettings | null
): PunchSession[] {
  const lateThreshold = ps?.late_threshold_minutes ?? 30
  const otThreshold   = ps?.overtime_threshold_hours ?? 8

  return punches.map(p => {
    const emp = p.employees as {
      name: string
      surname: string
      employee_code: string | null
      hourly_rate: number | null
    } | undefined

    const hours      = p.hours_worked ?? 0
    const rate       = emp?.hourly_rate ?? 0
    const shiftStart = (p as unknown as Record<string, unknown>).shift_start_time as string | null | undefined
    const isLate     = shiftStart
      ? (new Date(p.punch_in).getTime() - new Date(shiftStart).getTime()) / 60000 > lateThreshold
      : false

    return {
      id:           p.id,
      employeeId:   p.employee_id,
      employeeName: `${emp?.name ?? ''} ${emp?.surname ?? ''}`.trim() || 'Unknown',
      employeeCode: emp?.employee_code ?? '',
      punchIn:      p.punch_in,
      punchOut:     p.punch_out ?? null,
      hoursWorked:  hours,
      pay:          rate * hours,
      isLate,
      isOvertime:   hours > otThreshold,
      status:       p.punch_out ? 'completed' : 'active',
    }
  })
}

function exportCSV(sessions: PunchSession[], from: string, to: string) {
  const header = 'Employee,Code,Clock In,Clock Out,Hours,Pay,Late,OT'
  const rows = sessions.map(s =>
    [
      `"${s.employeeName.replace(/"/g, '""')}"`,
      s.employeeCode,
      s.punchIn,
      s.punchOut ?? '',
      s.hoursWorked.toFixed(2),
      s.pay.toFixed(2),
      s.isLate ? 'Yes' : 'No',
      s.isOvertime ? 'Yes' : 'No',
    ].join(',')
  )
  const csv  = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `attendance_${from}_to_${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today'      },
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All'        },
  { key: 'custom', label: 'Custom'    },
]

export default function AttendancePage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [sessions,  setSessions]  = useState<PunchSession[]>([])
  const [preset,    setPreset]    = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(todayStr())
  const [customTo,   setCustomTo]   = useState(todayStr())
  const [search,    setSearch]    = useState('')
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  // Refs keep the realtime callback pointing at current values without
  // requiring the subscription to be torn down on every range change.
  const companyIdRef  = useRef<string | null>(null)
  const settingsRef   = useRef<PayrollSettings | null>(null)
  const presetRef     = useRef<Preset>('today')
  const customFromRef = useRef(todayStr())
  const customToRef   = useRef(todayStr())

  presetRef.current     = preset
  customFromRef.current = customFrom
  customToRef.current   = customTo

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { init() }, [])

  async function init() {
    const supabase = createClient()
    const member   = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }

    companyIdRef.current = member.companyId
    setCompanyId(member.companyId)

    const { data: ps } = await supabase
      .from('payroll_settings')
      .select('late_threshold_minutes, overtime_threshold_hours')
      .eq('company_id', member.companyId)
      .maybeSingle()
    settingsRef.current = ps ?? null

    await fetchPunchesWithParams(member.companyId, ps ?? null)
  }

  // ── Re-load when range changes ────────────────────────────────────────────
  useEffect(() => {
    if (companyId) fetchPunches()
  }, [preset, customFrom, customTo])

  // ── Realtime subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const channel  = supabase
      .channel('attendance-realtime')
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'timesheet_punches',
          filter: `company_id=eq.${companyId}`,
        },
        () => { fetchPunches() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  // ── Data fetch ────────────────────────────────────────────────────────────
  function fetchPunches() {
    if (!companyIdRef.current) return
    fetchPunchesWithParams(companyIdRef.current, settingsRef.current)
  }

  async function fetchPunchesWithParams(cid: string, ps: PayrollSettings | null) {
    setLoading(true)
    const supabase      = createClient()
    const { from, to }  = getRange(presetRef.current, customFromRef.current, customToRef.current)

    const { data } = await supabase
      .from('timesheet_punches')
      .select('*, employees(name, surname, employee_code, hourly_rate)')
      .eq('company_id', cid)
      .gte('punch_in', `${from}T00:00:00`)
      .lte('punch_in', `${to}T23:59:59`)
      .order('punch_in', { ascending: false })

    setSessions(buildSessions((data ?? []) as TimesheetPunch[], ps))
    setLoading(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const { from, to } = getRange(preset, customFrom, customTo)

  const filtered = sessions.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.employeeName.toLowerCase().includes(q) || s.employeeCode.toLowerCase().includes(q)
  })

  const onSite     = sessions.filter(s => s.status === 'active').length
  const completed  = sessions.filter(s => s.status === 'completed').length
  const totalHours = sessions.reduce((sum, s) => sum + s.hoursWorked, 0)
  const totalPay   = sessions.reduce((sum, s) => sum + s.pay, 0)

  // ── Not-linked guard ──────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Attendance</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{sessions.length} sessions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportCSV(sessions, from, to)}
            className="h-10 px-4 text-[13px] font-medium rounded-lg border border-border bg-surface text-text-primary hover:bg-background transition-colors"
          >
            Export CSV
          </button>
          <button
            disabled
            className="h-10 px-4 text-[13px] font-medium rounded-lg border border-border bg-surface text-text-disabled cursor-not-allowed"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Period preset pills */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`h-8 px-3 rounded-full text-[12px] font-medium transition-colors ${
              preset === p.key
                ? 'bg-primary text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 px-2 bg-surface border border-border rounded-md text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-text-secondary text-[12px]">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 px-2 bg-surface border border-border rounded-md text-[12px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-primary">{onSite}</p>
          <p className="text-[12px] text-text-secondary">Currently on site</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-success">{completed}</p>
          <p className="text-[12px] text-text-secondary">Completed shifts</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-text-primary">{totalHours.toFixed(1)}h</p>
          <p className="text-[12px] text-text-secondary">Total hours</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-text-primary">R{totalPay.toFixed(2)}</p>
          <p className="text-[12px] text-text-secondary">Total pay</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md mb-4 w-full max-w-sm">
        <span className="material-icons text-text-disabled text-[18px]">search</span>
        <input
          type="text"
          placeholder="Filter by name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
        />
      </div>

      {/* Table */}
      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">schedule</span>
            <p className="text-[14px] text-text-secondary">No attendance records for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Clock In</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Clock Out</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Hours</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Pay</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} className="border-b border-divider last:border-0 hover:bg-background transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-text-primary">{s.employeeName}</p>
                      {s.employeeCode && (
                        <p className="text-[11px] text-text-secondary font-mono">{s.employeeCode}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{formatDateTime(s.punchIn)}</td>
                    <td className="px-5 py-3 text-text-secondary">
                      {s.punchOut ? formatDateTime(s.punchOut) : '—'}
                    </td>
                    <td className="px-5 py-3 font-semibold text-text-primary">
                      {s.hoursWorked > 0 ? `${s.hoursWorked.toFixed(1)}h` : '—'}
                    </td>
                    <td className="px-5 py-3 text-text-primary">
                      {s.pay > 0 ? `R${s.pay.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`flex items-center gap-1 text-[12px] font-medium w-fit ${
                        s.status === 'active' ? 'text-success' : 'text-text-secondary'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'active' ? 'bg-success' : 'bg-text-disabled'
                        }`} />
                        {s.status === 'active' ? 'On site' : 'Completed'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        {s.isLate && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-error/10 text-error">
                            Late
                          </span>
                        )}
                        {s.isOvertime && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-warning/10 text-warning">
                            OT
                          </span>
                        )}
                      </div>
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
