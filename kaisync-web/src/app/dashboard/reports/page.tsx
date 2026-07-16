'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

type Preset = '7d' | '30d' | 'month' | 'year'
type TabKey = 'executive' | 'financial' | 'payroll' | 'workforce' | 'operational' |
  'incidents' | 'inventory' | 'contractors' | 'property' | 'telemetry' | 'exports'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'executive',   label: 'Executive' },
  { key: 'financial',   label: 'Financial' },
  { key: 'payroll',     label: 'Payroll' },
  { key: 'workforce',   label: 'Workforce' },
  { key: 'operational', label: 'Operational' },
  { key: 'incidents',   label: 'Incidents' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'contractors', label: 'Contractors' },
  { key: 'property',    label: 'Property' },
  { key: 'telemetry',   label: 'Telemetry' },
  { key: 'exports',     label: 'Exports' },
]

// RPC names — all use signature (p_company_id uuid, p_from date, p_to date) → jsonb
const RPC_MAP: Partial<Record<TabKey, string>> = {
  executive:   'hr_get_executive_snapshot',
  financial:   'hr_get_financial_snapshot',
  payroll:     'hr_get_payroll_snapshot',
  workforce:   'hr_get_workforce_snapshot',
  operational: 'hr_get_operational_snapshot',
  incidents:   'hr_get_incidents_snapshot',
  inventory:   'hr_get_inventory_snapshot',
  contractors: 'hr_get_contractors_snapshot',
  property:    'hr_get_property_snapshot',
  telemetry:   'hr_get_telemetry_snapshot',
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtR = (n: number | null | undefined) =>
  n == null ? 'R —' : `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtN = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-ZA')

function getPeriod(preset: Preset): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().split('T')[0]
  if (preset === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7)
    return { start: d.toISOString().split('T')[0], end }
  }
  if (preset === '30d') {
    const d = new Date(now); d.setDate(d.getDate() - 30)
    return { start: d.toISOString().split('T')[0], end }
  }
  if (preset === 'month') {
    return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, end }
  }
  // SA tax year starts March 1
  const y = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
  return { start: `${y}-03-01`, end }
}

function presetLabel(p: Preset) {
  const { start, end } = getPeriod(p)
  return `${start} → ${end}`
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function Kpi({ title, value, caption }: { title: string; value: string; caption?: string }) {
  return (
    <div className="bg-surface-card border border-divider rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[10px] text-text-secondary uppercase tracking-wide">{title}</p>
      <p className="text-base font-bold text-text-primary leading-tight">{value}</p>
      {caption && <p className="text-[10px] text-text-secondary">{caption}</p>}
    </div>
  )
}

function ChartBox({ title, data, dataKey, type = 'line', height = 140 }: {
  title: string; data: Record<string, unknown>[]; dataKey: string
  type?: 'line' | 'bar'; height?: number
}) {
  return (
    <div className="bg-surface-card border border-divider rounded-xl p-4 mt-4">
      <p className="text-xs font-semibold text-text-secondary mb-3">{title}</p>
      {data.length === 0 ? (
        <div className="flex items-center justify-center text-text-secondary text-xs" style={{ height }}>
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {type === 'bar' ? (
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey={dataKey} fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey={dataKey} stroke="#3B82F6" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}

type RpcData = Record<string, unknown>

// ─── Data hook ────────────────────────────────────────────────────────────────

function useTabData(preset: Preset, activeTab: TabKey, companyId: string | null) {
  const [data, setData]       = useState<RpcData | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch = useCallback(async () => {
    const rpc = RPC_MAP[activeTab]
    if (!rpc || activeTab === 'exports' || !companyId) return
    setLoading(true)
    const { start, end } = getPeriod(preset)
    const supabase = createClient()
    try {
      const { data: d } = await supabase.rpc(rpc, {
        p_company_id: companyId,
        p_from:       start,
        p_to:         end,
      })
      setData(d as RpcData ?? null)
    } catch {
      setData(null)
    }
    setLoading(false)
  }, [preset, activeTab, companyId])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, refresh: fetch }
}

// ─── Tab components ───────────────────────────────────────────────────────────

// Executive — shows totals from our RPC: total_employees, on_site_today,
// open_jobs, pending_leave, total_hours, total_payroll + two trend charts
function ExecTab({ data }: { data: RpcData | null }) {
  const d            = data ?? {}
  const chartRevenue = (d.revenue_trend    as Record<string, unknown>[] | null) ?? []
  const chartAttend  = (d.attendance_trend as Record<string, unknown>[] | null) ?? []

  return (
    <div className="space-y-4">
      <div>
        <p className="section-label mb-2">WORKFORCE</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Kpi title="Total Employees"  value={fmtN(d.total_employees as number)} />
          <Kpi title="On Site Today"    value={fmtN(d.on_site_today   as number)} />
          <Kpi title="Open Jobs"        value={fmtN(d.open_jobs       as number)} />
          <Kpi title="Pending Leave"    value={fmtN(d.pending_leave   as number)} />
        </div>
      </div>
      <div>
        <p className="section-label mb-2">FINANCIALS</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Kpi title="Hours Logged"     value={`${(d.total_hours as number ?? 0).toFixed(1)}h`} />
          <Kpi title="Payroll Total"    value={fmtR(d.total_payroll   as number)} />
        </div>
      </div>
      <ChartBox title="Payroll trend"   data={chartRevenue} dataKey="value" type="bar" />
      <ChartBox title="Attendance trend" data={chartAttend}  dataKey="value" type="line" />
    </div>
  )
}

// Financial — Phase 2 stub; shows empty state clearly
function FinancialTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">bar_chart</span>
        <p className="text-[14px] text-text-secondary font-semibold">Financial analytics coming in Phase 2</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Revenue"     value={fmtR(d.revenue     as number)} />
        <Kpi title="Outstanding" value={fmtR(d.outstanding as number)} />
        <Kpi title="Payables"    value={fmtR(d.payables    as number)} />
        <Kpi title="Profit"      value={fmtR(d.profit      as number)} />
      </div>
      <ChartBox title="Revenue vs Expenses" data={(d.revenue_vs_expenses as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" height={160} />
    </div>
  )
}

// Payroll — shows totals from our RPC + payroll_by_employee table
function PayrollTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const rows = (d.payroll_by_employee as Record<string, unknown>[] | null) ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Gross"       value={fmtR(d.total_gross        as number)} />
        <Kpi title="Total Net"         value={fmtR(d.total_net          as number)} />
        <Kpi title="Total Deductions"  value={fmtR(d.total_deductions   as number)} />
        <Kpi title="Total Hours"       value={`${(d.total_hours as number ?? 0).toFixed(1)}h`} />
        <Kpi title="Payslips"          value={fmtN(d.payslip_count      as number)} />
        <Kpi title="Approved"          value={fmtN(d.approved_count     as number)} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 400 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Employee</th>
                <th className="data-th text-right">Gross</th>
                <th className="data-th text-right">Net</th>
                <th className="data-th text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-sm text-text-primary">{r.employee_name as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.gross as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.net   as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{(r.hours as number ?? 0).toFixed(1)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && data !== null && (
        <p className="text-[13px] text-text-disabled text-center py-4">No payroll records for this period</p>
      )}
    </div>
  )
}

// Workforce — total_employees, leave_days_taken, leave_pending + two trend charts
function WorkforceTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Employees"  value={fmtN(d.total_employees  as number)} />
        <Kpi title="Pending Leave"    value={fmtN(d.leave_pending    as number)} />
        <Kpi title="Leave Days Taken" value={fmtN(d.leave_days_taken as number)} caption="approved this period" />
      </div>
      <ChartBox title="Attendance trend" data={(d.attendance_trend as Record<string, unknown>[] | null) ?? []} dataKey="value" type="line" />
      <ChartBox title="Leave trend"      data={(d.leave_trend      as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" height={120} />
    </div>
  )
}

// Operational — total/completed/open jobs, incidents + completion trend chart
function OperationalTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Jobs"       value={fmtN(d.total_jobs      as number)} caption="created this period" />
        <Kpi title="Completed"        value={fmtN(d.completed_jobs  as number)} />
        <Kpi title="Open / Active"    value={fmtN(d.open_jobs       as number)} />
        <Kpi title="Incidents"        value={fmtN(d.total_incidents as number)} />
      </div>
      <ChartBox title="Job completion trend" data={(d.completion_trend as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" />
    </div>
  )
}

// Incidents — Phase 2 stub
function IncidentsTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const list = (d.recent as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">warning</span>
        <p className="text-[14px] text-text-secondary font-semibold">Incidents analytics coming in Phase 2</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi title="Open"     value={fmtN(d.open     as number)} />
        <Kpi title="Resolved" value={fmtN(d.resolved as number)} />
        <Kpi title="Critical" value={fmtN(d.critical as number)} />
      </div>
      {list.map((inc, i) => (
        <div key={i} className="card p-3">
          <p className="text-[13px] font-medium text-text-primary line-clamp-2">{inc.description as string}</p>
          <p className="text-[11px] text-text-secondary mt-0.5">{inc.severity as string} · {inc.status as string}</p>
        </div>
      ))}
    </div>
  )
}

// Inventory — Phase 2 stub
function InventoryTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const rows = (d.top_items as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">inventory_2</span>
        <p className="text-[14px] text-text-secondary font-semibold">Inventory analytics coming in Phase 2</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Items" value={fmtN(d.total_items as number)} />
        <Kpi title="Low Stock"   value={fmtN(d.low_stock   as number)} />
        <Kpi title="Stock Value" value={fmtR(d.stock_value as number)} />
        <Kpi title="On Jobs"     value={fmtN(d.on_jobs     as number)} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 360 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Item</th>
                <th className="data-th text-right">Qty</th>
                <th className="data-th text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-sm text-text-primary">{r.name  as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtN(r.qty   as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.value as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Contractors — Phase 2 stub
function ContractorsTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const rows = (d.payment_summary as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">badge</span>
        <p className="text-[14px] text-text-secondary font-semibold">Contractor analytics coming in Phase 2</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi title="Active"              value={fmtN(d.active              as number)} />
        <Kpi title="Pending Compliance"  value={fmtN(d.pending_compliance  as number)} />
        <Kpi title="Pending Payments"    value={fmtN(d.pending_payments    as number)} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 360 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Contractor</th>
                <th className="data-th text-right">Agreed</th>
                <th className="data-th text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-sm text-text-primary">{r.name    as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.agreed as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.paid   as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Property — Phase 2 stub
function PropertyTab({ data }: { data: RpcData | null }) {
  const d       = data ?? {}
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">apartment</span>
        <p className="text-[14px] text-text-secondary font-semibold">Property analytics coming in Phase 2</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Kpi title="Total Sites"          value={fmtN(d.total_sites          as number)} />
      <Kpi title="Occupied Units"       value={fmtN(d.occupied_units       as number)} />
      <Kpi title="Vacant"               value={fmtN(d.vacant               as number)} />
      <Kpi title="Expiring Compliance"  value={fmtN(d.expiring_compliance  as number)} />
    </div>
  )
}

// Telemetry — Phase 2 stub
function TelemetryTab({ data }: { data: RpcData | null }) {
  const d       = data ?? {}
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">analytics</span>
        <p className="text-[14px] text-text-secondary font-semibold">Telemetry analytics coming in Phase 2</p>
      </div>
    )
  }
  const pairs: [string, string][] = [
    ['Realtime Status',    d.realtime_status as string     ?? '—'],
    ['Offline Queue',      fmtN(d.offline_queue as number)],
    ['Error Rate',         d.error_rate != null ? `${d.error_rate}%` : '—'],
    ['Active Connections', fmtN(d.active_connections as number)],
  ]
  return (
    <div className="card p-4 space-y-2">
      {pairs.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[1fr_auto] items-center py-1.5 border-b border-divider last:border-0">
          <span className="text-sm text-text-secondary">{k}</span>
          <span className="text-sm font-medium text-text-primary">{v}</span>
        </div>
      ))}
    </div>
  )
}

// ─── CSV export helpers ───────────────────────────────────────────────────────

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Exports tab — fetches payroll data on demand and generates CSV client-side
function ExportsTab({ companyId, preset }: { companyId: string | null; preset: Preset }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function exportPayrollCSV() {
    if (!companyId) return
    setBusy('payroll')
    const supabase = createClient()
    const { start, end } = getPeriod(preset)
    try {
      const { data } = await supabase.rpc('hr_get_payroll_snapshot', {
        p_company_id: companyId, p_from: start, p_to: end,
      })
      const rows = ((data as RpcData | null)?.payroll_by_employee as Record<string, unknown>[] | null) ?? []
      const csv  = [
        'Employee,Gross (R),Net (R),Hours',
        ...rows.map(r => `"${r.employee_name}",${r.gross},${r.net},${(r.hours as number ?? 0).toFixed(2)}`),
      ].join('\n')
      downloadCSV(csv, `payroll_${start}_${end}.csv`)
    } catch {}
    setBusy(null)
  }

  async function exportAttendanceCSV() {
    if (!companyId) return
    setBusy('attendance')
    const supabase = createClient()
    const { start, end } = getPeriod(preset)
    try {
      const { data } = await supabase.rpc('hr_get_workforce_snapshot', {
        p_company_id: companyId, p_from: start, p_to: end,
      })
      const trend = ((data as RpcData | null)?.attendance_trend as Record<string, unknown>[] | null) ?? []
      const csv   = [
        'Date,Present Employees',
        ...trend.map(r => `"${r.label}",${r.value}`),
      ].join('\n')
      downloadCSV(csv, `attendance_${start}_${end}.csv`)
    } catch {}
    setBusy(null)
  }

  const EXPORTS: { label: string; key: string; action: () => void; available: boolean }[] = [
    { label: 'Export Payroll CSV',    key: 'payroll',    action: exportPayrollCSV,    available: true },
    { label: 'Export Attendance CSV', key: 'attendance', action: exportAttendanceCSV, available: true },
    { label: 'Export P&L PDF',        key: 'pl',         action: () => {},             available: false },
    { label: 'Export Inventory CSV',  key: 'inventory',  action: () => {},             available: false },
  ]

  return (
    <div className="flex flex-col gap-2">
      {!companyId && (
        <p className="text-[13px] text-text-disabled text-center py-4">Loading…</p>
      )}
      {companyId && EXPORTS.map(e => (
        <button
          key={e.key}
          onClick={e.action}
          disabled={!e.available || busy === e.key}
          className="btn-outlined h-11 w-full text-[13px] flex items-center gap-2 justify-center disabled:opacity-50"
        >
          <span className="material-icons text-[16px]">
            {busy === e.key ? 'hourglass_empty' : 'download'}
          </span>
          {busy === e.key ? 'Generating…' : e.label}
          {!e.available && <span className="text-[11px] text-text-disabled ml-1">(Phase 2)</span>}
        </button>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [preset,    setPreset]    = useState<Preset>('30d')
  const [activeTab, setActiveTab] = useState<TabKey>('executive')
  const [companyId, setCompanyId] = useState<string | null>(null)

  // Resolve company ID once on mount
  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const member   = await resolveCurrentMember(supabase)
      if (member) setCompanyId(member.companyId)
    }
    resolve()
  }, [])

  const { data, loading, refresh } = useTabData(preset, activeTab, companyId)

  const TAB_CONTENT: Record<TabKey, React.ReactNode> = {
    executive:   <ExecTab        data={data} />,
    financial:   <FinancialTab   data={data} />,
    payroll:     <PayrollTab     data={data} />,
    workforce:   <WorkforceTab   data={data} />,
    operational: <OperationalTab data={data} />,
    incidents:   <IncidentsTab   data={data} />,
    inventory:   <InventoryTab   data={data} />,
    contractors: <ContractorsTab data={data} />,
    property:    <PropertyTab    data={data} />,
    telemetry:   <TelemetryTab   data={data} />,
    exports:     <ExportsTab     companyId={companyId} preset={preset} />,
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Reports</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* Date preset bar */}
        <div className="flex flex-col gap-2 mb-3">
          <p className="text-xs text-text-secondary">{presetLabel(preset)}</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['7d', '30d', 'month', 'year'] as Preset[]).map(p => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className="h-[32px] px-2.5 text-[11px] rounded-lg border border-divider whitespace-nowrap shrink-0 font-medium transition-colors"
                style={preset === p
                  ? { backgroundColor: '#1E3A5F', color: '#fff', borderColor: '#1E3A5F' }
                  : { backgroundColor: 'var(--color-surface-card)', color: 'var(--color-text-secondary)' }
                }
              >
                {p === '7d' ? '7d' : p === '30d' ? '30d' : p === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
            <button
              onClick={refresh}
              className="h-[32px] px-2.5 text-[11px] rounded-lg border border-divider whitespace-nowrap shrink-0 font-medium bg-surface-card text-text-secondary hover:opacity-80"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="bg-surface-card border border-divider rounded-xl p-1 mb-4 overflow-x-auto">
          <div className="flex gap-0.5">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="text-sm px-3 py-1 rounded-lg whitespace-nowrap transition-colors shrink-0"
                style={activeTab === t.key
                  ? { backgroundColor: '#3B82F6', color: '#fff' }
                  : { backgroundColor: 'transparent', color: '#6B7280' }
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : (
          TAB_CONTENT[activeTab]
        )}
      </div>
    </div>
  )
}
