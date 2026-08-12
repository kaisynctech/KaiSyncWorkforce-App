'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import BusinessDigestModal from '@/components/BusinessDigestModal'
import type {
  CashFlowWeek,
  ClientPaymentIntelligence,
  QuoteWinLossSummary,
  ProjectCostVariance,
  BusinessDigest,
} from '@/types/commercial'

// ─── Types ───────────────────────────────────────────────────────────────────

type SubTab = 'cashflow' | 'clients' | 'quotes' | 'projects'

const SUB_TABS: { key: SubTab; label: string; icon: string }[] = [
  { key: 'cashflow', label: 'Cash Flow',          icon: 'account_balance_wallet' },
  { key: 'clients',  label: 'Client Intelligence', icon: 'person_search' },
  { key: 'quotes',   label: 'Win / Loss',          icon: 'request_quote' },
  { key: 'projects', label: 'Cost Variance',       icon: 'construction' },
]

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtN = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-ZA')

const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(1)}%`

// ─── Shared sub-components ────────────────────────────────────────────────────

function Kpi({ title, value, caption, highlight }: {
  title: string; value: string; caption?: string; highlight?: boolean
}) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-0.5 border"
      style={{
        backgroundColor: highlight ? 'rgba(59,130,246,0.08)' : 'var(--color-surface-card)',
        borderColor: highlight ? 'rgba(59,130,246,0.3)' : 'var(--color-border)',
      }}
    >
      <p className="text-[10px] text-text-secondary uppercase tracking-wide">{title}</p>
      <p className="text-base font-bold text-text-primary leading-tight">{value}</p>
      {caption && <p className="text-[10px] text-text-secondary">{caption}</p>}
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
      <span className="material-icons text-[48px] text-text-disabled">{icon}</span>
      <p className="text-[15px] font-semibold text-text-secondary">{title}</p>
      <p className="text-[13px] text-text-disabled max-w-xs leading-snug">{subtitle}</p>
    </div>
  )
}

function RiskBadge({ risk }: { risk: 'high' | 'medium' | 'low' }) {
  const cfg = {
    high:   { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444',  label: 'High Risk' },
    medium: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b',  label: 'Medium' },
    low:    { bg: 'rgba(34,197,94,0.12)',  text: '#22c55e',  label: 'Low Risk' },
  }[risk]
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
      style={{ backgroundColor: cfg.bg, color: cfg.text }}
    >
      {cfg.label}
    </span>
  )
}

// ─── Cash Flow tab ────────────────────────────────────────────────────────────

function CashFlowTab({ companyId }: { companyId: string }) {
  const [rows, setRows]       = useState<CashFlowWeek[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('cash_flow_forecast')
        .select('*')
        .eq('company_id', companyId)
        .order('week_start')
      setRows((data as CashFlowWeek[] | null) ?? [])
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="text-center text-text-secondary text-[13px] py-10">Loading…</p>

  const allZero = rows.every(r => r.projected_inflow === 0 && r.projected_outflow === 0)
  if (rows.length === 0 || allZero) {
    return (
      <EmptyState
        icon="account_balance_wallet"
        title="No cash flow data yet"
        subtitle="Create invoices, purchase orders, and milestones to see your 12-week cash flow forecast."
      />
    )
  }

  const totalInflow  = rows.reduce((s, r) => s + Number(r.projected_inflow),  0)
  const totalOutflow = rows.reduce((s, r) => s + Number(r.projected_outflow), 0)
  const netCashFlow  = rows.reduce((s, r) => s + Number(r.net_cash_flow),     0)

  const chartData = rows.map(r => ({
    label:    r.week_label,
    Inflow:   Number(r.projected_inflow),
    Outflow:  Number(r.projected_outflow),
    Net:      Number(r.net_cash_flow),
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <Kpi title="12-Week Inflow"  value={fmtMoney(totalInflow)}  caption="projected receipts" />
        <Kpi title="12-Week Outflow" value={fmtMoney(totalOutflow)} caption="projected payments" />
        <Kpi
          title="Net Position"
          value={fmtMoney(netCashFlow)}
          caption={netCashFlow >= 0 ? 'surplus' : 'deficit'}
          highlight={netCashFlow < 0}
        />
      </div>

      <div className="bg-surface-card border border-divider rounded-xl p-4">
        <p className="text-xs font-semibold text-text-secondary mb-3">
          12-Week Cash Flow — Inflow vs Outflow (ZAR)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `R${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => typeof v === 'number' ? fmtMoney(v) : String(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Inflow"  fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Outflow" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Net cash flow line breakdown */}
      <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-surface-elevated">
              <th className="data-th text-left">Week</th>
              <th className="data-th text-right">Inflow</th>
              <th className="data-th text-right">Outflow</th>
              <th className="data-th text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                <td className="data-td text-text-primary">{r.week_label}</td>
                <td className="data-td text-right text-emerald-500">{fmtMoney(r.projected_inflow)}</td>
                <td className="data-td text-right text-red-500">{fmtMoney(r.projected_outflow)}</td>
                <td
                  className="data-td text-right font-medium"
                  style={{ color: Number(r.net_cash_flow) >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {fmtMoney(r.net_cash_flow)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Client Intelligence tab ──────────────────────────────────────────────────

function ClientsTab({ companyId }: { companyId: string }) {
  const [rows, setRows]       = useState<ClientPaymentIntelligence[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('client_payment_intelligence')
        .select('*')
        .eq('company_id', companyId)
        .order('overdue_amount', { ascending: false })
      setRows((data as ClientPaymentIntelligence[] | null) ?? [])
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="text-center text-text-secondary text-[13px] py-10">Loading…</p>

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="person_search"
        title="No client payment data yet"
        subtitle="Issue invoices to clients to start tracking payment behaviour and reliability scores."
      />
    )
  }

  const totalOutstanding = rows.reduce((s, r) => s + Number(r.total_outstanding), 0)
  const totalOverdue     = rows.reduce((s, r) => s + Number(r.overdue_amount),    0)
  const highRisk         = rows.filter(r => r.payment_risk === 'high').length
  const avgReliability   = rows.length > 0
    ? rows.reduce((s, r) => s + (r.reliability_score ?? 0), 0) / rows.length
    : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi title="Total Outstanding" value={fmtMoney(totalOutstanding)} />
        <Kpi title="Overdue Amount"    value={fmtMoney(totalOverdue)} highlight={totalOverdue > 0} />
        <Kpi title="High-Risk Clients" value={fmtN(highRisk)} highlight={highRisk > 0} />
        <Kpi title="Avg Reliability"   value={avgReliability != null ? `${avgReliability.toFixed(0)}/100` : '—'} />
      </div>

      <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ minWidth: 480 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Client</th>
                <th className="data-th text-center">Risk</th>
                <th className="data-th text-right">Reliability</th>
                <th className="data-th text-right">Outstanding</th>
                <th className="data-th text-right">Overdue</th>
                <th className="data-th text-right">On-Time %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-text-primary font-medium">
                    {r.client_name ?? 'Unknown'}
                  </td>
                  <td className="data-td text-center">
                    <RiskBadge risk={r.payment_risk} />
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {r.reliability_score != null ? `${r.reliability_score}/100` : '—'}
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {fmtMoney(r.total_outstanding)}
                  </td>
                  <td
                    className="data-td text-right font-medium"
                    style={{ color: Number(r.overdue_amount) > 0 ? '#ef4444' : 'var(--color-text-secondary)' }}
                  >
                    {fmtMoney(r.overdue_amount)}
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {fmtPct(r.on_time_rate_percent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Win / Loss tab ───────────────────────────────────────────────────────────

function QuotesTab({ companyId }: { companyId: string }) {
  const [wl, setWl]           = useState<QuoteWinLossSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('quote_win_loss_summary')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()
      setWl(data as QuoteWinLossSummary | null)
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="text-center text-text-secondary text-[13px] py-10">Loading…</p>

  if (!wl || wl.total_quotes === 0) {
    return (
      <EmptyState
        icon="request_quote"
        title="No quote data yet"
        subtitle="Create and send quotes to clients to track your win rate and pipeline performance."
      />
    )
  }

  const pieData = [
    { name: 'Won',    value: wl.total_won,       fill: '#22c55e' },
    { name: 'Lost',   value: wl.total_lost,      fill: '#ef4444' },
    { name: 'Open',   value: wl.currently_open,  fill: '#3B82F6' },
  ].filter(d => d.value > 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi title="Win Rate"      value={fmtPct(wl.win_rate_percent)} highlight />
        <Kpi title="Total Won"     value={fmtMoney(wl.total_won_value)} />
        <Kpi title="Pipeline"      value={fmtMoney(wl.pipeline_value)} caption="open quotes" />
        <Kpi title="Avg Won Margin" value={fmtPct(wl.avg_won_margin_percent)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Donut */}
        <div className="bg-surface-card border border-divider rounded-xl p-4">
          <p className="text-xs font-semibold text-text-secondary mb-2">Quote Breakdown</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%" cy="50%"
                innerRadius={50} outerRadius={75}
                dataKey="value"
                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {pieData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => typeof v === 'number' ? fmtN(v) : String(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Stats grid */}
        <div className="flex flex-col gap-2.5">
          <div className="bg-surface-card border border-divider rounded-xl p-3 space-y-1.5">
            {[
              ['Total Quotes',        fmtN(wl.total_quotes)],
              ['Won',                 fmtN(wl.total_won)],
              ['Lost',                fmtN(wl.total_lost)],
              ['Open / In Pipeline',  fmtN(wl.currently_open)],
              ['Avg Quote Value',     fmtMoney(wl.avg_quote_value)],
              ['Avg Won Value',       fmtMoney(wl.avg_won_value)],
              ['Avg Days to Decision',wl.avg_days_to_decision != null ? `${wl.avg_days_to_decision} days` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-0.5 border-b border-divider last:border-0">
                <span className="text-[12px] text-text-secondary">{k}</span>
                <span className="text-[12px] font-medium text-text-primary">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Cost Variance tab ────────────────────────────────────────────────────────

function ProjectsTab({ companyId }: { companyId: string }) {
  const [rows, setRows]       = useState<ProjectCostVariance[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('project_cost_variance')
        .select('*')
        .eq('company_id', companyId)
        .order('cost_overrun_percent', { ascending: false })
      setRows((data as ProjectCostVariance[] | null) ?? [])
      setLoading(false)
    }
    load()
  }, [companyId])

  if (loading) return <p className="text-center text-text-secondary text-[13px] py-10">Loading…</p>

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="construction"
        title="No active projects yet"
        subtitle="Projects marked as 'in progress' or 'won' with cost entries will appear here for variance tracking."
      />
    )
  }

  const highRisk    = rows.filter(r => r.cost_risk === 'high').length
  const mediumRisk  = rows.filter(r => r.cost_risk === 'medium').length
  const totalValue  = rows.reduce((s, r) => s + Number(r.contract_value), 0)
  const avgMargin   = rows.length > 0
    ? rows.reduce((s, r) => s + (r.projected_margin_percent ?? 0), 0) / rows.length
    : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Kpi title="Active Projects"  value={fmtN(rows.length)} />
        <Kpi title="High Risk"        value={fmtN(highRisk)}   highlight={highRisk > 0} />
        <Kpi title="Total Contract"   value={fmtMoney(totalValue)} />
        <Kpi title="Avg Proj. Margin" value={fmtPct(avgMargin)} />
      </div>

      {(highRisk > 0 || mediumRisk > 0) && (
        <div
          className="flex items-start gap-2 rounded-xl px-3 py-2.5 border text-[12px]"
          style={{
            backgroundColor: 'rgba(245,158,11,0.08)',
            borderColor: 'rgba(245,158,11,0.3)',
            color: '#d97706',
          }}
        >
          <span className="material-icons text-[16px] shrink-0 mt-0.5">warning</span>
          <span>
            {highRisk > 0 && `${highRisk} project${highRisk > 1 ? 's' : ''} over 10% budget. `}
            {mediumRisk > 0 && `${mediumRisk} project${mediumRisk > 1 ? 's' : ''} trending 5–10% over budget.`}
          </span>
        </div>
      )}

      <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ minWidth: 520 }}>
            <thead>
              <tr className="bg-surface-elevated">
                <th className="data-th text-left">Project</th>
                <th className="data-th text-center">Risk</th>
                <th className="data-th text-right">Contract</th>
                <th className="data-th text-right">Overrun %</th>
                <th className="data-th text-right">Proj. Margin</th>
                <th className="data-th text-right">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="bg-surface-card border-b border-divider last:border-0">
                  <td className="data-td text-text-primary font-medium line-clamp-1 max-w-[160px]">
                    {r.title}
                  </td>
                  <td className="data-td text-center">
                    <RiskBadge risk={r.cost_risk} />
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {fmtMoney(r.contract_value)}
                  </td>
                  <td
                    className="data-td text-right font-medium"
                    style={{
                      color: (r.cost_overrun_percent ?? 0) > 10
                        ? '#ef4444'
                        : (r.cost_overrun_percent ?? 0) > 0
                        ? '#f59e0b'
                        : '#22c55e',
                    }}
                  >
                    {r.cost_overrun_percent != null
                      ? `${r.cost_overrun_percent > 0 ? '+' : ''}${r.cost_overrun_percent}%`
                      : '—'}
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {fmtPct(r.projected_margin_percent)}
                  </td>
                  <td className="data-td text-right text-text-secondary">
                    {r.progress_percent != null ? `${r.progress_percent}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommercialReportsPage() {
  const [companyId,     setCompanyId]     = useState<string | null>(null)
  const [activeTab,     setActiveTab]     = useState<SubTab>('cashflow')
  const [showDigest,    setShowDigest]    = useState(false)
  const [digest,        setDigest]        = useState<BusinessDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)

  useEffect(() => {
    async function resolve() {
      const supabase = createClient()
      const member   = await resolveCurrentMember(supabase)
      if (member) setCompanyId(member.companyId)
    }
    resolve()
  }, [])

  const generateDigest = useCallback(async () => {
    setDigestLoading(true)
    setDigest(null)
    try {
      const res  = await fetch('/api/ai/business-digest', { method: 'POST' })
      const body = await res.json() as { digest?: BusinessDigest; error?: string }
      if (body.digest) setDigest(body.digest)
    } catch {
      /* errors are shown in modal empty state */
    }
    setDigestLoading(false)
  }, [])

  function handleOpenDigest() {
    setShowDigest(true)
    if (!digest && !digestLoading) generateDigest()
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[20px] font-semibold text-text-primary">Commercial Intelligence</h1>
          <p className="text-[12px] text-text-secondary">Cash flow, clients, quotes &amp; project costs</p>
        </div>
        <button
          onClick={handleOpenDigest}
          className="btn-primary text-[13px] h-9 px-3 flex items-center gap-1.5"
        >
          <span className="material-icons text-[15px]">auto_awesome</span>
          AI Digest
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Sub-tab bar */}
        <div className="bg-surface-card border border-divider rounded-xl p-1 mb-4 overflow-x-auto">
          <div className="flex gap-0.5">
            {SUB_TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors shrink-0"
                style={activeTab === t.key
                  ? { backgroundColor: '#3B82F6', color: '#fff' }
                  : { backgroundColor: 'transparent', color: '#6B7280' }
                }
              >
                <span className="material-icons text-[14px]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {!companyId ? (
          <p className="text-center text-text-secondary text-[13px] py-10">Loading…</p>
        ) : (
          <>
            {activeTab === 'cashflow'  && <CashFlowTab companyId={companyId} />}
            {activeTab === 'clients'   && <ClientsTab  companyId={companyId} />}
            {activeTab === 'quotes'    && <QuotesTab   companyId={companyId} />}
            {activeTab === 'projects'  && <ProjectsTab companyId={companyId} />}
          </>
        )}
      </div>

      {/* Business Digest Modal */}
      {showDigest && (
        <BusinessDigestModal
          digest={digest}
          loading={digestLoading}
          onClose={() => setShowDigest(false)}
          onRegenerate={generateDigest}
        />
      )}
    </div>
  )
}
