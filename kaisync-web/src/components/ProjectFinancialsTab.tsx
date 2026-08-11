'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { ProjectFinancialSummary, ProjectCostEntry, CostType, CostCategory } from '@/types/commercial'

interface Props {
  projectId: string
  companyId: string
}

const TYPE_LABELS: Record<CostType, string> = {
  estimated: 'Estimated',
  committed: 'Committed',
  actual: 'Actual',
}

const CATEGORY_LABELS: Record<CostCategory, string> = {
  labour: 'Labour',
  materials: 'Materials',
  subcontract: 'Subcontract',
  equipment: 'Equipment',
  overhead: 'Overhead',
  other: 'Other',
}

const fmtDate = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
    : '—'

function SummaryRow({ label, value, dimmed, positive }: { label: string; value: string; dimmed?: boolean; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-divider last:border-0">
      <span className={`text-[12px] ${dimmed ? 'text-text-secondary' : 'text-text-primary'}`}>{label}</span>
      <span className={`text-[13px] font-medium ${positive === true ? 'text-success' : positive === false ? 'text-error' : dimmed ? 'text-text-secondary' : 'text-text-primary'}`}>
        {value}
      </span>
    </div>
  )
}

function MarginBadge({ pct }: { pct: number }) {
  let bg = '#DCFCE7'; let fg = '#166534'
  if (pct < 0)        { bg = '#FEE2E2'; fg = '#991B1B' }
  else if (pct < 10)  { bg = '#FEF3C7'; fg = '#92400E' }
  else if (pct < 20)  { bg = '#FEF9C3'; fg = '#854D0E' }
  return (
    <span
      className="inline-block rounded-lg px-2 py-[2px] text-[12px] font-semibold"
      style={{ backgroundColor: bg, color: fg }}
    >
      {pct.toFixed(1)}%
    </span>
  )
}

