'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'

type Preset = '7d' | '30d' | 'month' | 'year'
type TabKey = 'executive' | 'financial' | 'payroll' | 'workforce' | 'operational' |
  'incidents' | 'inventory' | 'contractors' | 'property' | 'telemetry' | 'exports'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'executive', label: 'Executive' },
  { key: 'financial', label: 'Financial' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'workforce', label: 'Workforce' },
  { key: 'operational', label: 'Operational' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'contractors', label: 'Contractors' },
  { key: 'property', label: 'Property' },
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'exports', label: 'Exports' },
]

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
  // year = SA tax year, starts March 1
  const y = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1
  return { start: `${y}-03-01`, end }
}

function presetLabel(p: Preset) {
  const { start, end } = getPeriod(p)
  return `${start} → ${end}`
}

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

function useTabData(preset: Preset, activeTab: TabKey) {
  const [data, setData] = useState<RpcData | null>(null)
  const [loading, setLoading] = useState(false)

  const RPC_MAP: Partial<Record<TabKey, string>> = {
    executive: 'get_executive_report',
    financial: 'get_financial_report',
    payroll: 'get_payroll_report',
    workforce: 'get_workforce_report',
    operational: 'get_operational_report',
    incidents: 'get_incidents_report',
    inventory: 'get_inventory_report',
    contractors: 'get_contractors_report',
    property: 'get_property_report',
    telemetry: 'get_telemetry_report',
  }

  const fetch = useCallback(async () => {
    const rpc = RPC_MAP[activeTab]
    if (!rpc || activeTab === 'exports') return
    setLoading(true)
    const { start, end } = getPeriod(preset)
    const supabase = createClient()
    try {
      const { data: d } = await supabase.rpc(rpc, { period_start: start, period_end: end })
      setData(d as RpcData ?? null)
    } catch {
      setData(null)
    }
    setLoading(false)
  }, [preset, activeTab])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, refresh: fetch }
}

function ExecTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const chartRevenue = (d.revenue_trend as Record<string, unknown>[] | null) ?? []
  const chartAttend = (d.attendance_trend as Record<string, unknown>[] | null) ?? []

  return (
    <div className="space-y-4">
      <div>
        <p className="section-label mb-2">FINANCIAL</p>
        <div className="grid grid-cols-2 gap-2.5">
          <Kpi title="Revenue" value={fmtR(d.revenue as number)} />
          <Kpi title="Outstanding" value={fmtR(d.outstanding as number)} />
          <Kpi title="Accounts Receivable" value={fmtR(d.accounts_receivable as number)} />
          <Kpi title="Accounts Payable" value={fmtR(d.accounts_payable as number)} />
          <Kpi title="Payroll" value={fmtR(d.payroll_total as number)} />
          <Kpi title="VAT Due" value={fmtR(d.vat_due as number)} />
          <Kpi title="Cashflow" value={fmtR(d.cashflow as number)} />
          <Kpi title="Profit Est." value={fmtR(d.profit_estimate as number)} />
        </div>
      </div>
      <div>
        <p className="section-label mb-2">WORKFORCE</p>
        <div className="grid grid-cols-3 gap-2">
          <Kpi title="Present" value={fmtN(d.present as number)} />
          <Kpi title="Late" value={fmtN(d.late as number)} />
          <Kpi title="On Leave" value={fmtN(d.on_leave as number)} />
          <Kpi title="Incidents" value={fmtN(d.incidents as number)} />
          <Kpi title="Active Jobs" value={fmtN(d.active_jobs as number)} />
          <Kpi title="Overtime" value={fmtN(d.overtime_hours as number)} caption="hours" />
        </div>
      </div>
      <div>
        <p className="section-label mb-2">OPERATIONS &amp; SYSTEM</p>
        <div className="grid grid-cols-3 gap-2">
          <Kpi title="Completion %" value={d.completion_percent != null ? `${d.completion_percent}%` : '—'} />
          <Kpi title="Projects" value={fmtN(d.project_count as number)} />
          <Kpi title="Inventory" value={fmtN(d.inventory_items as number)} />
          <Kpi title="Realtime" value={d.realtime_status as string ?? '—'} />
          <Kpi title="Offline Queue" value={fmtN(d.offline_queue as number)} />
          <Kpi title="Errors" value={fmtN(d.error_count as number)} />
        </div>
      </div>
      <ChartBox title="Revenue trend" data={chartRevenue} dataKey="value" type="bar" />
      <ChartBox title="Attendance trend" data={chartAttend} dataKey="value" type="line" />
    </div>
  )
}

function FinancialTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Revenue" value={fmtR(d.revenue as number)} />
        <Kpi title="Outstanding" value={fmtR(d.outstanding as number)} />
        <Kpi title="Payables" value={fmtR(d.payables as number)} />
        <Kpi title="Profit" value={fmtR(d.profit as number)} />
      </div>
      <ChartBox title="Revenue vs Expenses" data={(d.revenue_vs_expenses as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" height={160} />
    </div>
  )
}

function PayrollTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const rows = (d.periods as Record<string, unknown>[] | null) ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Gross" value={fmtR(d.total_gross as number)} />
        <Kpi title="Total Net" value={fmtR(d.total_net as number)} />
        <Kpi title="PAYE" value={fmtR(d.paye as number)} />
        <Kpi title="UIF" value={fmtR(d.uif as number)} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 400 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Period</th>
                <th className="data-th text-right">Gross</th>
                <th className="data-th text-right">Net</th>
                <th className="data-th text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-sm text-text-primary">{r.period as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.gross as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.net as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{r.status as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WorkforceTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Headcount" value={fmtN(d.headcount as number)} />
        <Kpi title="Present Today" value={fmtN(d.present_today as number)} />
        <Kpi title="On Leave" value={fmtN(d.on_leave as number)} />
        <Kpi title="Late This Period" value={fmtN(d.late as number)} />
      </div>
      <ChartBox title="Attendance trend" data={(d.attendance_trend as Record<string, unknown>[] | null) ?? []} dataKey="value" type="line" />
      <ChartBox title="Leave trend" data={(d.leave_trend as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" height={120} />
    </div>
  )
}

function OperationalTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Active Jobs" value={fmtN(d.active_jobs as number)} />
        <Kpi title="Completed" value={fmtN(d.completed as number)} />
        <Kpi title="On-time %" value={d.on_time_percent != null ? `${d.on_time_percent}%` : '—'} />
        <Kpi title="Overdue" value={fmtN(d.overdue as number)} />
      </div>
      <ChartBox title="Job completion trend" data={(d.completion_trend as Record<string, unknown>[] | null) ?? []} dataKey="value" type="bar" />
    </div>
  )
}

function IncidentsTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const list = (d.recent as Record<string, unknown>[] | null) ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi title="Open" value={fmtN(d.open as number)} />
        <Kpi title="Resolved" value={fmtN(d.resolved as number)} />
        <Kpi title="Critical" value={fmtN(d.critical as number)} />
      </div>
      {list.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {list.map((inc, i) => (
            <div key={i} className="card p-3">
              <p className="text-[13px] font-medium text-text-primary line-clamp-2">{inc.description as string}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">{inc.severity as string} · {inc.status as string}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function InventoryTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const rows = (d.top_items as Record<string, unknown>[] | null) ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Kpi title="Total Items" value={fmtN(d.total_items as number)} />
        <Kpi title="Low Stock" value={fmtN(d.low_stock as number)} />
        <Kpi title="Stock Value" value={fmtR(d.stock_value as number)} />
        <Kpi title="Items on Jobs" value={fmtN(d.on_jobs as number)} />
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
                  <td className="data-td text-sm text-text-primary">{r.name as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtN(r.qty as number)}</td>
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

function ContractorsTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const rows = (d.payment_summary as Record<string, unknown>[] | null) ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi title="Active" value={fmtN(d.active as number)} />
        <Kpi title="Pending Compliance" value={fmtN(d.pending_compliance as number)} />
        <Kpi title="Pending Payments" value={fmtN(d.pending_payments as number)} />
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
                  <td className="data-td text-sm text-text-primary">{r.name as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.agreed as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.paid as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PropertyTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Kpi title="Total Sites" value={fmtN(d.total_sites as number)} />
      <Kpi title="Occupied Units" value={fmtN(d.occupied_units as number)} />
      <Kpi title="Vacant" value={fmtN(d.vacant as number)} />
      <Kpi title="Expiring Compliance" value={fmtN(d.expiring_compliance as number)} />
    </div>
  )
}

function TelemetryTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const pairs: [string, string][] = [
    ['Realtime Status', d.realtime_status as string ?? '—'],
    ['Offline Queue', fmtN(d.offline_queue as number)],
    ['Error Rate', d.error_rate != null ? `${d.error_rate}%` : '—'],
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

function ExportsTab() {
  const EXPORTS = [
    { label: 'Export P&L PDF', rpc: 'export_finance_pdf', icon: 'download' },
    { label: 'Export Payroll CSV', rpc: 'export_payroll_csv', icon: 'download' },
    { label: 'Export Attendance CSV', rpc: 'export_attendance_csv', icon: 'download' },
    { label: 'Export Inventory CSV', rpc: 'export_inventory_csv', icon: 'download' },
  ]

  async function trigger(rpc: string) {
    const supabase = createClient()
    try {
      const { data } = await supabase.rpc(rpc, {})
      if ((data as Record<string, unknown>)?.download_url) {
        window.open((data as Record<string, unknown>).download_url as string, '_blank')
      }
    } catch {}
  }

  return (
    <div className="flex flex-col gap-2">
      {EXPORTS.map(e => (
        <button key={e.rpc} onClick={() => trigger(e.rpc)}
          className="btn-outlined h-11 w-full text-[13px] flex items-center gap-2 justify-center">
          <span className="material-icons text-[16px]">{e.icon}</span>
          {e.label}
        </button>
      ))}
    </div>
  )
}

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [activeTab, setActiveTab] = useState<TabKey>('executive')
  const { data, loading, refresh } = useTabData(preset, activeTab)

  const TAB_CONTENT: Record<TabKey, React.ReactNode> = {
    executive: <ExecTab data={data} />,
    financial: <FinancialTab data={data} />,
    payroll: <PayrollTab data={data} />,
    workforce: <WorkforceTab data={data} />,
    operational: <OperationalTab data={data} />,
    incidents: <IncidentsTab data={data} />,
    inventory: <InventoryTab data={data} />,
    contractors: <ContractorsTab data={data} />,
    property: <PropertyTab data={data} />,
    telemetry: <TelemetryTab data={data} />,
    exports: <ExportsTab />,
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Reports</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">

        {/* Filter preset bar */}
        <div className="flex flex-col gap-2 mb-3">
          <p className="text-xs text-text-secondary">{presetLabel(preset)}</p>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {(['7d', '30d', 'month', 'year'] as Preset[]).map(p => (
              <button key={p} onClick={() => setPreset(p)}
                className="h-[32px] px-2.5 text-[11px] rounded-lg border border-divider whitespace-nowrap shrink-0 font-medium transition-colors"
                style={preset === p
                  ? { backgroundColor: '#1E3A5F', color: '#fff', borderColor: '#1E3A5F' }
                  : { backgroundColor: 'var(--color-surface-card)', color: 'var(--color-text-secondary)' }
                }>
                {p === '7d' ? '7d' : p === '30d' ? '30d' : p === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
            <button onClick={refresh}
              className="h-[32px] px-2.5 text-[11px] rounded-lg border border-divider whitespace-nowrap shrink-0 font-medium bg-surface-card text-text-secondary hover:opacity-80">
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Category tab bar */}
        <div className="bg-surface-card border border-divider rounded-xl p-1 mb-4 overflow-x-auto">
          <div className="flex gap-0.5">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className="text-sm px-3 py-1 rounded-lg whitespace-nowrap transition-colors shrink-0"
                style={activeTab === t.key
                  ? { backgroundColor: '#3B82F6', color: '#fff' }
                  : { backgroundColor: 'transparent', color: '#6B7280' }
                }>
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
