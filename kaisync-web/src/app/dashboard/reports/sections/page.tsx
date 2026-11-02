'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  buildPhase2Snapshot,
  fetchIncidentsExportRows,
  fetchInventoryExportRows,
  fetchJobsExportRows,
  isPhase2Tab,
} from '@/lib/reports-snapshots'

type Preset = '7d' | '30d' | 'month' | 'year'
type TabKey = 'incidents' | 'inventory' | 'contractors' | 'clients' | 'property' | 'exports'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'clients',     label: 'Clients' },
  { key: 'contractors', label: 'Contractors' },
  { key: 'incidents',   label: 'Incidents' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'property',    label: 'Property' },
  { key: 'exports',     label: 'Exports' },
]

// RPC names — all use signature (p_company_id uuid, p_from date, p_to date) → jsonb
const RPC_MAP: Partial<Record<TabKey, string>> = {
  incidents:   'hr_get_incidents_snapshot',
  inventory:   'hr_get_inventory_snapshot',
  contractors: 'hr_get_contractors_snapshot',
  clients:     'hr_get_clients_snapshot',
  property:    'hr_get_property_snapshot',
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

type RpcData = Record<string, unknown>

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
      const rpcData = (d as RpcData | null) ?? null
      if (rpcData && Object.keys(rpcData).length > 0) {
        setData(rpcData)
      } else if (isPhase2Tab(activeTab)) {
        // builds these client-side; use until Phase 2 RPCs are deployed
        const built = await buildPhase2Snapshot(supabase, activeTab, companyId, start, end)
        setData(built)
      } else {
        setData(rpcData)
      }
    } catch {
      if (isPhase2Tab(activeTab)) {
        try {
          const built = await buildPhase2Snapshot(supabase, activeTab, companyId, start, end)
          setData(built)
        } catch {
          setData(null)
        }
      } else {
        setData(null)
      }
    }
    setLoading(false)
  }, [preset, activeTab, companyId])

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, refresh: fetch }
}

// ─── Tab components ───────────────────────────────────────────────────────────