export function ProjectFinancialsTab({ projectId, companyId }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null)
  const [costEntries, setCostEntries] = useState<ProjectCostEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddCost, setShowAddCost] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // New cost entry form
  const [newDesc, setNewDesc] = useState('')
  const [newCostType, setNewCostType] = useState<CostType>('actual')
  const [newCategory, setNewCategory] = useState<CostCategory>('materials')
  const [newQty, setNewQty] = useState('1')
  const [newUnitCost, setNewUnitCost] = useState('')
  const [newCostDate, setNewCostDate] = useState(new Date().toISOString().slice(0, 10))
  const [newNotes, setNewNotes] = useState('')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: permData } = await supabase.rpc('user_has_permission', {
      p_company_id: companyId,
      p_key: 'projects.financials',
    })
    const permitted = Boolean(permData)
    setHasPermission(permitted)
    if (!permitted) { setLoading(false); return }

    const [{ data: sumData, error: sumErr }, { data: ceData, error: ceErr }] = await Promise.all([
      supabase
        .from('project_financial_summary')
        .select('*')
        .eq('deal_id', projectId)
        .maybeSingle(),
      supabase
        .from('project_cost_entries')
        .select('*')
        .eq('deal_id', projectId)
        .order('cost_date', { ascending: false }),
    ])

    const errMsg = sumErr?.message ?? ceErr?.message ?? null
    if (errMsg) setError(errMsg)
    setSummary(sumData as ProjectFinancialSummary | null)
    setCostEntries((ceData ?? []) as ProjectCostEntry[])
    setLoading(false)
  }, [projectId, companyId])

  useEffect(() => { void load() }, [load])

  async function addCostEntry() {
    if (!newDesc.trim()) return
    setSaving(true)
    setError(null)
    const qty = parseFloat(newQty) || 1
    const unitCost = parseFloat(newUnitCost) || 0
    const supabase = createClient()
    const { error: err } = await supabase.from('project_cost_entries').insert({
      company_id: companyId,
      deal_id: projectId,
      cost_type: newCostType,
      category: newCategory,
      source: 'manual',
      description: newDesc.trim(),
      quantity: qty,
      unit_cost: unitCost,
      total_cost: qty * unitCost,
      cost_date: newCostDate,
      notes: newNotes.trim() || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    setShowAddCost(false)
    setNewDesc(''); setNewQty('1'); setNewUnitCost(''); setNewNotes('')
    showToast('Cost entry added.')
    void load()
    setSaving(false)
  }

  if (loading) {
    return <p className="text-[13px] text-text-secondary py-4">Loading financials…</p>
  }

  if (hasPermission === false) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <span className="material-icons text-[40px] text-text-secondary">lock</span>
        <p className="text-[14px] font-medium text-text-primary">Financials restricted</p>
        <p className="text-[13px] text-text-secondary">
          You need the <code className="bg-surface-elevated px-1 rounded text-[12px]">projects.financials</code> permission to view cost and margin data.
        </p>
      </div>
    )
  }

  if (!summary) {
    return <p className="text-[13px] text-text-secondary py-4">No financial data yet for this project.</p>
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-[12px] text-error">{error}</p>}

      {/* Revenue */}
      <div className="space-y-1">
        <p className="section-label">REVENUE</p>
        <div className="card p-3">
          <SummaryRow label="Contract value" value={fmtMoney(summary.contract_value)} />
          <SummaryRow label="Total invoiced" value={fmtMoney(summary.total_invoiced)} />
          <SummaryRow label="Total received" value={fmtMoney(summary.total_received)} />
          <SummaryRow label="Outstanding balance" value={fmtMoney(summary.outstanding_balance)} dimmed />
          <SummaryRow label="Invoices raised" value={String(summary.invoice_count)} dimmed />
        </div>
      </div>

      {/* Costs */}
      <div className="space-y-1">
        <p className="section-label">COSTS</p>
        <div className="card p-3">
          <SummaryRow label="Estimated cost" value={fmtMoney(summary.estimated_cost)} dimmed />
          <SummaryRow label="Committed (POs approved/sent)" value={fmtMoney(summary.total_po_value)} />
          <SummaryRow label="Supplier invoiced (actual)" value={fmtMoney(summary.total_supplier_invoiced)} />
          <SummaryRow label="Best actual cost" value={fmtMoney(summary.best_actual_cost)} />
        </div>
      </div>

      {/* Profitability */}
      <div className="space-y-1">
        <p className="section-label">PROFITABILITY</p>
        <div className="card p-3">
          <div className="flex items-center justify-between py-2 border-b border-divider">
            <span className="text-[12px] text-text-primary">Gross profit</span>
            <span className={`text-[14px] font-semibold ${summary.gross_profit >= 0 ? 'text-success' : 'text-error'}`}>
              {fmtMoney(summary.gross_profit)}
            </span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-divider">
            <span className="text-[12px] text-text-primary">Gross margin</span>
            <MarginBadge pct={Number(summary.gross_margin_percent)} />
          </div>
          <SummaryRow label="Estimated budget variance" value={fmtMoney(summary.estimated_budget_variance)} dimmed />
          <SummaryRow label="Actual budget variance" value={fmtMoney(summary.actual_budget_variance)} dimmed />
        </div>
      </div>

      {/* Retention */}
      {Number(summary.retention_percent) > 0 && (
        <div className="space-y-1">
          <p className="section-label">RETENTION</p>
          <div className="card p-3">
            <SummaryRow label="Retention rate" value={`${summary.retention_percent}%`} />
            <SummaryRow label="Retention held" value={fmtMoney(summary.retention_amount_held)} />
            <SummaryRow
              label="Released at"
              value={fmtDate(summary.retention_released_at)}
              dimmed
              positive={!!summary.retention_released_at}
            />
          </div>
        </div>
      )}

      {/* Milestones summary */}
      {Number(summary.total_milestones) > 0 && (
        <div className="space-y-1">
          <p className="section-label">MILESTONES</p>
          <div className="card p-3">
            <SummaryRow label="Total milestones" value={String(summary.total_milestones)} />
            <SummaryRow label="Completed" value={String(summary.completed_milestones)} />
            <SummaryRow label="Invoiced" value={String(summary.invoiced_milestones)} dimmed />
          </div>
        </div>
      )}

      {/* Cost entries */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="section-label">COST ENTRIES</p>
          <button onClick={() => setShowAddCost(v => !v)} className="btn-primary h-9 px-3 text-[12px]">
            + Add cost
          </button>
        </div>

        {showAddCost && (
          <div className="card p-4 space-y-3">
            <p className="text-[12px] font-semibold text-text-primary">New cost entry</p>
            <input
              placeholder="Description *"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              className="dark-entry text-[13px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Cost type</label>
                <select value={newCostType} onChange={e => setNewCostType(e.target.value as CostType)}
                  className="dark-entry text-[13px] appearance-none">
                  {(Object.keys(TYPE_LABELS) as CostType[]).map(t => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Category</label>
                <select value={newCategory} onChange={e => setNewCategory(e.target.value as CostCategory)}
                  className="dark-entry text-[13px] appearance-none">
                  {(Object.keys(CATEGORY_LABELS) as CostCategory[]).map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Qty</label>
                <input placeholder="1" value={newQty} onChange={e => setNewQty(e.target.value)}
                  inputMode="decimal" className="dark-entry text-[13px]" />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Unit cost (R)</label>
                <input placeholder="0.00" value={newUnitCost} onChange={e => setNewUnitCost(e.target.value)}
                  inputMode="decimal" className="dark-entry text-[13px]" />
              </div>
              <div>
                <label className="text-[11px] text-text-secondary block mb-1">Date</label>
                <input type="date" value={newCostDate} onChange={e => setNewCostDate(e.target.value)}
                  className="dark-entry text-[13px]" />
              </div>
            </div>
            <input
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              className="dark-entry text-[13px]"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddCost(false)} className="btn-secondary h-9 px-3 text-[12px]">Cancel</button>
              <button
                onClick={() => void addCostEntry()}
                disabled={saving || !newDesc.trim()}
                className="btn-primary h-9 px-4 text-[12px] disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add cost'}
              </button>
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th">Description</th>
                <th style={{ width: 80 }} className="data-th">Type</th>
                <th style={{ width: 96 }} className="data-th">Category</th>
                <th style={{ width: 96 }} className="data-th text-right">Total</th>
                <th style={{ width: 88 }} className="data-th text-center">Date</th>
              </tr>
            </thead>
            <tbody>
              {costEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="data-td text-center text-text-secondary py-6 text-[13px]">
                    No cost entries yet.
                  </td>
                </tr>
              ) : (
                costEntries.map(ce => (
                  <tr key={ce.id} className="border-b border-divider last:border-0">
                    <td className="data-td text-[13px] text-text-primary">
                      {ce.description}
                      {ce.source_reference && (
                        <span className="block text-[11px] text-text-secondary">{ce.source_reference}</span>
                      )}
                    </td>
                    <td className="data-td text-[12px] text-text-secondary">{TYPE_LABELS[ce.cost_type]}</td>
                    <td className="data-td text-[12px] text-text-secondary">{CATEGORY_LABELS[ce.category]}</td>
                    <td className="data-td text-[13px] text-right font-medium">{fmtMoney(ce.total_cost)}</td>
                    <td className="data-td text-[11px] text-text-secondary text-center">{fmtDate(ce.cost_date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  )
}
