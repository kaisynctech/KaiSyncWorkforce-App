'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

type Payment = {
  id: string
  amount: number
  paid_at: string
  payment_method: string | null
  reference: string | null
  notes: string | null
  receipt_url: string | null
}

const METHODS = ['EFT', 'Cash', 'Card', 'Cheque', 'Other']

const fmtMoney = (n: number) =>
  `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`

export function ProjectPaymentsTab({
  projectId,
  offerAmount,
  onPaidUpdated,
}: {
  projectId: string
  offerAmount: number | null
  onPaidUpdated?: (paid: number) => void
}) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('EFT')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const paidTotal = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments],
  )
  const offer = Number(offerAmount ?? 0)
  const balance = Math.max(0, offer - paidTotal)
  const progress = offer > 0 ? Math.min(100, Math.round((paidTotal / offer) * 100)) : 0

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data, error: qErr } = await supabase
      .from('project_client_payments')
      .select('id, amount, paid_at, payment_method, reference, notes, receipt_url')
      .eq('deal_id', projectId)
      .order('paid_at', { ascending: false })

    if (qErr) setError(qErr.message)
    const rows = (data ?? []) as Payment[]
    setPayments(rows)
    onPaidUpdated?.(rows.reduce((s, p) => s + Number(p.amount || 0), 0))
    setLoading(false)
  }, [projectId, onPaidUpdated])

  useEffect(() => { void load() }, [load])

  async function syncAmountPaid(companyId: string, total: number) {
    const supabase = createClient()
    // Prefer client_deals.amount_paid (MAUI source of truth); also try projects.paid_amount
    await supabase.from('client_deals').update({ amount_paid: total }).eq('id', projectId).eq('company_id', companyId)
    await supabase.from('projects').update({ paid_amount: total }).eq('id', projectId).eq('company_id', companyId)
  }

  async function addPayment() {
    const value = Number(amount)
    if (!value || value <= 0) { setError('Enter a valid amount.'); return }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Account not linked.'); setBusy(false); return }

    const { error: insErr } = await supabase.from('project_client_payments').insert({
      company_id: member.companyId,
      deal_id: projectId,
      amount: value,
      paid_at: new Date().toISOString(),
      payment_method: method || null,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    })
    if (insErr) {
      setError(insErr.message)
      setBusy(false)
      return
    }

    const nextTotal = paidTotal + value
    await syncAmountPaid(member.companyId, nextTotal)
    setAmount('')
    setReference('')
    setNotes('')
    setShowForm(false)
    await load()
    setBusy(false)
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Paid</p>
          <p className="text-[18px] font-bold text-success">{fmtMoney(paidTotal)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Balance</p>
          <p className="text-[18px] font-bold text-text-primary">{fmtMoney(balance)}</p>
        </div>
        <div className="card p-3">
          <p className="text-[11px] text-text-secondary">Progress</p>
          <p className="text-[18px] font-bold text-primary">{progress}%</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="section-label">PAYMENTS</p>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary h-9 px-3 text-[13px]">
          {showForm ? 'Cancel' : '+ Add payment'}
        </button>
      </div>

      {showForm && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Amount *</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="dark-entry w-full" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)} className="dark-entry w-full">
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)} className="dark-entry w-full" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-text-secondary">Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} className="dark-entry w-full" />
          </div>
          <button disabled={busy} onClick={addPayment} className="btn-primary h-10 px-4 text-[13px]">
            {busy ? 'Saving…' : 'Save payment'}
          </button>
        </div>
      )}

      {error && <p className="text-[13px] text-error">{error}</p>}

      {loading ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">Loading payments…</p>
      ) : payments.length === 0 ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">No payments recorded.</p>
      ) : (
        <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Date</th>
                <th className="data-th text-right">Amount</th>
                <th className="data-th text-left">Method</th>
                <th className="data-th text-left">Reference</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-divider last:border-0">
                  <td className="data-td">{new Date(p.paid_at).toLocaleDateString('en-ZA')}</td>
                  <td className="data-td text-right font-medium">{fmtMoney(p.amount)}</td>
                  <td className="data-td">{p.payment_method || '—'}</td>
                  <td className="data-td text-text-secondary">{p.reference || p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
