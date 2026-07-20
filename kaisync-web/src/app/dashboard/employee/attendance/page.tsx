'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Punch {
  id: string
  type: 'in' | 'out'
  date_time: string
  latitude: number | null
  longitude: number | null
  address: string | null
  job_id: string | null
  notes: string | null
}

type Range = 'today' | '7d' | '30d' | 'custom'

function fmt(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}
function toDateStr(d: Date): string { return d.toISOString().split('T')[0] }

function exportCSV(punches: Punch[]) {
  const headers = ['Date', 'Time', 'Type', 'Address', 'Notes']
  const rows = punches.map(p => [
    fmtDate(p.date_time),
    fmt(p.date_time),
    p.type === 'in' ? 'Clock In' : 'Clock Out',
    p.address ?? (p.latitude != null ? `${p.latitude.toFixed(5)}, ${p.longitude?.toFixed(5)}` : ''),
    p.notes ?? '',
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'attendance.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function printPDF(punches: Punch[], empName: string, fromLabel: string, toLabel: string) {
  const rows = punches.map(p => `
    <tr>
      <td>${fmtDate(p.date_time)}</td>
      <td>${fmt(p.date_time)}</td>
      <td>${p.type === 'in' ? 'Clock In' : 'Clock Out'}</td>
      <td>${p.address ?? (p.latitude != null ? `${p.latitude.toFixed(5)}, ${p.longitude?.toFixed(5)}` : '—')}</td>
      <td>${p.notes ?? ''}</td>
    </tr>
  `).join('')
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(`<!DOCTYPE html><html><head><title>Attendance Report</title><style>
    body { font-family: sans-serif; font-size: 12px; padding: 20px; }
    h2 { font-size: 16px; margin-bottom: 4px; }
    p { margin: 2px 0 12px; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    @media print { button { display: none; } }
  </style></head><body>
    <h2>Attendance Report — ${empName}</h2>
    <p>Period: ${fromLabel} to ${toLabel}</p>
    <table>
      <thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Location</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <br><button onclick="window.print()">Print / Save PDF</button>
  </body></html>`)
  w.document.close()
}

export default function EmployeeAttendancePage() {
  const [punches,    setPunches]    = useState<Punch[]>([])
  const [loading,    setLoading]    = useState(true)
  const [range,      setRange]      = useState<Range>('7d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [empName,    setEmpName]    = useState('Employee')

  useEffect(() => { load() }, [range, customFrom, customTo])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null

    const now = new Date()
    let fromDate: string
    let toDate: string = toDateStr(now)

    if (range === 'today') {
      fromDate = toDateStr(now)
    } else if (range === '7d') {
      const d = new Date(now); d.setDate(d.getDate() - 7)
      fromDate = toDateStr(d)
    } else if (range === '30d') {
      const d = new Date(now); d.setDate(d.getDate() - 30)
      fromDate = toDateStr(d)
    } else {
      fromDate = customFrom || toDateStr(new Date(now.getTime() - 30 * 86400000))
      toDate   = customTo   || toDateStr(now)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.rpc as any)('employee_get_my_punches', {
      p_employee_id:   member.employeeId,
      p_company_id:    member.companyId,
      p_from:          fromDate,
      p_to:            toDate,
      p_session_token: tok,
    })
    const sorted = ((data as Punch[]) ?? []).slice().sort(
      (a, b) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
    )
    setPunches(sorted)

    // Get name for PDF header
    const { data: empRow } = await supabase
      .from('employees')
      .select('name, surname')
      .eq('id', member.employeeId)
      .maybeSingle()
    if (empRow) setEmpName(`${empRow.name} ${empRow.surname}`)

    setLoading(false)
  }

  function rangeLabel(): [string, string] {
    const now = new Date()
    if (range === 'today') return [toDateStr(now), toDateStr(now)]
    if (range === '7d')    return [toDateStr(new Date(now.getTime() - 7 * 86400000)), toDateStr(now)]
    if (range === '30d')   return [toDateStr(new Date(now.getTime() - 30 * 86400000)), toDateStr(now)]
    return [customFrom || '—', customTo || toDateStr(now)]
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold text-text-primary">Attendance</h1>
          <div className="flex gap-2">
            <button onClick={() => exportCSV(punches)} title="Export Excel (CSV)"
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors"
              disabled={punches.length === 0}>
              <span className="material-icons text-[16px]">table_chart</span>
            </button>
            <button onClick={() => { const [f, t] = rangeLabel(); printPDF(punches, empName, f, t) }}
              title="Export PDF"
              className="flex items-center gap-1 text-[12px] font-semibold text-text-secondary border border-divider px-2.5 py-1.5 rounded-lg hover:border-primary hover:text-primary transition-colors"
              disabled={punches.length === 0}>
              <span className="material-icons text-[16px]">picture_as_pdf</span>
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {(['today', '7d', '30d', 'custom'] as Range[]).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                range === r ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider hover:border-primary'
              }`}>
              {r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Custom'}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex gap-3 mt-3">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="input text-[13px]" placeholder="From" />
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="input text-[13px]" placeholder="To" />
          </div>
        )}
      </div>

      {/* Summary bar */}
      {!loading && punches.length > 0 && (
        <div className="flex gap-6 px-4 py-3 bg-surface-elevated border-b border-divider shrink-0">
          <div>
            <p className="text-[11px] text-text-disabled uppercase font-semibold">Punches</p>
            <p className="text-[18px] font-bold text-text-primary">{punches.length}</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-text-secondary text-[14px]">Loading…</div>
        ) : punches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
            <span className="material-icons text-[48px] text-text-disabled">schedule</span>
            <p className="text-[14px]">No attendance records</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Time</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Location</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {punches.map(p => (
                  <tr key={p.id} className="hover:bg-surface-elevated transition-colors">
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {fmtDate(p.date_time)}
                    </td>
                    <td className="px-4 py-3 text-[13px] font-medium text-text-primary whitespace-nowrap">
                      {fmt(p.date_time)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[11px] font-semibold px-2 py-[2px] rounded-full ${
                        p.type === 'in'
                          ? 'bg-success/10 text-success'
                          : 'bg-surface-elevated text-text-secondary border border-divider'
                      }`}>
                        {p.type === 'in' ? 'Clock In' : 'Clock Out'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-secondary max-w-[200px] truncate">
                      {p.address ?? (
                        p.latitude != null
                          ? <span className="text-text-disabled">{p.latitude.toFixed(5)}, {p.longitude?.toFixed(5)}</span>
                          : <span className="text-text-disabled">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-disabled italic">
                      {p.notes ?? '—'}
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
