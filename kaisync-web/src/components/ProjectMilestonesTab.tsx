'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { ProjectMilestone, MilestoneStatus } from '@/types/commercial'

interface Props {
  projectId: string
  companyId: string
  canEdit: boolean
}

const STATUS_BADGE: Record<MilestoneStatus, { bg: string; fg: string; label: string }> = {
  pending:     { bg: '#EFF6FF', fg: '#1D4ED8', label: 'Pending' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E', label: 'In progress' },
  completed:   { bg: '#DCFCE7', fg: '#166534', label: 'Completed' },
  cancelled:   { bg: '#F3F4F6', fg: '#6B7280', label: 'Cancelled' },
}

const fmtDate = (d: string | null) =>
  d
    ? new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
    : '—'

export function ProjectMilestonesTab({ projectId, companyId, canEdit }: Props) {
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [confirmComplete, setConfirmComplete] = useState<ProjectMilestone | null>(null)
  const [createInvoice, setCreateInvoice] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  // New milestone form state
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newStatus, setNewStatus] = useState<MilestoneStatus>('pending')
  const [newAmount, setNewAmount] = useState('')
  const [newPct, setNewPct] = useState('')
  const [newTriggers, setNewTriggers] = useState(false)
  const [newRetention, setNewRetention] = useState(false)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('project_milestones')
      .select('*')
      .eq('deal_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) setError(err.message)
    else setMilestones((data ?? []) as ProjectMilestone[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { void load() }, [load])

  async function addMilestone() {
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.from('project_milestones').insert({
      company_id: companyId,
      deal_id: projectId,
      name: newName.trim(),
      description: newDesc.trim() || null,
      due_date: newDue || null,
      invoice_amount: parseFloat(newAmount) || 0,
      invoice_percentage: parseFloat(newPct) || 0,
      triggers_invoice: newTriggers,
      is_retention_release: newRetention,
      status: newStatus,
      sort_order: milestones.length,
    })
    if (err) { setError(err.message); setSaving(false); return }
    // Reset form
    setShowAdd(false)
    setNewName(''); setNewDesc(''); setNewDue(''); setNewAmount(''); setNewPct('')
    setNewTriggers(false); setNewRetention(false); setNewStatus('pending')
    showToast('Milestone added.')
    void load()
    setSaving(false)
  }

  async function completeMilestone(ms: ProjectMilestone) {
    setCompleting(ms.id)
    setError(null)
    const supabase = createClient()

    const { data, error: err } = await (
      supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>
      ) => Promise<{
        data: { milestone_id: string; invoice_id: string | null; invoice_amount: number } | null
        error: { message: string } | null
      }>
    )('complete_milestone', {
      p_milestone_id: ms.id,
      p_create_invoice: createInvoice,
      p_invoice_due_days: 30,
    })

    if (err) { setError(err.message); setCompleting(null); setConfirmComplete(null); return }

    setConfirmComplete(null)
    if (data?.invoice_id) {
      showToast(`Milestone completed — invoice created (${fmtMoney(data.invoice_amount)})`)
    } else {
      showToast('Milestone completed.')
    }
    void load()
    setCompleting(null)
  }

  if (loading) {
    return <p className="text-[13px] text-text-secondary py-4">Loading milestones…</p>
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="section-label">PROJECT MILESTONES</p>
        {canEdit && (
          <button onClick={() => setShowAdd(v => !v)} className="btn-primary h-9 px-3 text-[12px]">
            + Add milestone
          </button>
        )}
      </div>

      {error && <p className="text-[12px] text-error">{error}</p>}

      {/* Add form */}
      {showAdd && (
        <div className="card p-4 space-y-3">
          <p className="text-[12px] font-semibold text-text-primary">New milestone</p>
          <input
            placeholder="Milestone name *"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="dark-entry text-[13px]"
          />
          <input
            placeholder="Description (optional)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
            className="dark-entry text-[13px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Due date</label>
              <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
                className="dark-entry text-[13px]" />
            </div>
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Status</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value as MilestoneStatus)}
                className="dark-entry text-[13px] appearance-none">
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Invoice amount (R)</label>
              <input placeholder="0.00" value={newAmount} onChange={e => setNewAmount(e.target.value)}
                inputMode="decimal" className="dark-entry text-[13px]" />
            </div>
            <div>
              <label className="text-[11px] text-text-secondary block mb-1">Invoice % of contract</label>
              <input placeholder="0" value={newPct} onChange={e => setNewPct(e.target.value)}
                inputMode="decimal" className="dark-entry text-[13px]" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
              <input type="checkbox" checked={newTriggers} onChange={e => setNewTriggers(e.target.checked)}
                className="rounded" />
              Triggers invoice on completion
            </label>
            <label className="flex items-center gap-2 text-[12px] text-text-secondary cursor-pointer">
              <input type="checkbox" checked={newRetention} onChange={e => setNewRetention(e.target.checked)}
                className="rounded" />
              Retention release
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="btn-secondary h-9 px-3 text-[12px]">Cancel</button>
            <button
              onClick={() => void addMilestone()}
              disabled={saving || !newName.trim()}
              className="btn-primary h-9 px-4 text-[12px] disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add milestone'}
            </button>
          </div>
        </div>
      )}

      {/* Milestones table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-elevated border-b border-divider">
              <th className="data-th">Milestone</th>
              <th style={{ width: 96 }} className="data-th text-center">Due</th>
              <th style={{ width: 96 }} className="data-th text-right">Invoice</th>
              <th style={{ width: 96 }} className="data-th text-center">Status</th>
              <th style={{ width: 88 }} className="data-th"></th>
            </tr>
          </thead>
          <tbody>
            {milestones.length === 0 ? (
              <tr>
                <td colSpan={5} className="data-td text-center text-text-secondary py-8 text-[13px]">
                  No milestones yet.
                </td>
              </tr>
            ) : (
              milestones.map(ms => {
                const badge = STATUS_BADGE[ms.status] ?? STATUS_BADGE.pending
                const isCompleted = ms.status === 'completed'
                const isCancelled = ms.status === 'cancelled'
                return (
                  <tr key={ms.id} className="border-b border-divider last:border-0">
                    <td className="data-td">
                      <p className="text-[13px] text-text-primary font-medium">{ms.name}</p>
                      {ms.description && (
                        <p className="text-[11px] text-text-secondary">{ms.description}</p>
                      )}
                      {ms.is_retention_release && (
                        <span className="text-[10px] text-amber-600 font-medium">Retention release</span>
                      )}
                      {ms.invoice_id && (
                        <p className="text-[10px] text-success">
                          <span className="material-icons text-[11px] align-middle">check_circle</span>
                          {' '}Invoice created
                        </p>
                      )}
                    </td>
                    <td className="data-td text-[12px] text-text-secondary text-center">
                      {fmtDate(ms.due_date)}
                      {ms.completion_date && (
                        <p className="text-[10px] text-success">Done {fmtDate(ms.completion_date)}</p>
                      )}
                    </td>
                    <td className="data-td text-[12px] text-right">
                      {ms.triggers_invoice ? (
                        ms.invoice_percentage > 0
                          ? <span className="text-text-secondary">{ms.invoice_percentage}%</span>
                          : <span className="text-text-primary">{fmtMoney(ms.invoice_amount)}</span>
                      ) : (
                        <span className="text-text-secondary">—</span>
                      )}
                    </td>
                    <td className="data-td text-center">
                      <span
                        className="inline-block rounded-lg px-2 py-[3px] text-[10px] font-medium"
                        style={{ backgroundColor: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="data-td text-right">
                      {canEdit && !isCompleted && !isCancelled && (
                        <button
                          onClick={() => { setConfirmComplete(ms); setCreateInvoice(ms.triggers_invoice) }}
                          className="btn-outlined h-7 px-2 text-[11px]"
                        >
                          Complete
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Confirm completion modal */}
      {confirmComplete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-surface rounded-xl shadow-2xl w-96 p-5 space-y-4">
            <h3 className="text-[15px] font-semibold text-text-primary">Complete milestone?</h3>
            <p className="text-[13px] text-text-secondary">
              Mark <strong>{confirmComplete.name}</strong> as completed
              {confirmComplete.due_date ? ` (due ${fmtDate(confirmComplete.due_date)})` : ''}.
            </p>
            {confirmComplete.triggers_invoice && (
              <label className="flex items-start gap-2 text-[13px] text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={createInvoice}
                  onChange={e => setCreateInvoice(e.target.checked)}
                  className="rounded mt-0.5"
                />
                <span>
                  Create invoice automatically
                  {confirmComplete.invoice_percentage > 0
                    ? ` (${confirmComplete.invoice_percentage}% of contract value)`
                    : ` (${fmtMoney(confirmComplete.invoice_amount)})`
                  }
                </span>
              </label>
            )}
            {confirmComplete.is_retention_release && (
              <div className="flex items-center gap-1.5 text-[12px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                <span className="material-icons text-[14px]">info</span>
                This will also release retention on the project.
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setConfirmComplete(null)} className="btn-secondary flex-1 h-9 text-[13px]">
                Cancel
              </button>
              <button
                onClick={() => void completeMilestone(confirmComplete)}
                disabled={!!completing}
                className="btn-primary flex-1 h-9 text-[13px] disabled:opacity-50"
              >
                {completing ? 'Completing…' : 'Complete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-success text-white px-4 py-2 rounded-lg shadow-lg text-[13px] z-50 pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  )
}
