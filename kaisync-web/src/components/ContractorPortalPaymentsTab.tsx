'use client'

import { useMemo, useState } from 'react'
import { resubmitPayout } from '@/lib/contractor-portal/api'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import {
  moneyZAR,
  payoutInvoiceReference,
  payoutIsRejected,
  payoutJobDisplay,
  payoutNetPayable,
  payoutStatusLabel,
  type ContractorPayout,
} from '@/lib/contractor-portal/types'

type Filter = 'All' | 'Pending' | 'Approved' | 'Paid' | 'Rejected'

const FILTERS: Filter[] = ['All', 'Pending', 'Approved', 'Paid', 'Rejected']

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ContractorPortalPaymentsTab({
  session,
  payouts,
  onRefresh,
  onError,
}: {
  session: ContractorPortalSession
  payouts: ContractorPayout[]
  onRefresh: () => Promise<void>
  onError: (msg: string | null) => void
}) {
  const [filter, setFilter] = useState<Filter>('All')
  const [revise, setRevise] = useState<ContractorPayout | null>(null)
  const [amount, setAmount] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    switch (filter) {
      case 'Pending':
        return payouts.filter(p => p.payout_status === 'pending' && !payoutIsRejected(p))
      case 'Approved':
        return payouts.filter(p => p.payout_status === 'approved')
      case 'Paid':
        return payouts.filter(p => p.payout_status === 'paid')
      case 'Rejected':
        return payouts.filter(payoutIsRejected)
      default:
        return payouts
    }
  }, [payouts, filter])

  const outstanding = useMemo(
    () => payouts.filter(p => p.payout_status !== 'paid').reduce((s, p) => s + payoutNetPayable(p), 0),
    [payouts],
  )

  function startRevise(p: ContractorPayout) {
    setRevise(p)
    setAmount(String(p.total_amount || ''))
    const ref = payoutInvoiceReference(p)
    setInvoiceRef(ref === '—' ? '' : ref)
    setNotes('')
    onError(null)
  }

  function cancelRevise() {
    setRevise(null)
    setAmount('')
    setInvoiceRef('')
    setNotes('')
  }

  async function submitRevise() {
    if (!revise) return
    const amt = Number(amount)
    if (!(amt > 0)) {
      onError('Enter a valid amount.')
      return
    }
    setBusy(true)
    onError(null)
    try {
      await resubmitPayout({
        companyCode: session.company_code,
        contractorCode: session.contractor_code,
        payoutId: revise.id,
        amount: amt,
        invoiceReference: invoiceRef.trim() || null,
        notes: notes.trim() || null,
      })
      cancelRevise()
      await onRefresh()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not resubmit invoice.')
    }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-white text-[18px] font-bold">Payments</h2>
          <p className="text-[12px] text-slate-500 mt-0.5">Outstanding: {moneyZAR(outstanding)}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg ${
              filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {revise && (
        <section className="rounded-xl border px-4 py-3 space-y-3" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.08)' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-amber-300">Revise rejected invoice</p>
            <button type="button" onClick={cancelRevise} className="text-[12px] text-slate-400">Cancel</button>
          </div>
          <p className="text-[12px] text-slate-400">Job: {payoutJobDisplay(revise)}</p>
          <p className="text-[12px] text-slate-400">Previous ref: {payoutInvoiceReference(revise)}</p>
          {revise.rejection_reason && (
            <p className="text-[12px] text-red-300">Reason: {revise.rejection_reason}</p>
          )}
          <Field label="Amount (ZAR) *" value={amount} onChange={setAmount} inputMode="decimal" />
          <Field label="Invoice reference" value={invoiceRef} onChange={setInvoiceRef} />
          <Field label="Notes" value={notes} onChange={setNotes} />
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitRevise()}
            className="h-10 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit revised invoice'}
          </button>
        </section>
      )}

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-500 text-[13px]">No payouts in this filter.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => (
            <article
              key={p.id}
              className="rounded-xl border px-4 py-3 space-y-2"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-white truncate">{payoutJobDisplay(p)}</p>
                  <p className="text-[12px] text-slate-500 mt-0.5">{fmtDate(p.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[15px] font-bold text-white">{moneyZAR(payoutNetPayable(p))}</p>
                  <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    {payoutStatusLabel(p)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                <Row label="Invoice ref" value={payoutInvoiceReference(p)} />
                <Row label="Retention" value={p.retention_amount > 0 ? moneyZAR(p.retention_amount) : '—'} />
                {p.approved_at && <Row label="Approved" value={fmtDate(p.approved_at)} />}
                {p.paid_at && <Row label="Paid" value={fmtDate(p.paid_at)} />}
              </div>
              {payoutIsRejected(p) && (
                <div className="pt-1">
                  {p.rejection_reason && (
                    <p className="text-[12px] text-red-300 mb-2">Rejected: {p.rejection_reason}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => startRevise(p)}
                    className="text-[12px] font-semibold text-amber-300 hover:underline"
                  >
                    Revise & resubmit
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <p className="text-[12px] text-slate-500">
        Submit new invoices from a job detail page.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 text-right truncate">{value}</span>
    </div>
  )
}

function Field({
  label, value, onChange, inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: 'decimal'
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-slate-500 uppercase">{label}</label>
      <input
        className="w-full h-10 px-3 rounded-lg text-[13px] text-white"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        value={value}
        inputMode={inputMode}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
