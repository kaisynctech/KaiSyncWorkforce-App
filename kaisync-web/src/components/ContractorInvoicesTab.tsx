'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { calculateVatExclusive, fmtMoney, roundFinancial } from '@/lib/finance-calc'
import {
  confirmContractorPayoutRisks,
  fetchContractorPayoutRiskFlags,
} from '@/lib/contractor-payout-gate'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { ContractorPayout } from '@/lib/finance-types'

type PayoutRow = ContractorPayout & {
  jobs?: { id: string; title: string; job_code: string | null } | null
}

const PAYOUT_COLORS: Record<string, { bg: string; fg: string }> = {
  pending:   { bg: '#E5E7EB', fg: '#6B7280' },
  approved:  { bg: '#DBEAFE', fg: '#1E40AF' },
  paid:      { bg: '#DCFCE7', fg: '#166534' },
  cancelled: { bg: '#FEE2E2', fg: '#991B1B' },
}

const APPROVAL_COLORS: Record<string, { bg: string; fg: string }> = {
  pending:  { bg: '#FEF3C7', fg: '#92400E' },
  approved: { bg: '#DCFCE7', fg: '#166534' },
  rejected: { bg: '#FEE2E2', fg: '#991B1B' },
}

function netPayable(p: PayoutRow) {
  return roundFinancial(Number(p.total_amount ?? 0) - Number(p.retention_amount ?? 0))
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

export function ContractorInvoicesTab({
  companyId,
  contractorId,
}: {
  companyId: string
  contractorId: string
}) {
  const [rows, setRows] = useState<PayoutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [employeeId, setEmployeeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (member) setEmployeeId(member.employeeId)

    const { data, error: qErr } = await supabase
      .from('contractor_payouts')
      .select('*, jobs(id, title, job_code)')
      .eq('company_id', companyId)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })

    if (qErr) setError(qErr.message)
    setRows((data ?? []) as PayoutRow[])
    setLoading(false)
  }, [companyId, contractorId])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const pending = rows.filter(r => r.payout_status === 'pending')
    const approved = rows.filter(r => r.payout_status === 'approved')
    const paid = rows.filter(r => r.payout_status === 'paid')
    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      paidCount: paid.length,
      pendingNet: pending.reduce((s, r) => s + netPayable(r), 0),
      approvedNet: approved.reduce((s, r) => s + netPayable(r), 0),
      paidNet: paid.reduce((s, r) => s + netPayable(r), 0),
    }
  }, [rows])

  async function createPayout() {
    const value = Number(amount)
    if (!(value > 0)) {
      setError('Enter a valid amount (ex VAT).')
      return
    }
    const supabase = createClient()
    const flags = await fetchContractorPayoutRiskFlags(supabase, contractorId)
    if (flags && !confirmContractorPayoutRisks(flags, 'Create payout')) return

    setBusy(true)
    setError(null)
    const calc = calculateVatExclusive(value, 0.15)
    const { error: insErr } = await supabase.from('contractor_payouts').insert({
      company_id: companyId,
      contractor_id: contractorId,
      subtotal: calc.subtotal,
      vat_rate: 0.15,
      vat_amount: calc.vatAmount,
      total_amount: calc.totalAmount,
      retention_amount: 0,
      is_vat_inclusive: false,
      tax_type: 'standard',
      payout_status: 'pending',
      approval_status: 'pending',
      notes: notes.trim() || null,
      created_by: employeeId,
    })
    if (insErr) {
      setError(insErr.message)
      setBusy(false)
      return
    }
    setShowAdd(false)
    setAmount('')
    setNotes('')
    setBusy(false)
    await load()
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="section-label">PAYOUTS / INVOICES</p>
          <p className="text-[12px] text-text-secondary mt-0.5">
            Contractor payouts for this partner. Full payment runs live in Finance.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/finance/contractor-payouts"
            className="btn-outlined h-9 px-3 text-[12px] inline-flex items-center"
          >
            Open Finance
          </Link>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="btn-primary h-9 px-3 text-[12px]"
          >
            + Payout
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Pending ({totals.pendingCount})</p>
          <p className="text-[16px] font-bold text-text-primary">{fmtMoney(totals.pendingNet)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Approved ({totals.approvedCount})</p>
          <p className="text-[16px] font-bold text-primary">{fmtMoney(totals.approvedNet)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Paid ({totals.paidCount})</p>
          <p className="text-[16px] font-bold text-success">{fmtMoney(totals.paidNet)}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
      ) : (
        <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Created</th>
                <th className="data-th text-left">Job</th>
                <th className="data-th text-left">Payout</th>
                <th className="data-th text-left">Approval</th>
                <th className="data-th text-right">Net</th>
                <th className="data-th text-left">Paid</th>
                <th className="data-th text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-10">
                    No payouts yet for this contractor.
                  </td>
                </tr>
              ) : (
                rows.map(r => {
                  const pc = PAYOUT_COLORS[r.payout_status] ?? PAYOUT_COLORS.pending
                  const ac = APPROVAL_COLORS[r.approval_status] ?? APPROVAL_COLORS.pending
                  return (
                    <tr key={r.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[12px] text-text-secondary">{fmtDate(r.created_at)}</td>
                      <td className="data-td text-[13px] text-text-primary truncate max-w-[180px]">
                        {r.jobs?.title
                          ? `${r.jobs.job_code ? `${r.jobs.job_code} · ` : ''}${r.jobs.title}`
                          : '—'}
                      </td>
                      <td className="data-td">
                        <StatusBadge label={r.payout_status} bg={pc.bg} fg={pc.fg} />
                      </td>
                      <td className="data-td">
                        <StatusBadge label={r.approval_status} bg={ac.bg} fg={ac.fg} />
                      </td>
                      <td className="data-td text-[13px] text-right font-medium text-text-primary">
                        {fmtMoney(netPayable(r))}
                      </td>
                      <td className="data-td text-[12px] text-text-secondary">
                        {fmtDate(r.paid_at ?? r.payout_date)}
                      </td>
                      <td className="data-td text-[12px] text-text-secondary truncate max-w-[160px]">
                        {r.notes ?? '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl border border-divider w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary text-[15px]">New payout</h3>
            <p className="text-[12px] text-text-secondary">
              Creates a pending payout for this contractor (amount ex VAT + 15% VAT).
            </p>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount ex VAT"
              className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background text-text-primary"
              autoFocus
            />
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background text-text-primary resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setError(null) }}
                className="btn-outlined h-9 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createPayout()}
                disabled={busy || !(Number(amount) > 0)}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {busy ? '…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
