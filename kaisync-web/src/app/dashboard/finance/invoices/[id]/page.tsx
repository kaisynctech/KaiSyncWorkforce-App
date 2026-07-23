'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'
import { recordInvoicePayment } from '@/lib/finance-api'
import type { FinanceInvoice, FinanceInvoiceLine } from '@/lib/finance-types'

export default function FinanceInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [inv, setInv] = useState<FinanceInvoice | null>(null)
  const [lines, setLines] = useState<FinanceInvoiceLine[]>([])
  const [loading, setLoading] = useState(true)
  const [payAmount, setPayAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [actor, setActor] = useState<{ id: string; name: string; companyId: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { data: emp } = await supabase.from('employees').select('name, surname').eq('id', member.employeeId).maybeSingle()
    setActor({
      id: member.employeeId,
      name: emp ? `${emp.name} ${emp.surname}` : 'User',
      companyId: member.companyId,
    })
    const [{ data: invoice }, { data: lineRows }] = await Promise.all([
      supabase.from('finance_invoices').select('*, clients(name)').eq('id', id).maybeSingle(),
      supabase.from('finance_invoice_lines').select('*').eq('invoice_id', id).order('line_no'),
    ])
    setInv(invoice as FinanceInvoice | null)
    setLines((lineRows ?? []) as FinanceInvoiceLine[])
    if (invoice) setPayAmount(String(invoice.balance_due ?? 0))
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  async function markSent() {
    if (!inv) return
    setBusy(true)
    const supabase = createClient()
    await supabase.from('finance_invoices').update({ status: 'sent' }).eq('id', inv.id)
    await load()
    setBusy(false)
  }

  async function pay() {
    if (!inv || !actor) return
    const amount = Number(payAmount)
    if (!(amount > 0)) return
    setBusy(true)
    const supabase = createClient()
    await recordInvoicePayment(supabase, inv.id, amount, 'eft', actor.id, actor.name)
    await load()
    setBusy(false)
  }

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (!inv) return <p className="p-6 text-[13px] text-text-secondary">Invoice not found</p>

  return (
    <div className="h-full overflow-y-auto p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => router.push('/dashboard/finance/invoices')} className="text-[13px] text-primary">← Invoices</button>
        <span className="text-[12px] capitalize px-2 py-0.5 rounded bg-surface-elevated">{inv.status.replace(/_/g, ' ')}</span>
      </div>
      <h1 className="text-[20px] font-semibold text-text-primary">{inv.invoice_number || 'Draft invoice'}</h1>
      <p className="text-[13px] text-text-secondary">
        {(inv.clients as { name: string } | null)?.name ?? 'No client'} · Issued {inv.issue_date}
        {inv.due_date ? ` · Due ${inv.due_date}` : ''}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3"><p className="text-[11px] text-text-secondary">Subtotal</p><p className="font-semibold">{fmtMoney(inv.subtotal)}</p></div>
        <div className="card p-3"><p className="text-[11px] text-text-secondary">VAT</p><p className="font-semibold">{fmtMoney(inv.vat_amount)}</p></div>
        <div className="card p-3"><p className="text-[11px] text-text-secondary">Balance</p><p className="font-semibold">{fmtMoney(inv.balance_due)}</p></div>
      </div>

      {lines.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-divider text-text-secondary">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2">Qty</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id} className="border-b border-divider">
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right">{l.quantity}</td>
                <td className="py-2 text-right">{fmtMoney(l.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        {inv.status === 'draft' && (
          <button onClick={markSent} disabled={busy} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">Mark sent</button>
        )}
        {inv.balance_due > 0 && inv.status !== 'cancelled' && inv.status !== 'draft' && (
          <>
            <label className="text-[12px] text-text-secondary">Payment amount
              <input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                className="block mt-1 h-9 px-3 border border-border rounded-md text-[13px] bg-background w-36" />
            </label>
            <button onClick={pay} disabled={busy} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">Record payment</button>
          </>
        )}
      </div>
    </div>
  )
}