// Incidents
function IncidentsTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const list = (d.recent as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">warning</span>
        <p className="text-[14px] text-text-secondary font-semibold">No incidents in this period</p>
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

// Inventory
function InventoryTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const rows = (d.top_items as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">inventory_2</span>
        <p className="text-[14px] text-text-secondary font-semibold">No inventory data</p>
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

// Contractors
function ContractorsTab({ data }: { data: RpcData | null }) {
  const d    = data ?? {}
  const rows = (d.payment_summary as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">badge</span>
        <p className="text-[14px] text-text-secondary font-semibold">No contractor data</p>
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

// Clients
function ClientsTab({ data }: { data: RpcData | null }) {
  const d = data ?? {}
  const rows = (d.top_clients as Record<string, unknown>[] | null) ?? []
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">business</span>
        <p className="text-[14px] text-text-secondary font-semibold">No client data</p>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Kpi title="Total" value={fmtN(d.total as number)} />
        <Kpi title="Portal enabled" value={fmtN(d.portal_enabled as number)} />
        <Kpi title="Active deals" value={fmtN(d.active_deals as number)} />
        <Kpi title="Open jobs" value={fmtN(d.open_jobs as number)} />
        <Kpi title="Outstanding" value={fmtR(d.outstanding_balance as number)} />
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 360 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Client</th>
                <th className="data-th text-right">Balance</th>
                <th className="data-th text-right">Jobs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-sm text-text-primary">{r.name as string}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtR(r.balance as number)}</td>
                  <td className="data-td text-sm text-text-secondary text-right">{fmtN(r.jobs as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Property
function PropertyTab({ data }: { data: RpcData | null }) {
  const d       = data ?? {}
  const hasData = Object.keys(d).length > 0
  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="material-icons text-[40px] text-text-disabled">apartment</span>
        <p className="text-[14px] text-text-secondary font-semibold">No property data</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Kpi title="Total Sites"          value={fmtN(d.total_sites          as number)} />
      <Kpi title="Active Sites"         value={fmtN(d.active_sites         as number)} />
      <Kpi title="Occupied Units"       value={fmtN(d.occupied_units       as number)} />
      <Kpi title="Vacant"               value={fmtN(d.vacant               as number)} />
      <Kpi title="Active Leases"        value={fmtN(d.active_leases        as number)} />
      <Kpi title="Rent Arrears #"       value={fmtN(d.arrears_invoices     as number)} />
      <Kpi title="Rent Arrears Total"   value={fmtR(d.arrears_total        as number)} />
      <Kpi title="Expiring Compliance"  value={fmtN(d.expiring_compliance  as number)} />
    </div>
  )
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function empName(employees: unknown): string {
  const emp = (Array.isArray(employees) ? employees[0] : employees) as
    | { name?: string; surname?: string }
    | null
    | undefined
  if (!emp) return ''
  return `${emp.name ?? ''} ${emp.surname ?? ''}`.trim()
}

// Exports tab — client CSV 
function ExportsTab({ companyId, preset }: { companyId: string | null; preset: Preset }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function exportIncidentsCSV() {
    if (!companyId) return
    setBusy('incidents')
    const supabase = createClient()
    const { start, end } = getPeriod(preset)
    try {
      const rows = await fetchIncidentsExportRows(supabase, companyId, start, end)
      const csv = [
        'Employee,Description,Severity,Status,Created',
        ...rows.map(r => {
          const name = empName(r.employees)
          const status = r.is_closed ? 'closed' : (r.status ?? 'open')
          const desc = String(r.description ?? '').replace(/"/g, '""')
          return `"${name}","${desc}",${r.severity},${status},${r.created_at}`
        }),
      ].join('\n')
      downloadCSV(csv, `incidents_${start}_${end}.csv`)
    } catch {}
    setBusy(null)
  }

  async function exportInventoryCSV() {
    if (!companyId) return
    setBusy('inventory')
    const supabase = createClient()
    try {
      const rows = await fetchInventoryExportRows(supabase, companyId)
      const csv = [
        'Name,SKU,Qty On Hand,Unit Cost,Reorder Level,Supplier',
        ...rows.map(r =>
          `"${r.name ?? ''}","${r.sku ?? ''}",${r.quantity_on_hand ?? 0},${r.unit_cost ?? 0},${r.reorder_level ?? 0},"${r.supplier ?? ''}"`,
        ),
      ].join('\n')
      downloadCSV(csv, `inventory_export.csv`)
    } catch {}
    setBusy(null)
  }

  async function exportJobsCSV() {
    if (!companyId) return
    setBusy('jobs')
    const supabase = createClient()
    const { start, end } = getPeriod(preset)
    try {
      const rows = await fetchJobsExportRows(supabase, companyId, start, end)
      const csv = [
        'Title,Client,Status,Priority,Start,End,Estimated Cost',
        ...rows.map(r => {
          const clientRaw = r.clients as unknown
          const clientObj = (Array.isArray(clientRaw) ? clientRaw[0] : clientRaw) as { name?: string } | null
          const client = clientObj?.name ?? ''
          return `"${r.title}","${client}",${r.status},${r.priority},${r.scheduled_start ?? ''},${r.scheduled_end ?? ''},${r.estimated_cost ?? ''}`
        }),
      ].join('\n')
      downloadCSV(csv, `jobs_${start}_${end}.csv`)
    } catch {}
    setBusy(null)
  }

  const EXPORTS: { label: string; key: string; action: () => void; available: boolean }[] = [
    { label: 'Export Incidents CSV',          key: 'incidents',  action: exportIncidentsCSV,  available: true },
    { label: 'Export Inventory CSV',          key: 'inventory',  action: exportInventoryCSV,  available: true },
    { label: 'Export Jobs CSV',               key: 'jobs',       action: exportJobsCSV,       available: true },
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
          {!e.available && <span className="text-[11px] text-text-disabled ml-1">(deferred)</span>}
        </button>
      ))}
    </div>
  )
}


export default function ReportsPage() {
  const [preset,    setPreset]    = useState<Preset>('30d')
  const [activeTab, setActiveTab] = useState<TabKey>('clients')
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
    incidents:   <IncidentsTab          data={data} />,
    inventory:   <InventoryTab          data={data} />,
    contractors: <ContractorsTab        data={data} />,
    clients:     <ClientsTab            data={data} />,
    property:    <PropertyTab           data={data} />,
    exports:     <ExportsTab            companyId={companyId} preset={preset} />,
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <Link href="/dashboard/reports" className="text-[12px] text-text-secondary hover:underline no-underline">← Insights</Link>
          <h1 className="text-[20px] font-semibold text-text-primary">Other sections</h1>
        </div>
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
